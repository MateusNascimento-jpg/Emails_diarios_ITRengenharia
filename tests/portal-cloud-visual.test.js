'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../proposals/template');

test('botão nuvem em todos os eventos: imagem transparente, sem retângulo colorido atrás', () => {
    for (const type of ['NEW', 'VERIFY', 'ACCEPTED']) {
        const p = { type, snapshot: { attachmentId: 'attEEEEEEEEEEEEEE',
            proposal: { id: 'recAAAAAAAAAAAAAA', numero: '03', cnpj: '12345678000199', nomeCliente: 'Exemplo', valor: 30 } } };
        if (type === 'VERIFY') p.code = '12345678';
        const html = render(p, 'https://portal.example.test', { password: 'PROIBIDA' }).html;
        const anchor = html.match(/<a href="[^"]+" title="Acessar Portal do Cliente"[^>]+>/);
        assert.ok(anchor, 'link do Portal presente');
        assert.doesNotMatch(anchor[0], /background:|border-radius:/);
        assert.match(html, /src="cid:portalCloud"/);
        assert.match(html, /max-width:100%|width:100%/);
        if (type === 'VERIFY') assert.doesNotMatch(html, /PROIBIDA/);
    }
});
