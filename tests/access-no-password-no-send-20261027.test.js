'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReceiver } = require('../proposals/receiver');

const origin = 'https://portal.example.test';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const hash = crypto.createHash('sha256').update(pdf).digest('hex');
function sample(type) {
    return {
        type, eventId: crypto.randomBytes(32).toString('hex'), recipient: 'a@example.test',
        snapshot: { version: 'b'.repeat(64), pdfHash: hash, attachmentId: 'attAAAAAAAAAAAAAA', filename: 'original.pdf',
            proposal: { id: 'recAAAAAAAAAAAAAA', numero: '04', cnpj: '12345678000199', nomeCliente: 'Teste', valor: 200 } },
        ...(type === 'ACCEPTED' ? { documentHash: hash } : {}),
        ...(type === 'INVOICE' ? { invoice: { id: 'recDDDDDDDDDDDDDD', contractId: 'recCCCCCCCCCCCCCC', contractName: 'Teste',
            documentVersion: 'c'.repeat(64), parcela: '1', vencimento: '2026-11-20',
            attachments: [{ id: 'attEEEEEEEEEEEEEE', tipo: 'nfse', sha256: hash, filename: 'nota.pdf' }] } } : {}),
        ...(type === 'VERIFY' ? { challengeId: '123e4567-e89b-42d3-a456-426614174000', code: '00012345', expiresAt: Date.now() + 7200000 } : {}),
    };
}
function setup(t, access) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-failclosed-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const sent = [];
    return { sent, receiver: createReceiver({
        config: { directory, origin, secret: Buffer.alloc(32, 1).toString('base64') },
        access,
        fetcher: async () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } }),
        send: async (message) => { sent.push(message); return { ok: true, id: 'smtp-mock' }; },
    }) };
}
for (const type of ['NEW', 'ACCEPTED', 'INVOICE']) {
    test(`${type}: sem senha NÃO chama SMTP; com senha confirmada reenfileira mesmo ID`, async (t) => {
        let authorized = false;
        const x = setup(t, async (...[, , options]) => {
            options?.onDecision(authorized ? 'AUTHORIZED' : 'FINANCE_RECIPIENT_NOT_AUTHORIZED');
            return authorized ? 'EX123456' : null;
        });
        const event = sample(type);
        const denied = await x.receiver.process(event);
        assert.equal(denied.status, 503);
        assert.equal(denied.body.code, 'ACCESS_NOT_CONFIRMED');
        assert.equal(x.sent.length, 0);
        authorized = true;
        assert.equal((await x.receiver.process(event)).body.code, 'SENT');
        assert.equal(x.sent.length, 1);
        assert.match(x.sent[0].html, /CNPJ: 12345678000199<br><strong>Senha:<\/strong> EX123456/);
        assert.match(x.sent[0].texto, /CNPJ: 12345678000199\nSenha: EX123456/);
        assert.equal((await x.receiver.process(event)).body.code, 'ALREADY_SENT');
        assert.equal(x.sent.length, 1);
    });
}
test('VERIFY permanece sem senha e envia normalmente', async (t) => {
    const x = setup(t, async () => { throw Error('não deve consultar credencial no VERIFY'); });
    const result = await x.receiver.process(sample('VERIFY'));
    assert.equal(result.body.code, 'SENT');
    assert.equal(x.sent.length, 1);
    assert.doesNotMatch(x.sent[0].html + x.sent[0].texto, /<strong>Senha:<\/strong>|\nSenha:/);
});
