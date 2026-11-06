'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main, generate, scenario, NOTICE } = require('../scripts/billing-homologacao');
const { scenarios, access } = require('../billing/fixtures');
const { render } = require('../billing/template');
const TO = 'homologacao@example.test';
const ARGS = ['--enviar', '--cenario=01_BOLETO_DISPONIVEL', `--destinatario=${TO}`];
const ENV = { BILLING_HOMOLOGACAO_DESTINATARIO: TO };
const quiet = () => {};
function fakeSmtp() {
    const sent = []; let opened = 0;
    return { sent, opened: () => opened, create: () => { opened++; return { sendMail: async m => { sent.push(m); return { accepted: [m.to], rejected: [] }; }, close() {} }; } };
}
test('os dez cenários seguem completos, com nomes e eventos válidos', () => {
    const list = scenarios();
    assert.equal(new Set(list.map(s => s.id)).size, 10);
    for (const { id } of list) assert.equal(scenario(id, TO).event.recipient, TO);
    const data = scenario('08_DADOS_BOLETO_ATUALIZADOS', TO).event;
    assert.equal(data.previous.sha256, data.document.sha256);
});
test('o pacote traz dez prévias marcadas e os dois PDFs fictícios; o template oficial não tem a marca', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-homologacao-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const files = generate(path.join(directory, 'pacote'));
    assert.equal(files.filter(f => f.endsWith('.html')).length, 10);
    assert.equal(files.filter(f => f.endsWith('.pdf')).length, 2);
    for (const f of files.filter(f => f.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(directory, 'pacote', f), 'utf8');
        assert.ok(html.includes(NOTICE)); assert.match(html, /Dados de acesso/); assert.match(html, /12\.345\.678\/0001-95/); assert.match(html, /<strong>Senha:<\/strong> EX123456/); assert.doesNotMatch(html, /cid:/);
    }
    const p = scenarios()[0];
    assert.doesNotMatch(render(p.event, p.now, access(p.event)).html, /HOMOLOGA/i);
    assert.throws(() => generate(path.join(directory, 'pacote')), /PASTA_NAO_VAZIA/);
});
test('sem confirmação nenhuma conexão SMTP é aberta', async () => {
    const smtp = fakeSmtp();
    assert.equal(await main(ARGS, ENV, smtp.create, quiet), 'SIMULADO');
    assert.equal(await main([], ENV, smtp.create, quiet), 'AJUDA');
    assert.equal(smtp.opened(), 0);
});
test('o envio é bloqueado em testes e sem o destinatário confirmado', async () => {
    const smtp = fakeSmtp(), real = [...ARGS, '--confirmar-envio-real'];
    await assert.rejects(main(real, { ...ENV, NODE_TEST_CONTEXT: 'child-v8' }, smtp.create, quiet), /ENVIO_BLOQUEADO_EM_TESTES/);
    await assert.rejects(main(real, { ...ENV, NODE_ENV: 'test' }, smtp.create, quiet), /ENVIO_BLOQUEADO_EM_TESTES/);
    await assert.rejects(main(real, {}, smtp.create, quiet), /DESTINATARIO_NAO_CONFIRMADO/);
    await assert.rejects(main(real, { BILLING_HOMOLOGACAO_DESTINATARIO: 'outra@example.test' }, smtp.create, quiet), /DESTINATARIO_NAO_CONFIRMADO/);
    const two = `${TO},outra@example.test`;
    await assert.rejects(main(['--enviar', '--cenario=01_BOLETO_DISPONIVEL', `--destinatario=${two}`, '--confirmar-envio-real'], { BILLING_HOMOLOGACAO_DESTINATARIO: two }, smtp.create, quiet), /DESTINATARIO_INVALIDO/);
    await assert.rejects(main(['--enviar', '--cenario=NAO_EXISTE', `--destinatario=${TO}`, '--confirmar-envio-real'], ENV, smtp.create, quiet), /CENARIO_INVALIDO/);
    assert.equal(smtp.opened(), 0);
});
test('com confirmação envia uma única mensagem marcada ao destinatário controlado', async () => {
    const smtp = fakeSmtp();
    assert.equal(await main([...ARGS, '--confirmar-envio-real'], ENV, smtp.create, quiet), 'ENVIADO');
    assert.equal(smtp.sent.length, 1);
    const m = smtp.sent[0];
    assert.equal(m.to, TO); assert.equal(m.cc, undefined); assert.equal(m.bcc, undefined); assert.equal(m.replyTo, undefined);
    assert.match(m.subject, /^\[HOMOLOGAÇÃO\] ITR Engenharia/); assert.ok(m.html.includes(NOTICE)); assert.ok(m.text.startsWith(NOTICE));
    assert.match(m.messageId, /^<homologacao-/);
    assert.deepEqual(m.attachments.filter(a => a.contentType === 'application/pdf').map(a => a.filename), ['HOMOLOGACAO_Boleto.pdf']);
    assert.match(m.html, /12\.345\.678\/0001-95/); assert.match(m.html, /<strong>Senha:<\/strong> EX123456/); assert.match(m.text, /Senha: EX123456/);
});
test('a ferramenta não carrega Portal, recibos nem receptor, e a aplicação não a carrega', () => {
    const root = path.join(__dirname, '..');
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'scripts', 'billing-homologacao.js'), 'utf8'), /billing\/(receiver|store|portal)'|airtable|mysql2/);
    for (const file of ['server.js', 'enviar_todos.js', path.join('billing', 'receiver.js'), path.join('billing', 'smtp.js')]) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /billing-homologacao/);
    }
});
