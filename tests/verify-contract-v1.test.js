'use strict';

// Lado E-mails do contrato VERIFY v1 (tests/fixtures/verify-event-v1.json,
// cópia idêntica no Portal) e comportamento do receptor com recibo durável.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const contract = require('./fixtures/verify-event-v1.json');
const { valid, createReceiver, VERIFY_MAX_TTL, ACCESS_MAX_RETRIES } = require('../proposals/receiver');
const { render } = require('../proposals/template');

const origin = 'https://portal.example.test';
const example = (extra = {}) => ({ ...structuredClone(contract.example), expiresAt: Date.now() + contract.ttlMs, ...extra });

test('receptor aceita exatamente o VERIFY do contrato e rejeita variações', () => {
    assert.equal(valid(example(), origin), true);
    const reject = (payload, why) => assert.equal(valid(payload, origin), false, why);
    for (const key of contract.forbiddenKeys) reject(example({ [key]: 'x' }), key);
    reject(example({ actionUrl: `${origin}/confirmar-proposta.html#${'a'.repeat(43)}` }), 'protocolo antigo com link');
    reject(example({ code: '1234567' }), '7 dígitos');
    reject(example({ code: '123456789' }), '9 dígitos');
    reject(example({ code: 12345678 }), 'código numérico perde zeros à esquerda');
    reject(example({ code: undefined }), 'sem código');
    reject(example({ expiresAt: Date.now() + VERIFY_MAX_TTL + 60000 }), 'validade acima de 120 min');
    reject(example({ challengeId: 'x' }), 'challenge inválido');
    reject(example({ recipient: 'a@b.c,d@e.f' }), 'vários destinatários');
    reject({ ...example(), extra: 1 }, 'chave desconhecida');
    const { code, challengeId, expiresAt, ...newEvent } = example();
    reject({ ...newEvent, type: 'NEW', code }, 'código fora do VERIFY');
});

test('VERIFY renderizado traz os 8 dígitos, 120 minutos e nenhuma senha ou link inválido', () => {
    const payload = example();
    const message = render(payload, origin, { password: 'SENHA_PROIBIDA' });
    for (const out of [message.html, message.texto]) {
        assert.ok(out.includes(payload.code));
        assert.doesNotMatch(out, /SENHA_PROIBIDA|undefined|null|Confirmar aceite|confirmar-proposta/);
        assert.match(out, /2 horas/);
        assert.match(out, /120 minutos/);
        assert.match(out, /Digite este código no Portal do Cliente/);
        assert.match(out, /confirme expressamente sua decisão/);
        assert.match(out, /2026-077/);
    }
    assert.match(message.texto, new RegExp(`Seu código de aceite: ${payload.code}`));
    assert.match(message.html, /SEU CÓDIGO DE ACEITE/);
    assert.match(message.html, /horário de Brasília/);
    assert.match(message.assunto, /Código de confirmação de aceite — 2026-077/);
    assert.doesNotMatch(message.html, /Acesso ao Portal do Cliente|Dados de acesso/);
    // Escapa HTML de campos vindos do cadastro.
    const hostile = example();
    hostile.snapshot.proposal.numero = '<img src=x onerror=alert(1)>';
    assert.doesNotMatch(render(hostile, origin).html, /<img src=x/);
});

function receiver(t, { send, access } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-verify-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const sent = [];
    return { sent, directory, receiver: createReceiver({
        config: { directory, origin, secret: Buffer.alloc(32, 1).toString('base64') },
        send: send || (async (message) => { sent.push(message); return { ok: true, id: '<x@itr>' }; }),
        access: access || (async () => 'ITR123456'),
        fetcher: async () => { throw new Error('VERIFY não busca PDF'); },
    }) };
}

test('mesmo eventId reenviado não gera segundo e-mail; evento expirado nunca chega ao SMTP', async (t) => {
    const r = receiver(t);
    const payload = example();
    assert.deepEqual((await r.receiver.process(payload)).body.code, 'SENT');
    assert.deepEqual((await r.receiver.process(payload)).body.code, 'ALREADY_SENT');
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].para, 'compras@example.test');
    assert.ok(r.sent[0].texto.includes(payload.code));
    assert.deepEqual(r.sent[0].pdfs, []);
    const conflict = await r.receiver.process({ ...payload, code: '11111111' });
    assert.equal(conflict.body.code, 'EVENT_CONFLICT');
    const expired = await r.receiver.process(example({ eventId: 'e'.repeat(64), expiresAt: Date.now() - 1 }));
    assert.equal(expired.status, 422);
    assert.equal(r.sent.length, 1);
});

test('SMTP incerto não é repetido; falha antes da entrega permite nova tentativa', async (t) => {
    let mode = 'uncertain';
    const sent = [];
    const r = receiver(t, { send: async (message) => {
        if (mode === 'uncertain') throw Object.assign(new Error('socket'), { code: 'ETIMEDOUT', command: 'DATA' });
        if (mode === 'refused') throw Object.assign(new Error('451'), { responseCode: 451, command: 'RCPT TO' });
        sent.push(message); return { ok: true };
    } });
    const a = example({ eventId: 'a'.repeat(64) });
    assert.equal((await r.receiver.process(a)).body.code, 'DELIVERY_UNCERTAIN');
    mode = 'ok';
    assert.equal((await r.receiver.process(a)).body.code, 'DELIVERY_UNCERTAIN');
    assert.equal(sent.length, 0);
    mode = 'refused';
    const b = example({ eventId: 'b'.repeat(64) });
    assert.equal((await r.receiver.process(b)).body.code, 'SMTP_RETRY');
    mode = 'ok';
    assert.equal((await r.receiver.process(b)).body.code, 'SENT');
    assert.equal(sent.length, 1);
});

test('NEW: credencial confirmada aparece; indisponível adia; após o limite segue só com CNPJ', async (t) => {
    let failures = 0;
    const r = receiver(t, { access: async () => {
        failures += 1;
        throw Object.assign(new Error('ACCESS_DIRECTORY_UNAVAILABLE'), { transient: true });
    } });
    const { code, challengeId, expiresAt, ...base } = example({ eventId: 'c'.repeat(64) });
    const payload = { ...base, type: 'NEW' };
    // Para NEW o receptor busca o PDF; o teste injeta um PDF válido.
    const pdf = Buffer.from('%PDF-1.4\n');
    payload.snapshot.pdfHash = require('node:crypto').createHash('sha256').update(pdf).digest('hex');
    const withPdf = createReceiver({
        config: { directory: r.directory, origin, secret: Buffer.alloc(32, 1).toString('base64') },
        send: async (message) => { r.sent.push(message); return { ok: true }; },
        access: async (...args) => { failures += 1; throw Object.assign(new Error('x'), { transient: true }); },
        fetcher: async () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } }),
    });
    for (let i = 0; i < ACCESS_MAX_RETRIES; i++)
        assert.equal((await withPdf.process(payload)).body.code, 'ACCESS_RETRY');
    assert.equal(r.sent.length, 0);
    assert.equal((await withPdf.process(payload)).body.code, 'SENT');
    assert.equal(r.sent.length, 1);
    const mail = r.sent[0];
    assert.match(mail.html, /CNPJ: 12345678000190/);
    assert.doesNotMatch(mail.html + mail.texto, /recuperação de acesso|Recupere seus dados|Para obter seus dados/);
    assert.doesNotMatch(mail.html, /Senha:/);
    const ok = createReceiver({
        config: { directory: r.directory, origin, secret: Buffer.alloc(32, 1).toString('base64') },
        send: async (message) => { r.sent.push(message); return { ok: true }; },
        access: async () => 'ITR123456',
        fetcher: async () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } }),
    });
    assert.equal((await ok.process({ ...payload, eventId: 'd'.repeat(64) })).body.code, 'SENT');
    assert.match(r.sent[1].html, /CNPJ: 12345678000190<br><strong>Senha:<\/strong> ITR123456/);
    assert.match(r.sent[1].texto, /CNPJ: 12345678000190\nSenha: ITR123456/);
});
