'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { event, pdf, access } = require('../billing/fixtures');
const { EVENTS, valid, eventId, date, calendar, MAX_PDF } = require('../billing/contract');
const { headers, canonical, hash } = require('../billing/protocol');
const { createReceiver, configuration, ROUTE, register } = require('../billing/receiver');
const { render } = require('../billing/template');
const { createSender } = require('../billing/smtp');
const { Store } = require('../billing/store');
const secret = Buffer.alloc(32, 7).toString('base64');
const now = Date.parse('2026-11-04T12:00:00Z');
function setup(t, modify = {}) {
    const now = modify.now ?? Date.parse('2026-11-04T12:00:00Z');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const config = { enabled: true, directory, secret, origin: 'https://portal.example.test' };
    const messages = [];
    const fetcher = async (url, options) => {
        assert.equal(new URL(url).origin, config.origin); assert.equal(options.redirect, 'error');
        if (options.method === 'GET') {
            const p = modify.event || event();
            return new Response(modify.bytes || pdf, { status: modify.pdfStatus || 200, headers: {
                'content-type': 'application/pdf', 'x-itr-client-id': p.clientId, 'x-itr-invoice-id': p.invoiceId,
                'x-itr-document-kind': p.document.kind, 'x-itr-document-version': p.document.version, ...modify.pdfHeaders } });
        }
        const { event: p, phase } = JSON.parse(options.body);
        let proof = { protocol: 'itr-billing-v1', phase, requestNonce: options.headers['x-itr-nonce'], eventDigest: hash(canonical(p)),
            authorized: true, eligible: true, chainVerified: true, baselineVerified: true, proposalStatus: 'Aceita', contractStatus: 'Ativo',
            checkedAt: now, expiresAt: now + 5000, paymentStatus: p.type === 'BOLETO_PAYMENT_RECORDED' ? 'Pago' : 'Aguardando Emissão da NF',
            collectionStopped: false, documentPayable: true, payableAfterDue: true, newPaymentTransition: true, leaseId: 'd'.repeat(64), ...modify.proof };
        if (modify.final && phase === 'smtp') proof = { ...proof, ...modify.final };
        if (phase === 'smtp') for (const key of modify.omitFinal || []) delete proof[key];
        const raw = canonical(proof);
        return new Response(raw, { headers: { ...headers(secret, 'RESPONSE', '/internal/billing/v1/authorize', raw, now), ...modify.authHeaders } });
    };
    const send = modify.send || (async args => { messages.push(args); return { ok: true }; });
    const receiver = createReceiver({ config, fetcher, send, clock: () => now });
    const post = (p, r = receiver, h) => { const raw = Buffer.from(JSON.stringify(p)); return r.handle({ method: 'POST', path: ROUTE, headers: h || headers(secret, 'POST', ROUTE, raw, now) }, raw); };
    return { config, messages, fetcher, send, receiver, post };
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
test('todos os templates têm acesso oficial, CNPJ só com contexto validado e nenhuma senha', () => {
    for (const type of EVENTS) {
        const p = event(type), without = render(p, now), withAccess = render(p, now, access(p));
        for (const part of [without.html, without.texto, withAccess.html, withAccess.texto]) {
            assert.match(part, /Acesso ao Portal do Cliente/); assert.match(part, /https:\/\/portal\.itr\.eng\.br\/login\.html/);
            assert.doesNotMatch(part, /senha|password/i);
        }
        assert.doesNotMatch(without.html, /CNPJ:/); assert.match(withAccess.html, /12\.345\.678\/0001-95/);
        assert.match(withAccess.texto, /12\.345\.678\/0001-95/);
        assert.equal(valid({ ...p, cnpj: '12345678000195' }), false);
    }
});
test('CNPJ da prova final chega ao SMTP; prova ausente não inventa identidade', async t => {
    const p = event(); let mail;
    const sender = createSender({ sendMail: async m => { mail = m; return { accepted: [p.recipient] }; } }, { BILLING_EMAILS_ENABLED: 'true', EMAIL_ATIVO: 'true' });
    const s = setup(t, { proof: { access: access(p) }, send: sender });
    assert.equal((await s.post(p)).status, 200); assert.match(mail.html, /12\.345\.678\/0001-95/);
    const absent = setup(t, { proof: { access: access(p) }, final: { access: null }, send: sender });
    assert.equal((await absent.post(p)).status, 200); assert.doesNotMatch(mail.html, /CNPJ:/);
    const persisted = fs.readdirSync(s.config.directory).map(f => fs.readFileSync(path.join(s.config.directory, f), 'utf8')).join('');
    assert.doesNotMatch(persisted, /12345678000195|financeiro@example/);
});
test('CNPJ adulterado, vínculo errado e campos de senha na prova são rejeitados', async t => {
    const p = event();
    for (const a of [{ ...access(p), clientId: 'recZZZZZZZZZZZZZZ' }, { ...access(p), recipient: 'outro@example.test' }, { ...access(p), cnpj: '<script>' }, { ...access(p), cnpj: '12345678000195\r\n' }, { ...access(p), password: 'proibida' }]) {
        const s = setup(t, { final: { access: a } }); assert.equal((await s.post(p)).status, 503); assert.equal(s.messages.length, 0);
        assert.throws(() => render(p, now, a), /ACCESS_SCOPE_INVALID/);
    }
});
test('schema fechado, datas, CRLF e tipos inválidos', () => {
    for (const change of [{ type: 'BOLETO_UPDATED' }, { type: 'NEW' }, { protocol: 'v2' }, { recipient: 'a@example.test;b@example.test' }, { contractName: 'a\r\nBcc:x' }, { amountCents: -1 }, { dueDate: '2026-02-30' }, { url: 'https://evil.test' }, { document: null }]) assert.equal(valid({ ...event(), ...change }), false);
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
    assert.equal((await s.post({ ...p, amountCents: 1 })).body.code, 'EVENT_CONFLICT');
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
test('HTML escapado, SMTP fake MIME, sem senha ou destinatários adicionais', async () => {
    const p = event(); p.installment = '<img src=x onerror=alert(1)>'; const rendered = render(p, now);
    assert.match(rendered.html, /&lt;img/); assert.doesNotMatch(rendered.html, /<img src=x|Senha:|CNPJ:/);
    let mail;
    const send = createSender({ sendMail: async message => { mail = message; return { accepted: [p.recipient], rejected: [] }; } }, { BILLING_EMAILS_ENABLED: 'true', EMAIL_ATIVO: 'true' });
    assert.equal((await send({ event: p, pdfs: [{ content: pdf }], now })).ok, true);
    assert.equal(mail.to, p.recipient); assert.equal(mail.cc, undefined); assert.equal(mail.bcc, undefined);
    assert.equal(mail.attachments.length, 3); assert.equal(mail.disableUrlAccess, true);
    assert.equal(mail.attachments[2].filename, 'Boleto.pdf');
    assert.equal(mail.from, 'ITR Engenharia <naoresponda@itr.eng.br>');
    const configured = createSender({ sendMail: async message => { mail = message; return { accepted: [p.recipient], rejected: [] }; } }, { BILLING_EMAILS_ENABLED: 'true', EMAIL_ATIVO: 'true', EMAIL_REMETENTE: 'ITR Teste <financeiro@example.test>' });
    await configured({ event: p, pdfs: [{ content: pdf }], now });
    assert.equal(mail.from, 'ITR Teste <financeiro@example.test>', 'mesmo remetente configurado dos demais fluxos');
});
test('rota HTTP isolada, JSON bruto, autenticação e limite', async t => {
    const express = require('express'), app = express(), s = setup(t);
    register(app, express, { config: s.config, send: s.send, fetcher: s.fetcher, clock: () => now });
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
    await send({ event: p, pdfs: [], now }); assert.equal(mail.attachments.length, 2);
    await assert.rejects(send({ event: p, pdfs: [{ content: pdf }], now }));
});
