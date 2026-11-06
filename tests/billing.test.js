'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { event, pdf, access, password } = require('../billing/fixtures');
const { EVENTS, valid, eventId, date, calendar, MAX_PDF } = require('../billing/contract');
const { headers, canonical, hash } = require('../billing/protocol');
const { createReceiver, configuration, ROUTE, register } = require('../billing/receiver');
const { render } = require('../billing/template');
const { createSender, confirmPassword } = require('../billing/smtp');
const { Store } = require('../billing/store');
const secret = Buffer.alloc(32, 7).toString('base64');
const now = Date.parse('2026-11-04T12:00:00Z');
function setup(t, modify = {}) {
    const now = modify.now ?? Date.parse('2026-11-04T12:00:00Z');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const config = { enabled: true, directory, secret, origin: 'https://portal.example.test' };
    const messages = [], phases = [];
    const fetcher = async (url, options) => {
        assert.equal(new URL(url).origin, config.origin); assert.equal(options.redirect, 'error');
        if (options.method === 'GET') {
            const p = modify.event || event();
            return new Response(modify.bytes || pdf, { status: modify.pdfStatus || 200, headers: {
                'content-type': 'application/pdf', 'x-itr-client-id': p.clientId, 'x-itr-invoice-id': p.invoiceId,
                'x-itr-document-kind': p.document.kind, 'x-itr-document-version': p.document.version, ...modify.pdfHeaders } });
        }
        const { event: p, phase } = JSON.parse(options.body);
        phases.push(phase);
        let proof = { protocol: 'itr-billing-v1', phase, requestNonce: options.headers['x-itr-nonce'], eventDigest: hash(canonical(p)),
            authorized: true, eligible: true, chainVerified: true, baselineVerified: true, proposalStatus: 'Aceita', contractStatus: 'Ativo',
            checkedAt: now, expiresAt: now + 5000, paymentStatus: p.type === 'BOLETO_PAYMENT_RECORDED' ? 'Pago' : 'Aguardando Emissão da NF',
            collectionStopped: false, documentPayable: true, payableAfterDue: true, newPaymentTransition: true, leaseId: 'd'.repeat(64), access: access(p), ...modify.proof };
        if (modify.final && phase === 'smtp') proof = { ...proof, ...modify.final };
        if (phase === 'smtp') for (const key of modify.omitFinal || []) delete proof[key];
        const raw = canonical(proof);
        return new Response(raw, { headers: { ...headers(secret, 'RESPONSE', '/internal/billing/v1/authorize', raw, now), ...modify.authHeaders } });
    };
    const send = modify.send || (async args => { messages.push(args); return { ok: true }; });
    const credentials = modify.credentials || (async () => password);
    const receiver = createReceiver({ config, fetcher, send, credentials, clock: () => now });
    const post = (p, r = receiver, h) => { const raw = Buffer.from(JSON.stringify(p)); return r.handle({ method: 'POST', path: ROUTE, headers: h || headers(secret, 'POST', ROUTE, raw, now) }, raw); };
    return { config, messages, phases, fetcher, send, credentials, receiver, post };
}
for (const type of EVENTS) test('evento e PDF correto: ' + type, async t => {
    const p = event(type);
    if (type === 'BOLETO_DUE_TODAY') p.dueDate = '2026-11-04';
    if (type === 'BOLETO_OVERDUE_REMINDER') { p.dueDate = '2026-10-30'; p.scheduledFor = '2026-11-04'; }
    p.eventId = eventId(p);
    const s = setup(t, { event: p });
    assert.equal((await s.post(p)).body.code, 'SENT');
    assert.equal(s.messages[0].pdfs.length, type === 'BOLETO_PAYMENT_RECORDED' ? 0 : 1);
    if (p.document) assert.equal(s.messages[0].pdfs[0].filename, type === 'NFSE_AVAILABLE' ? 'NFSe.pdf' : 'Boleto.pdf');
});
for (const [days, dueDate] of [[5, '2026-10-30'], [10, '2026-10-25'], [15, '2026-10-20']]) test(`recorrência D+${days}: envio, replay e recibo`, async t => {
    const p = event('BOLETO_OVERDUE_REMINDER'); p.dueDate = dueDate; p.scheduledFor = '2026-11-04'; p.eventId = eventId(p);
    const s = setup(t, { event: p, proof: { paymentStatus: 'Vencido' } });
    const signed = headers(secret, 'POST', ROUTE, JSON.stringify(p), now);
    assert.equal((await s.post(p, s.receiver, signed)).body.code, 'SENT');
    assert.equal((await s.post(p, s.receiver, signed)).body.code, 'REPLAY');
    const restarted = createReceiver({ config: s.config, fetcher: s.fetcher, send: s.send, clock: () => now });
    assert.equal((await s.post(p, restarted)).body.code, 'ALREADY_SENT');
    assert.equal(s.messages.length, 1);
});
test('D+1 legado rejeitado; dias intermediários e scheduledFor fora do contrato', async t => {
    const s = setup(t);
    assert.equal((await s.post(event('BOLETO_D_PLUS_1'))).status, 422);
    for (const dueDate of ['2026-11-03', '2026-10-29', '2026-11-04', '2026-11-05', null, '2026-02-30']) {
        const p = event('BOLETO_OVERDUE_REMINDER'); p.dueDate = dueDate; p.scheduledFor = '2026-11-04'; p.eventId = eventId(p);
        assert.equal((await s.post(p)).status, 422);
    }
    const p = event('BOLETO_OVERDUE_REMINDER'); delete p.scheduledFor; assert.equal(valid(p), false);
    assert.equal(valid({ ...event(), scheduledFor: '2026-11-04' }), false);
    assert.equal(s.messages.length, 0);
});
test('ocorrências distintas, sem catch-up ou antecipação', async t => {
    const p = event('BOLETO_OVERDUE_REMINDER'); p.dueDate = '2026-10-25'; p.scheduledFor = '2026-10-30'; p.eventId = eventId(p);
    const ids = [p.eventId]; const s = setup(t, { event: p });
    assert.equal((await s.post(p)).body.code, 'OBSOLETE');
    p.scheduledFor = '2026-11-04'; p.eventId = eventId(p); ids.push(p.eventId);
    assert.equal((await s.post(p)).body.code, 'SENT');
    p.scheduledFor = '2026-11-09'; p.eventId = eventId(p); ids.push(p.eventId);
    assert.equal((await s.post(p)).body.code, 'OBSOLETE');
    assert.equal(new Set(ids).size, 3); assert.equal(s.messages.length, 1);
});
test('recorrência usa dia civil São Paulo, inclusive fronteira UTC e DST histórico', () => {
    const p = event('BOLETO_OVERDUE_REMINDER'); p.dueDate = '2026-12-27'; p.scheduledFor = '2027-01-01';
    assert.equal(calendar(p, Date.parse('2027-01-01T02:59:59Z')), false);
    assert.equal(calendar(p, Date.parse('2027-01-01T03:00:00Z')), true);
    assert.equal(calendar(p, Date.parse('2027-01-02T02:59:59Z')), true);
    assert.equal(calendar(p, Date.parse('2027-01-02T03:00:00Z')), false);
    p.dueDate = '2018-11-01'; p.scheduledFor = '2018-11-06';
    assert.equal(calendar(p, Date.parse('2018-11-06T01:59:59Z')), false);
    assert.equal(calendar(p, Date.parse('2018-11-06T02:00:00Z')), true);
});
test('recorrência sem status/autorização ou revogada após download bloqueia SMTP', async t => {
    for (const final of [{ paymentStatus: undefined }, { authorized: undefined }, { authorized: false }, { paymentStatus: 'Pago' }, { paymentStatus: 'Cancelado' }, { documentPayable: false }, { payableAfterDue: false }]) {
        const p = event('BOLETO_OVERDUE_REMINDER'); p.dueDate = '2026-10-30'; p.scheduledFor = '2026-11-04'; p.eventId = eventId(p);
        const s = setup(t, { event: p, final, omitFinal: Object.keys(final).filter(k => final[k] === undefined) });
        assert.equal((await s.post(p)).status, 503); assert.equal(s.messages.length, 0);
    }
});
test('pagamento registrado bloqueia todas as ocorrências e destinatários posteriores', async t => {
    const s = setup(t); await s.post(event('BOLETO_PAYMENT_RECORDED'));
    for (const scheduledFor of ['2026-11-10', '2026-11-15', '2026-11-20']) {
        const p = event('BOLETO_OVERDUE_REMINDER'); p.scheduledFor = scheduledFor; p.recipient = 'outro@example.test'; p.eventId = eventId(p);
        assert.equal((await s.post(p)).body.code, 'COLLECTION_STOPPED');
    }
    assert.equal(s.messages.length, 1);
});
test('todos os templates têm o botão e o bloco Dados de acesso, com CNPJ validado e senha', () => {
    for (const type of EVENTS) {
        const p = event(type), without = render(p, now), withAccess = render(p, now, access(p), null, password);
        for (const part of [withAccess.html, withAccess.texto]) {
            assert.match(part, /https:\/\/portal\.itr\.eng\.br\/login\.html/); assert.match(part, /Dados de acesso/);
            assert.match(part, /Mantenha estes dados protegidos\./); assert.doesNotMatch(part, /Recuperar acesso|recuperar-senha|Acesso ao Portal do Cliente/);
        }
        assert.match(withAccess.html, /<strong>Dados de acesso<\/strong><br>CNPJ: 12\.345\.678\/0001-95<br><strong>Senha:<\/strong> EX123456<br>Mantenha estes dados protegidos\./);
        assert.match(withAccess.texto, /Dados de acesso\nCNPJ: 12\.345\.678\/0001-95\nSenha: EX123456\nMantenha estes dados protegidos\./);
        assert.ok(withAccess.html.indexOf('cid:portalCta') < withAccess.html.indexOf('Dados de acesso'));
        assert.doesNotMatch(withAccess.assunto, /EX123456/);
        assert.throws(() => render(p, now, access(p)), /ACCESS_NOT_CONFIRMED/);
        for (const part of [without.html, without.texto, render(p, now, null, null, password).html]) assert.doesNotMatch(part, /Dados de acesso|Senha:|EX123456/);
        for (const part of [without.html, without.texto, withAccess.assunto, without.assunto]) assert.doesNotMatch(part, /CNPJ|12\.?345\.?678|0001-?95/);
        assert.equal(valid({ ...p, cnpj: '12345678000195' }), false);
    }
});
const onlyEnv = { BILLING_EMAILS_ENABLED: 'true', EMAIL_ATIVO: 'true' };
const persistedIn = s => fs.readdirSync(s.config.directory).map(f => fs.readFileSync(path.join(s.config.directory, f), 'utf8')).join('');
test('CNPJ e senha chegam completos ao SMTP e ficam fora dos recibos', async t => {
    const p = event(); let mail; const calls = [];
    const send = createSender({ sendMail: async m => { mail = m; return { accepted: [p.recipient] }; } }, onlyEnv);
    const s = setup(t, { send, credentials: a => confirmPassword(async (...x) => { calls.push(x); return password; }, a) });
    assert.equal((await s.post(p)).status, 200);
    assert.deepEqual(calls[0].slice(0, 2), ['12345678000195', p.recipient]);
    assert.match(mail.html, /CNPJ: 12\.345\.678\/0001-95<br><strong>Senha:<\/strong> EX123456/); assert.match(mail.text, /CNPJ: 12\.345\.678\/0001-95\nSenha: EX123456/);
    assert.doesNotMatch(mail.subject + JSON.stringify(mail.attachments.map(a => a.filename)), /EX123456|12\.?345/);
    assert.doesNotMatch(persistedIn(s), /EX123456|12345678000195|financeiro@example/);
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'billing', 'receiver.js'), 'utf8'), /confirmPassword\(require\('\.\.\/proposals\/access'\)\.accessForEmail, access\)/);
});
const NOT_CONFIRMED = {
    'indisponibilidade da consulta': { resolve: async () => { throw Object.assign(new Error('financeiro@example.test'), { transient: true }); }, log: /ACCESS_NOT_CONFIRMED/ },
    'timeout da consulta': { resolve: () => new Promise(() => {}), log: /ACCESS_LOOKUP_TIMEOUT/ },
    'destinatário sem autorização': { resolve: async (c, r, o) => { o.onDecision('FINANCE_RECIPIENT_NOT_AUTHORIZED'); return null; }, log: /FINANCE_RECIPIENT_NOT_AUTHORIZED/ },
    'cadastro ambíguo': { resolve: async (c, r, o) => { o.onDecision('OPERATIONAL_PASSWORD_AMBIGUOUS'); return null; }, log: /OPERATIONAL_PASSWORD_AMBIGUOUS/ },
    'credencial com quebra de linha': { resolve: async () => 'com\nquebra', log: /ACCESS_NOT_CONFIRMED/ },
    'credencial vazia': { resolve: async () => '   ', log: /ACCESS_NOT_CONFIRMED/ },
    'credencial que não é texto': { resolve: async () => 123456, log: /ACCESS_NOT_CONFIRMED/ },
};
for (const [name, { resolve, log }] of Object.entries(NOT_CONFIRMED)) test(`sem senha confirmada nada é enviado e o evento segue reenviável: ${name}`, async t => {
    const p = event(), logs = []; let lookup = resolve, sent = 0, mail;
    t.mock.method(console, 'warn', m => logs.push(m));
    const send = createSender({ sendMail: async m => { sent++; mail = m; return { accepted: [p.recipient] }; } }, onlyEnv);
    const s = setup(t, { send, credentials: a => confirmPassword((...x) => lookup(...x), a, 20) });
    const blocked = await s.post(p);
    // The only answer the Portal retries with no SMTP and no lease left behind, and no final proof was asked for.
    assert.equal(blocked.status, 503); assert.equal(blocked.body.code, 'PORTAL_VALIDATION_FAILED');
    assert.equal(sent, 0); assert.deepEqual(s.phases, ['prepare']);
    const store = new Store(s.config.directory);
    assert.equal(store.read('sending:' + p.eventId), null); assert.equal(store.read('sent:' + p.eventId), null);
    assert.match(logs.join(''), log); assert.doesNotMatch(logs.join(''), /12345678000195|financeiro@example|quebra/);
    // Same event, once the source answers: one single complete message, then the receipt answers.
    lookup = async () => password;
    assert.equal((await s.post(p)).body.code, 'SENT'); assert.equal(sent, 1);
    assert.match(mail.html, /CNPJ: 12\.345\.678\/0001-95<br><strong>Senha:<\/strong> EX123456/);
    lookup = () => assert.fail('consulta após o envio');
    assert.equal((await s.post(p)).body.code, 'ALREADY_SENT'); assert.equal(sent, 1);
});
test('resolvedor real: Airtable fora do ar, recusa ou cadastro sem sigla bloqueiam; cadastro válido envia', async t => {
    const { accessForEmail } = require('../proposals/access');
    t.mock.method(console, 'warn', () => {});
    const env = { AIRTABLE_TOKEN: 'simulado', AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA', AIRTABLE_FINANCE_BASE_ID: 'appFFFFFFFFFFFFFF' };
    const cnpj = access(event()).cnpj, recipient = event().recipient;
    const finance = { records: [{ id: 'rec1', fields: { fldb8XcWv0Uooz3Uo: cnpj, fldtqo76edbzzQcNz: recipient } }] };
    const directory = sigla => ({ records: [{ id: 'rec2', fields: { CNPJ: cnpj, 'Sigla Cliente': sigla } }] });
    const answer = (body, status = 200) => new Response(JSON.stringify(body), { status });
    const byBase = operational => async url => String(url).includes('appFFFFFFFFFFFFFF') ? answer(finance) : operational();
    const run = async fetcher => {
        const p = event(), s = setup(t, { credentials: a => confirmPassword((c, r, o) => accessForEmail(c, r, { ...o, env, fetcher }), a, 200) });
        return { reply: await s.post(p), s, p };
    };
    for (const fetcher of [async () => answer({}, 503), async () => answer({}, 429), async () => answer({}, 403), async () => { throw new TypeError('fetch failed'); },
        byBase(async () => answer({}, 503)), byBase(async () => answer(directory(''))), byBase(async () => answer({ records: [] }))]) {
        const { reply, s, p } = await run(fetcher);
        assert.equal(reply.status, 503); assert.equal(reply.body.code, 'PORTAL_VALIDATION_FAILED'); assert.equal(s.messages.length, 0);
        assert.equal(new Store(s.config.directory).read('sending:' + p.eventId), null);
    }
    const { reply, s } = await run(byBase(async () => answer(directory('EX'))));
    assert.equal(reply.body.code, 'SENT'); assert.equal(s.messages[0].password, 'EX123456');
});
test('prova sem identidade ou com identidade diferente na fase final não envia', async t => {
    const p = event();
    for (const modify of [{ proof: { access: null } }, { final: { access: null } }, { omitFinal: ['access'] }, { final: { access: { ...access(p), cnpj: '11222333000181' } } }]) {
        const s = setup(t, modify), r = await s.post(p);
        assert.equal(r.status, 503); assert.equal(r.body.code, 'PORTAL_VALIDATION_FAILED'); assert.equal(s.messages.length, 0);
        assert.equal(new Store(s.config.directory).read('sending:' + p.eventId), null);
    }
});
test('receptor montado sem consulta de senha: o remetente real recusa, sem SMTP e sem reenvio', async t => {
    const p = event(), base = setup(t), send = createSender({ sendMail: () => assert.fail('SMTP') }, onlyEnv);
    const bare = createReceiver({ config: base.config, fetcher: base.fetcher, send, clock: () => now });
    assert.equal((await base.post(p, bare)).body.code, 'DELIVERY_UNCERTAIN');
    assert.equal((await base.post(p, bare)).body.code, 'DELIVERY_UNCERTAIN');
});
test('a rota de produção sempre consulta a senha: sem cadastro confirmado, nada é enviado', async t => {
    const express = require('express'), p = event(), base = setup(t), warn = t.mock.method(console, 'warn', () => {});
    let sends = 0; const app = express();
    // No credentials option here: the same default wiring as server.js, and no Airtable configuration to read from.
    register(app, express, { config: base.config, fetcher: base.fetcher, clock: () => now, send: async () => { sends++; return { ok: true }; } });
    const server = app.listen(0, '127.0.0.1'); t.after(() => new Promise(done => server.close(done)));
    await new Promise(done => server.once('listening', done));
    const raw = JSON.stringify(p), response = await fetch(`http://127.0.0.1:${server.address().port}${ROUTE}`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...headers(secret, 'POST', ROUTE, raw, now) } });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'PORTAL_VALIDATION_FAILED');
    assert.equal(sends, 0); assert.ok(warn.mock.calls.length > 0);
});
test('entrega incerta não consulta a senha nem reenvia', async t => {
    const p = event(); let lookups = 0, attempts = 0;
    const s = setup(t, { credentials: async () => { lookups++; return password; }, send: async () => { attempts++; throw new Error('SMTP_TIMEOUT'); } });
    assert.equal((await s.post(p)).body.code, 'DELIVERY_UNCERTAIN');
    assert.equal(lookups, 1); assert.equal(attempts, 1);
    assert.equal((await s.post(p)).body.code, 'DELIVERY_UNCERTAIN');
    assert.equal(lookups, 1); assert.equal(attempts, 1);
});
test('o remetente recusa mensagem sem o bloco completo, mesmo chamado diretamente', async () => {
    const p = event(), send = createSender({ sendMail: () => assert.fail('SMTP') }, onlyEnv), pdfs = [{ content: pdf }];
    for (const args of [{}, { access: access(p) }, { password }, { access: access(p), password: '  ' }, { access: access(p), password: 'a\nb' }])
        await assert.rejects(send({ event: p, pdfs, now, ...args }), /ACCESS_NOT_CONFIRMED/);
});
test('CNPJ adulterado, vínculo errado e campos de senha na prova são rejeitados', async t => {
    const p = event();
    for (const a of [{ ...access(p), clientId: 'recZZZZZZZZZZZZZZ' }, { ...access(p), recipient: 'outro@example.test' }, { ...access(p), cnpj: '<script>' }, { ...access(p), cnpj: '12345678000195\r\n' }, { ...access(p), password: 'proibida' }]) {
        const s = setup(t, { final: { access: a } }); assert.equal((await s.post(p)).status, 503); assert.equal(s.messages.length, 0);
        assert.throws(() => render(p, now, a), /ACCESS_SCOPE_INVALID/);
    }
});
test('schema fechado, datas, CRLF e tipos inválidos', () => {
    for (const change of [{ type: 'BOLETO_REPLACED' }, { type: 'NEW' }, { protocol: 'v2' }, { recipient: 'a@example.test;b@example.test' }, { contractName: 'a\r\nBcc:x' }, { amountCents: -1 }, { dueDate: '2026-02-30' }, { url: 'https://evil.test' }, { document: null }]) assert.equal(valid({ ...event(), ...change }), false);
    assert.equal(date('2028-02-29'), true); assert.equal(date('2026-02-29'), false);
    const p = event(); p.dueDate = null; p.eventId = eventId(p); assert.equal(valid(p), true);
    assert.doesNotMatch(render(p).html, /Vencimento|Prazo restante/);
    p.type = 'BOLETO_D_MINUS_1'; p.eventId = eventId(p); assert.equal(valid(p), false);
    assert.equal(calendar(event('BOLETO_DUE_TODAY'), now), false);
});
test('HMAC inválido, expirado, replay persistido', async t => {
    const s = setup(t), p = event(), raw = JSON.stringify(p), signed = headers(secret, 'POST', ROUTE, raw, now);
    assert.equal((await s.post(p, s.receiver, { ...signed, 'x-itr-signature': 'a'.repeat(64) })).status, 401);
    assert.equal((await s.post(p, s.receiver, headers(secret, 'POST', ROUTE, raw, now - 301000))).status, 401);
    assert.equal((await s.post(p, s.receiver, signed)).status, 200);
    const restarted = createReceiver({ config: s.config, fetcher: s.fetcher, send: s.send, clock: () => now });
    assert.equal((await s.post(p, restarted, signed)).body.code, 'REPLAY');
    assert.equal((await s.post(p, restarted)).body.code, 'ALREADY_SENT');
    assert.equal(s.messages.length, 1);
    assert.equal((await s.post({ ...p, amountCents: 1 })).body.code, 'INVALID_EVENT');
    assert.equal((await s.post({ ...p, stateVersion: 'd'.repeat(64) })).body.code, 'EVENT_CONFLICT');
});
for (const proof of [{ authorized: false }, { chainVerified: false }, { baselineVerified: false }, { eligible: false }, { contractStatus: 'Cancelado' }, { proposalStatus: 'Enviada' }, { paymentStatus: 'Pago' }, { paymentStatus: 'Cancelado' }, { paymentStatus: 'desconhecido' }, { eventDigest: 'a'.repeat(64) }, { requestNonce: 'fake' }, { expiresAt: now }, { checkedAt: now - 6000 }, { documentPayable: false }, { leaseId: null }]) test('evidência bloqueada: ' + JSON.stringify(proof), async t => {
    const s = setup(t, { proof }); assert.equal((await s.post(event())).body.code, 'PORTAL_VALIDATION_FAILED'); assert.equal(s.messages.length, 0);
});
test('revogação entre download e SMTP e assinatura da prova', async t => {
    for (const modify of [{ final: { authorized: false } }, { final: { paymentStatus: 'Pago' } }, { authHeaders: { 'x-itr-signature': '0'.repeat(64) } }]) {
        const s = setup(t, modify); assert.equal((await s.post(event())).status, 503); assert.equal(s.messages.length, 0);
    }
});
for (const modify of [{ pdfStatus: 404 }, { bytes: Buffer.from('HTML inválido') }, { bytes: Buffer.from('%PDF-alterado') }, { bytes: Buffer.alloc(MAX_PDF + 1) }, { pdfHeaders: { 'content-type': 'text/html' } }, { pdfHeaders: { 'x-itr-client-id': 'recZZZZZZZZZZZZZZ' } }, { pdfHeaders: { 'x-itr-invoice-id': 'recZZZZZZZZZZZZZZ' } }, { pdfHeaders: { 'x-itr-document-kind': 'nfse' } }, { pdfHeaders: { 'x-itr-document-version': 'e'.repeat(64) } }]) test('documento inválido: ' + (modify.bytes ? modify.bytes.length : JSON.stringify(modify)), async t => {
    const s = setup(t, modify); assert.equal((await s.post(event())).status, 503); assert.equal(s.messages.length, 0);
});
test('concorrência entre receptores e SMTP incerto após reinício', async t => {
    let release; const gate = new Promise(r => { release = r; }); let calls = 0;
    const s = setup(t, { send: async () => { calls++; await gate; throw new Error('ack perdido'); } });
    const other = createReceiver({ config: s.config, fetcher: s.fetcher, send: s.send, clock: () => now });
    const pending = s.post(event());
    assert.equal((await s.post(event(), other)).body.code, 'BUSY');
    release(); assert.equal((await pending).body.code, 'DELIVERY_UNCERTAIN');
    assert.equal((await s.post(event(), other)).body.code, 'DELIVERY_UNCERTAIN'); assert.equal(calls, 1);
});
test('pagamento bloqueia cobranças futuras para todos os destinatários', async t => {
    const s = setup(t); assert.equal((await s.post(event('BOLETO_PAYMENT_RECORDED'))).status, 200);
    const p = event(); p.recipient = 'outro@example.test'; p.eventId = eventId(p);
    assert.equal((await s.post(p)).body.code, 'COLLECTION_STOPPED'); assert.equal(s.messages.length, 1);
});
test('destinatários isolados e ausência de interface Portal', async t => {
    const s = setup(t), p = event(); await s.post(p); p.recipient = 'outro@example.test'; p.eventId = eventId(p); await s.post(p);
    assert.equal(s.messages.length, 2);
    const missing = createReceiver({ config: s.config, fetcher: async () => { throw new Error('não implementado'); }, send: () => assert.fail('SMTP'), clock: () => now });
    p.recipient = 'terceiro@example.test'; p.eventId = eventId(p); assert.equal((await s.post(p, missing)).status, 503);
});
test('flag desligada, configuração, lock órfão falha fechado', async t => {
    assert.deepEqual(configuration({}), { enabled: false }); assert.throws(() => configuration({ BILLING_EMAILS_ENABLED: 'sim' }));
    const off = createReceiver({ config: { enabled: false }, send: () => assert.fail('SMTP') }); assert.equal((await off.handle({}, null)).body.code, 'DISABLED');
    const s = setup(t), p = event(); new Store(s.config.directory).lock(canonical([p.clientId, p.contractId, p.invoiceId]));
    assert.equal((await s.post(p)).body.code, 'BUSY');
});
test('HTML escapado, SMTP fake MIME, sem destinatários adicionais', async () => {
    const p = event(); p.installment = '<img src=x onerror=alert(1)>'; const rendered = render(p, now);
    assert.match(rendered.html, /&lt;img/); assert.doesNotMatch(rendered.html, /<img src=x|Senha:|CNPJ/);
    let mail;
    const send = createSender({ sendMail: async message => { mail = message; return { accepted: [p.recipient], rejected: [] }; } }, { BILLING_EMAILS_ENABLED: 'true', EMAIL_ATIVO: 'true' });
    assert.equal((await send({ event: p, pdfs: [{ content: pdf }], now, access: access(p), password })).ok, true);
    assert.equal(mail.to, p.recipient); assert.equal(mail.cc, undefined); assert.equal(mail.bcc, undefined);
    assert.equal(mail.attachments.length, 3); assert.equal(mail.disableUrlAccess, true);
    assert.equal(mail.attachments[2].filename, 'Boleto.pdf');
    assert.equal(mail.from, 'ITR Engenharia <naoresponda@itr.eng.br>');
    const configured = createSender({ sendMail: async message => { mail = message; return { accepted: [p.recipient], rejected: [] }; } }, { BILLING_EMAILS_ENABLED: 'true', EMAIL_ATIVO: 'true', EMAIL_REMETENTE: 'ITR Teste <financeiro@example.test>' });
    await configured({ event: p, pdfs: [{ content: pdf }], now, access: access(p), password });
    assert.equal(mail.from, 'ITR Teste <financeiro@example.test>', 'mesmo remetente configurado dos demais fluxos');
});
test('rota HTTP isolada, JSON bruto, autenticação e limite', async t => {
    const express = require('express'), app = express(), s = setup(t);
    register(app, express, { config: s.config, send: s.send, fetcher: s.fetcher, credentials: s.credentials, clock: () => now });
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => server.close(r)));
    const url = `http://127.0.0.1:${server.address().port}${ROUTE}`, body = JSON.stringify(event());
    assert.equal((await fetch(url, { method: 'POST', body, headers: headers(secret, 'POST', ROUTE, body, now) })).status, 200);
    assert.equal((await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', body: 'x'.repeat(17000), headers: { 'content-type': 'application/json' } })).status, 413);
    for (let i = 0; i < 118; i++) await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    assert.equal((await fetch(url, { method: 'POST', body })).status, 429);
});
test('Recorrência exige pagabilidade posterior, disponibilidade permite vencimento ausente', async t => {
    const p = event('BOLETO_OVERDUE_REMINDER'); p.dueDate = '2026-10-30'; p.scheduledFor = '2026-11-04'; p.eventId = eventId(p);
    const blocked = setup(t, { event: p, proof: { paymentStatus: 'Vencido', payableAfterDue: false } });
    assert.equal((await blocked.post(p)).status, 503);
    const available = event(); available.dueDate = null; available.eventId = eventId(available);
    const s = setup(t, { event: available }); assert.equal((await s.post(available)).status, 200);
});
test('calendário São Paulo, virada de ano e bissexto', () => {
    const p = event('BOLETO_D_MINUS_1'); p.dueDate = '2027-01-01';
    assert.equal(calendar(p, Date.parse('2027-01-01T02:59:00Z')), true);
    assert.equal(calendar(p, Date.parse('2027-01-01T03:00:00Z')), false);
    p.dueDate = '2028-03-01'; assert.equal(calendar(p, Date.parse('2028-02-29T12:00:00Z')), true);
});
test('SMTP financeiro desativado e pagamento sem boleto', async () => {
    const off = createSender({ sendMail: () => assert.fail('SMTP') }, {});
    await assert.rejects(off({ event: event(), pdfs: [{ content: pdf }] }));
    const p = event('BOLETO_PAYMENT_RECORDED'); let mail;
    const send = createSender({ sendMail: async m => { mail = m; return { accepted: [p.recipient] }; } }, { BILLING_EMAILS_ENABLED: 'true', EMAIL_ATIVO: 'true' });
    await send({ event: p, pdfs: [], now, access: access(p), password }); assert.equal(mail.attachments.length, 2);
    await assert.rejects(send({ event: p, pdfs: [{ content: pdf }], now, access: access(p), password }), /INVALID_PDF/);
});
test('lembrete vencido informa os acréscimos sem percentual e sem afirmar validação financeira', () => {
    const p = event('BOLETO_OVERDUE_REMINDER'), { html, texto } = render(p, Date.parse(p.scheduledFor + 'T12:00:00Z'));
    for (const part of [html, texto]) {
        assert.match(part, /pagamento após o vencimento está sujeito aos acréscimos previstos em contrato/);
        assert.doesNotMatch(part, /elegibilidade|revalidad|ao dia|juros de|multa de/i);
    }
    assert.doesNotMatch(texto, /%/); // O HTML tem larguras em %.
    assert.match(texto, /Valor da parcela: R\$/);
    for (const type of ['BOLETO_AVAILABLE', 'BOLETO_D_MINUS_1', 'BOLETO_DUE_TODAY', 'BOLETO_PAYMENT_RECORDED', 'NFSE_AVAILABLE'])
        assert.doesNotMatch(render(event(type), Date.parse('2026-11-04T12:00:00Z')).texto, /acréscimos/, type); // Data fixa: com vencimento passado, a disponibilidade informa os acréscimos (D8).
});
test('BOLETO_UPDATED exige documento de boleto, vencimento e valor', () => {
    const p = event('BOLETO_UPDATED'); assert.equal(valid(p), true);
    const same = { sha256: p.document.sha256, dueDate: p.dueDate, amountCents: p.amountCents };
    for (const change of [{ dueDate: null }, { amountCents: null }, { amountCents: 0 }, { document: null }, { document: { ...p.document, kind: 'nfse' } }, { transitionId: 'b'.repeat(64) },
        { previous: same }, { previous: { ...same, dueDate: null } }, { previous: { ...same, amountCents: null } }, { previous: null }, { previous: { ...same, sha256: 'x' } }, { previous: { ...same, dueDate: 'ontem', amountCents: 1 } }, { previous: { ...same, amountCents: -1 } }, { previous: { ...same, extra: 1, amountCents: 1 } }]) {
        const q = { ...p, ...change }; q.eventId = eventId(q); assert.equal(valid(q), false, JSON.stringify(change));
    }
});
test('a identidade do evento acompanha conteúdo, vencimento e valor, não o anexo', () => {
    const p = event();
    assert.notEqual(eventId({ ...p, amountCents: 1 }), p.eventId); assert.notEqual(eventId({ ...p, dueDate: '2026-12-01' }), p.eventId);
    assert.notEqual(eventId({ ...p, document: { ...p.document, sha256: 'f'.repeat(64) } }), p.eventId);
    assert.equal(eventId({ ...p, document: { ...p.document, id: 'attGGGGGGGGGGGGGG' } }), p.eventId);
});
test('boleto atualizado orienta a usar somente a versão anexa, sem percentual', () => {
    const p = event('BOLETO_UPDATED'), { assunto, html, texto } = render(p, Date.parse('2026-11-04T12:00:00Z'));
    assert.match(assunto, /Boleto atualizado/);
    const paragraphs = ['Informamos que o boleto referente à sua parcela foi atualizado.',
        'A versão vigente segue anexa em PDF e substitui o documento anteriormente encaminhado. Utilize exclusivamente o documento atualizado para pagamento.',
        'Caso o vencimento já tenha ocorrido, aplicam-se os acréscimos previstos em contrato.',
        'Se o pagamento já foi realizado, desconsidere esta comunicação. Em caso de dúvidas, entre em contato com nossa equipe financeira.'];
    for (const text of paragraphs) { assert.ok(texto.includes(`\n\n${text}\n\n`), text); assert.ok(html.includes(`<p style="font-size:15px;line-height:1.7">${text}</p>`), text); }
    assert.doesNotMatch(texto, /%|juros de|multa de/i);
});
test('o campo previous só existe em BOLETO_UPDATED e integra a identidade', () => {
    const a = event(); a.previous = { sha256: 'd'.repeat(64), dueDate: null, amountCents: null }; assert.equal(valid(a), false);
    const p = event('BOLETO_UPDATED'), q = { ...p, previous: { ...p.previous, sha256: 'e'.repeat(64) } };
    assert.notEqual(eventId(q), p.eventId); assert.equal(valid(q), false, 'previous alterado invalida o eventId assinado');
});
test('dados alterados com o mesmo PDF: descreve só o que mudou e não anuncia documento novo', () => {
    const base = event('BOLETO_UPDATED'), at = Date.parse('2026-11-04T12:00:00Z');
    const build = previous => { const p = { ...base, previous: { sha256: base.document.sha256, dueDate: base.dueDate, amountCents: base.amountCents, ...previous } }; p.eventId = eventId(p); assert.equal(valid(p), true); return render(p, at); };
    const due = build({ dueDate: '2026-10-30' }), amount = build({ amountCents: 140000 }), both = build({ dueDate: '2026-10-30', amountCents: 140000 });
    for (const { assunto, html, texto } of [due, amount, both]) {
        assert.match(assunto, /Dados do boleto atualizados/);
        for (const part of [html, texto]) { assert.match(part, /sem alteração do arquivo/); assert.doesNotMatch(part, /substitui|documento atualizado|versão vigente|Boleto atualizado/); }
        assert.doesNotMatch(texto, /%|juros de|multa de/i);
    }
    assert.match(due.texto, /Vencimento: de 30\/10\/2026 para 05\/11\/2026\./); assert.doesNotMatch(due.texto, /Valor da parcela: de/);
    assert.match(amount.texto, /Valor da parcela: de R\$\s1\.400,00 para R\$\s1\.500,50\./); assert.doesNotMatch(amount.texto, /Vencimento: de/);
    assert.match(both.texto, /Vencimento: de/); assert.match(both.texto, /Valor da parcela: de/);
});
test('PDF alterado usa o texto de substituição, mesmo que os dados também mudem', () => {
    const base = event('BOLETO_UPDATED'), p = { ...base, previous: { sha256: 'd'.repeat(64), dueDate: '2026-10-30', amountCents: 140000 } }; p.eventId = eventId(p);
    const { assunto, texto } = render(p, Date.parse('2026-11-04T12:00:00Z'));
    assert.match(assunto, /\| Boleto atualizado \|/); assert.match(texto, /substitui o documento anteriormente encaminhado/); assert.doesNotMatch(texto, /sem alteração do arquivo|: de /);
});
test('as duas variantes têm o mesmo layout: só muda o texto', () => {
    const base = event('BOLETO_UPDATED'), same = { ...base, previous: { sha256: base.document.sha256, dueDate: '2026-10-30', amountCents: base.amountCents } }; same.eventId = eventId(same);
    const shell = html => html.replace(/<h1[^>]*>.*?<\/h1>/, '').replace(/<p style="font-size:15px;line-height:1\.7">.*?<\/p>/g, '').replace(/<div style="display:none[^>]*>.*?<\/div>/, '');
    assert.equal(shell(render(same, now).html), shell(render(base, now).html));
});
test('boleto atualizado passa pelo receptor e anexa o PDF', async t => {
    const s = setup(t), p = event('BOLETO_UPDATED');
    const r = await s.post(p); assert.equal(r.status, 200); assert.equal(s.messages.length, 1);
    assert.equal((await s.post(p)).body.code, 'ALREADY_SENT'); assert.equal(s.messages.length, 1);
});
test('D5: contrato Inadimplente é aceito na prova; outros status continuam recusados', async t => {
    for (const type of ['BOLETO_AVAILABLE', 'BOLETO_UPDATED', 'NFSE_AVAILABLE', 'BOLETO_PAYMENT_RECORDED']) {
        const s = setup(t, { proof: { contractStatus: 'Inadimplente' }, event: event(type) }); const r = await s.post(event(type));
        assert.equal(r.body.code, 'SENT', type); assert.equal(s.messages.length, 1);
    }
    for (const contractStatus of ['Cancelado', 'Suspenso', 'Outro']) {
        const s = setup(t, { proof: { contractStatus } }); assert.equal((await s.post(event())).body.code, 'PORTAL_VALIDATION_FAILED'); assert.equal(s.messages.length, 0);
    }
});
test('D6: fora da janela o receptor não consulta o Portal nem envia, e o evento continua utilizável', async t => {
    for (const time of ['00:01', '07:59', '18:00', '23:59']) {
        let portal = 0; const at = Date.parse(`2026-11-04T${time}:00-03:00`), base = setup(t, { now: at });
        const counted = createReceiver({ config: base.config, send: base.send, clock: () => at, fetcher: async (...a) => { portal++; return base.fetcher(...a); } });
        const r = await base.post(event(), counted);
        assert.equal(r.status, 503, time); assert.equal(r.body.code, 'OUTSIDE_SEND_WINDOW'); assert.equal(portal, 0); assert.equal(base.messages.length, 0);
        const open = Date.parse('2026-11-04T08:00:00-03:00'); const later = setup(t, { now: open });
        assert.equal((await later.post(event())).body.code, 'SENT');
    }
});
test('D6: a janela vence logo antes do SMTP, sem gravar envio', async t => {
    let at = Date.parse('2026-11-04T17:59:59-03:00'), calls = 0; const close = Date.parse('2026-11-04T18:00:00-03:00');
    const base = setup(t, { now: at });
    const receiver = createReceiver({ config: base.config, send: base.send, credentials: base.credentials, clock: () => at, fetcher: async (...a) => { const r = await base.fetcher(...a); if (++calls === 3) at = close; return r; } });
    const r = await base.post(event(), receiver);
    assert.equal(r.body.code, 'OUTSIDE_SEND_WINDOW'); assert.equal(base.messages.length, 0);
    const store = new Store(base.config.directory); assert.equal(store.read('sending:' + event().eventId), null);
});
test('D6: janela usa São Paulo, inclui fins de semana e não muda nas datas de borda', () => {
    const { withinWindow, nextOpening } = require('../billing/contract');
    assert.equal(withinWindow(Date.parse('2026-11-08T12:00:00Z')), true); assert.equal(withinWindow(Date.parse('2026-11-08T11:00:00Z')), true); assert.equal(withinWindow(Date.parse('2026-11-08T10:59:00Z')), false);
    assert.equal(withinWindow(Date.parse('2026-11-08T21:00:00Z')), false); assert.equal(nextOpening(Date.parse('2026-11-08T21:00:00Z')), Date.parse('2026-11-09T11:00:00Z'));
});
test('D8: disponibilidade informa vencimento passado e acréscimos, sem percentual', () => {
    const p = event(), late = render(p, Date.parse('2026-11-08T12:00:00Z'));
    for (const part of [late.html, late.texto]) assert.match(part, /O vencimento desta parcela ocorreu em 05\/11\/2026\. Aplicam-se os acréscimos previstos em contrato\./);
    assert.doesNotMatch(late.texto, /%|juros de|multa de/i); assert.doesNotMatch(late.texto, /Prazo restante/);
    for (const at of ['2026-11-04T12:00:00Z', '2026-11-05T12:00:00Z']) assert.doesNotMatch(render(p, Date.parse(at)).texto, /acréscimos|ocorreu em/);
    const none = { ...p, dueDate: null }; none.eventId = eventId(none); assert.doesNotMatch(render(none, Date.parse('2026-11-08T12:00:00Z')).texto, /ocorreu em/);
    assert.match(render(p, Date.parse('2026-11-05T12:00:00Z')).texto, /Prazo restante nesta data: Vence hoje/);
    assert.match(render(p, Date.parse('2026-11-04T12:00:00Z')).texto, /Prazo restante nesta data: 1 dia/);
});

// D9: contato financeiro opcional, só neste serviço.
const CONTACT = 'contato@example.test';
const senderEnv = { BILLING_EMAILS_ENABLED: 'true', EMAIL_ATIVO: 'true' };
const sendWith = async (env, p = event()) => {
    let mail; const send = createSender({ sendMail: async m => { mail = m; return { accepted: [p.recipient], rejected: [] }; } }, { ...senderEnv, ...env });
    await send({ event: p, pdfs: [{ content: pdf }], now, access: access(p), password }); return mail;
};
const paymentAware = type => type === 'BOLETO_PAYMENT_RECORDED' ? { event: event(type), pdfs: [] } : { event: event(type), pdfs: [{ content: pdf }] };
test('D9: sem configuração o comportamento não muda', async () => {
    for (const env of [{}, { BILLING_FINANCE_CONTACT_EMAIL: '' }, { BILLING_FINANCE_CONTACT_EMAIL: '   ' }]) {
        const mail = await sendWith(env);
        assert.equal(Object.hasOwn(mail, 'replyTo'), false); assert.doesNotMatch(mail.text, /Contato financeiro/); assert.doesNotMatch(mail.html, /Contato financeiro/);
        assert.equal(mail.html, render(event(), now, access(event()), null, password).html); assert.equal(mail.text, render(event(), now, access(event()), null, password).texto);
    }
});
test('D9: configurado, vira Reply-To e aparece em todos os templates financeiros', async () => {
    for (const type of EVENTS) {
        let mail; const { event: p, pdfs } = paymentAware(type);
        const send = createSender({ sendMail: async m => { mail = m; return { accepted: [p.recipient], rejected: [] }; } }, { ...senderEnv, BILLING_FINANCE_CONTACT_EMAIL: ' ' + CONTACT + ' ' });
        await send({ event: p, pdfs, now, access: access(p), password });
        assert.equal(mail.replyTo, CONTACT, type); assert.equal(mail.to, p.recipient); assert.equal(mail.from, 'ITR Engenharia <naoresponda@itr.eng.br>');
        assert.match(mail.text, /Contato financeiro: contato@example\.test/, type);
        assert.match(mail.html, /Contato financeiro: <a href="mailto:contato%40example\.test"[^>]*>contato@example\.test<\/a>/, type);
    }
});
test('D9: a variante só de dados também traz o contato, e o layout não muda além da linha', () => {
    const base = event('BOLETO_UPDATED'), p = { ...base, previous: { sha256: base.document.sha256, dueDate: '2026-10-30', amountCents: base.amountCents } }; p.eventId = eventId(p);
    const without = render(p, now), withContact = render(p, now, null, CONTACT);
    assert.match(withContact.texto, /Dados|dados/); assert.match(withContact.texto, /Contato financeiro: contato@example\.test/);
    assert.equal(withContact.html.replace(/<p style="font-size:14px;line-height:1\.7">Contato financeiro:.*?<\/p>/, ''), without.html);
});
test('D9: valores indevidos são recusados antes do SMTP e impedem a subida do serviço', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const outside = path.join(directory, 'recibos'); fs.mkdirSync(outside);
    const base = { BILLING_EMAILS_ENABLED: 'true', BILLING_RECEIPTS_DIRECTORY: outside, BILLING_HMAC_SECRET: secret, BILLING_PORTAL_ORIGIN: 'https://portal.example.test', EMAIL_ATIVO: 'true' };
    assert.equal(configuration(base).enabled, true); assert.equal(configuration({ ...base, BILLING_FINANCE_CONTACT_EMAIL: CONTACT }).enabled, true);
    for (const bad of ['financeiro', 'a@b', 'a@b.c\r\nBcc: x@y.test', 'a@b.c\nBcc: x@y.test', 'Maiuscula@example.test', 'a@example.test,b@example.test', 'a@example.test;b@example.test', 'a b@example.test', '<a@example.test>', 'ITR <a@example.test>', 'a@example.test b', 'x'.repeat(250) + '@example.test']) {
        await assert.rejects(sendWith({ BILLING_FINANCE_CONTACT_EMAIL: bad }), /INVALID_BILLING_CONFIGURATION/, bad);
        assert.throws(() => configuration({ ...base, BILLING_FINANCE_CONTACT_EMAIL: bad }), /INVALID_BILLING_CONFIGURATION/, bad);
        assert.throws(() => render(event(), now, null, bad), /INVALID_BILLING_CONFIGURATION/, bad);
    }
});
test('D9: o endereço é escapado no HTML', () => {
    const { html } = render(event(), now, null, "a'b&c@example.test");
    assert.match(html, />a&#39;b&amp;c@example\.test</); assert.doesNotMatch(html, /a'b&c@/);
});
test('D9: o contato não entra no contrato nem nos e-mails comerciais', () => {
    const { valid: v } = require('../billing/contract'), p = event(); assert.equal(v({ ...p, contact: CONTACT }), false);
    for (const file of ['enviar_email.js', 'email_template.js', 'access_email_template.js', 'security_email_template.js', 'integridade_email_template.js', 'billing/contract.js', 'billing/protocol.js'])
        assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /BILLING_FINANCE_CONTACT|Contato financeiro/, file);
});
test('D9: o exemplo documenta a variável sem endereço', () => {
    const line = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8').split(/\r?\n/).find(l => l.startsWith('BILLING_FINANCE_CONTACT_EMAIL'));
    assert.equal(line, 'BILLING_FINANCE_CONTACT_EMAIL=');
});
test('D9: fluxo do receptor entrega o contato ao envio sem alterar o evento', async t => {
    let mail; const p = event();
    const send = createSender({ sendMail: async m => { mail = m; return { accepted: [p.recipient], rejected: [] }; } }, { ...senderEnv, BILLING_FINANCE_CONTACT_EMAIL: CONTACT });
    const s = setup(t, { send }); assert.equal((await s.post(p)).body.code, 'SENT');
    assert.equal(mail.replyTo, CONTACT); assert.equal(valid(p), true);
});
