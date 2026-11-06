'use strict';
// Homologação isolada dos e-mails financeiros. Usa dados fictícios e nunca acessa Portal, Airtable, MySQL, outbox ou recibos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { valid, eventId, email } = require('../billing/contract');
const { hash } = require('../billing/protocol');
const { scenarios, access, password } = require('../billing/fixtures');
const { render } = require('../billing/template');
const { createSender } = require('../billing/smtp');
const { embed } = require('../billing/preview');

const PDFS = path.join(__dirname, '..', 'billing', 'homologacao');
const PDF_FILES = Object.freeze({ boleto: 'BOLETO_FICTICIO_NAO_PAGAVEL.pdf', nfse: 'NFSE_FICTICIA_NAO_FISCAL.pdf' });
const CONFIRM = '--confirmar-envio-real';
const NOTICE = 'TESTE DE HOMOLOGAÇÃO — DADOS FICTÍCIOS, SEM VALOR FINANCEIRO OU FISCAL';
const BANNER = `<div role="note" style="background:#fff2cc;color:#8a3400;padding:18px;text-align:center;font:bold 16px Arial;border-bottom:3px solid #e49d00">${NOTICE}</div>`;

function mark(html) {
    const marked = html.replace(/<body[^>]*>/, tag => tag + BANNER);
    if (marked === html) throw new Error('HOMOLOGACAO_SEM_FAIXA');
    return marked;
}
// The event must point at the demonstrative PDF, because the official sender checks its size and hash.
function scenario(id, recipient) {
    const found = scenarios(recipient).find(s => s.id === id);
    if (!found) throw new Error('CENARIO_INVALIDO');
    const p = found.event;
    let pdfs = [];
    if (p.document) {
        const content = fs.readFileSync(path.join(PDFS, PDF_FILES[p.document.kind])), sha256 = hash(content);
        if (p.previous?.sha256 === p.document.sha256) p.previous.sha256 = sha256;
        p.document.sha256 = sha256; p.document.size = content.length; p.eventId = eventId(p);
        pdfs = [{ content }];
    }
    if (!valid(p)) throw new Error('CENARIO_INVALIDO');
    return { ...found, pdfs };
}
function generate(directory) {
    if (fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error('PASTA_NAO_VAZIA');
    fs.mkdirSync(directory, { recursive: true });
    for (const { id } of scenarios()) {
        const { event, now } = scenario(id, 'financeiro@example.test');
        fs.writeFileSync(path.join(directory, id + '.html'), embed(mark(render(event, now, access(event), null, password).html)));
    }
    for (const file of Object.values(PDF_FILES)) fs.copyFileSync(path.join(PDFS, file), path.join(directory, file));
    return fs.readdirSync(directory);
}
function checkSend(recipient, env) {
    if (env.NODE_TEST_CONTEXT || env.NODE_ENV === 'test') throw new Error('ENVIO_BLOQUEADO_EM_TESTES');
    if (!email(recipient)) throw new Error('DESTINATARIO_INVALIDO');
    if (String(env.BILLING_HOMOLOGACAO_DESTINATARIO || '').trim() !== recipient) throw new Error('DESTINATARIO_NAO_CONFIRMADO');
}
async function sendOne({ id, recipient }, env, createTransport) {
    checkSend(recipient, env);
    const { event, now, pdfs } = scenario(id, recipient);
    const transport = createTransport();
    const marked = { sendMail: message => {
        if (message.to !== recipient || message.cc || message.bcc) throw new Error('DESTINATARIO_INVALIDO');
        return transport.sendMail({ ...message, subject: `[HOMOLOGAÇÃO] ${message.subject}`, html: mark(message.html), text: `${NOTICE}\n\n${message.text}`,
            messageId: `<homologacao-${crypto.randomUUID()}@itr.eng.br>`,
            attachments: message.attachments.map(a => a.contentType === 'application/pdf' ? { ...a, filename: 'HOMOLOGACAO_' + a.filename } : a) });
    } };
    // Fixed configuration: production flags are neither read nor changed, and the finance contact stays out.
    const send = createSender(marked, { BILLING_EMAILS_ENABLED: 'true', EMAIL_ATIVO: 'true', EMAIL_REMETENTE: env.EMAIL_REMETENTE || '' });
    try { return await send({ event, pdfs, now, access: access(event), password }); } finally { transport.close?.(); }
}
async function main(argv, env, createTransport, log = console.log) {
    const option = name => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    const output = option('saida');
    if (output) { log(generate(path.resolve(output)).join('\n')); return 'GERADO'; }
    if (!argv.includes('--enviar')) { log(`Cenários:\n${scenarios().map(s => s.id).join('\n')}\n\nUso: --saida=<pasta-nova> | --enviar --cenario=<id> --destinatario=<e-mail> [${CONFIRM}]`); return 'AJUDA'; }
    const id = option('cenario'), recipient = option('destinatario');
    if (!email(recipient)) throw new Error('DESTINATARIO_INVALIDO');
    const { event, now } = scenario(id, recipient);
    log(`Assunto: [HOMOLOGAÇÃO] ${render(event, now, access(event), null, password).assunto}\nDestinatário: ${recipient}`);
    if (!argv.includes(CONFIRM)) { log(`Simulação: nada foi enviado. Para enviar, use ${CONFIRM}.`); return 'SIMULADO'; }
    const result = await sendOne({ id, recipient }, env, createTransport);
    if (!result.ok) throw new Error('ENTREGA_NAO_CONFIRMADA');
    log('Aceito pelo SMTP.');
    return 'ENVIADO';
}
if (require.main === module) {
    require('dotenv').config({ quiet: true });
    main(process.argv.slice(2), process.env, () => require('../enviar_email').obterTransporte())
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { main, sendOne, generate, scenario, mark, NOTICE };
