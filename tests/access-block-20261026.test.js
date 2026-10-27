'use strict';

// Bloco "Acesso ao Portal do Cliente" (pedido comercial de 26/10/2026):
// NEW, ACCEPTED e INVOICE mostram CNPJ e, se confirmada, a senha vigente;
// sem confirmação mostram só o CNPJ — nunca o texto de recuperação.
// VERIFY nunca mostra bloco de acesso nem senha.

const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../proposals/template');

const origin = 'https://portal.example.test';
const snapshot = { version: 'a'.repeat(64), pdfHash: 'b'.repeat(64), attachmentId: 'attAAAAAAAAAAAAAA', filename: 'P.pdf',
    proposal: { id: 'recAAAAAAAAAAAAAA', cnpj: '4373675200120', numero: '07', valor: 900, nomeContato: 'Ana' } };
const invoice = { id: 'recNFNFNFNFNFNFNF', contractId: 'recCTCTCTCTCTCTCT', contractName: 'Contrato 7', documentVersion: 'c'.repeat(64),
    parcela: '1/2', vencimento: '2026-11-10', attachments: [{ id: 'attNFNFNFNFNFNFNF', tipo: 'nfse', sha256: 'd'.repeat(64), filename: 'NF.pdf' }] };
const payloads = {
    NEW: { type: 'NEW', snapshot },
    ACCEPTED: { type: 'ACCEPTED', snapshot, documentHash: 'e'.repeat(64) },
    INVOICE: { type: 'INVOICE', snapshot, invoice },
};
const RECOVERY = /Para obter seus dados|recuperação de acesso|Recupere seus dados/;

for (const [type, payload] of Object.entries(payloads)) {
    test(`${type}: CNPJ + senha confirmada; sem confirmação, só CNPJ`, () => {
        const shown = render(payload, origin, { password: 'EXT437367' });
        assert.match(shown.html, /CNPJ: 4373675200120<br><strong>Senha:<\/strong> EXT437367<br>Mantenha estes dados protegidos\./);
        assert.match(shown.texto, /CNPJ: 4373675200120\nSenha: EXT437367/);
        const hidden = render(payload, origin);
        assert.match(hidden.html, /CNPJ: 4373675200120<\/td>/);
        assert.match(hidden.texto, /CNPJ: 4373675200120\n/);
        for (const out of [shown.html, shown.texto, hidden.html, hidden.texto]) assert.doesNotMatch(out, RECOVERY);
        assert.doesNotMatch(hidden.html + hidden.texto, /Senha/);
        assert.match(shown.html, new RegExp(type === 'ACCEPTED' ? '<strong>Dados de acesso</strong>' : '<strong>Acesso ao Portal do Cliente</strong>'));
        assert.match(shown.html, /cid:portalCta/);
    });
}

test('VERIFY: sem bloco de acesso, sem senha, mesmo se recebida por engano', () => {
    const message = render({ type: 'VERIFY', snapshot, code: '00012345', expiresAt: Date.now() + 7200000 }, origin, { password: 'EXT437367' });
    assert.doesNotMatch(message.html + message.texto, /EXT437367|Senha|Acesso ao Portal do Cliente|CNPJ: /);
    assert.match(message.texto, /Seu código de aceite: 00012345/);
});
