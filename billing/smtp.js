'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { valid, email } = require('./contract');
const { hash } = require('./protocol');
const { render } = require('./template');
// Optional and configured only here: never part of the event or of the Portal contract.
function financeContact(env = process.env) {
    const value = String(env.BILLING_FINANCE_CONTACT_EMAIL || '').trim();
    if (!value) return null;
    if (!email(value)) throw new Error('INVALID_BILLING_CONFIGURATION');
    return value;
}
// Same source as the accepted-proposal e-mail, never part of the event, proof or receipts. The receiver has already
// recorded the start of SMTP here, so a failed lookup must not stop the notice: the block keeps only the CNPJ.
async function accessPassword(resolve, access, limit) {
    if (!resolve || !access) return null;
    let reason = 'ACCESS_NOT_CONFIRMED', timer;
    try {
        const password = await Promise.race([
            resolve(access.cnpj, access.recipient, { onDecision: code => { reason = code; } }),
            new Promise((_, reject) => { timer = setTimeout(reject, limit, new Error('ACCESS_LOOKUP_TIMEOUT')); }),
        ]);
        if (typeof password === 'string' && password.trim() && !/[\r\n]/.test(password)) return password;
    } catch (error) {
        if (error?.message === 'ACCESS_LOOKUP_TIMEOUT') reason = error.message;
    } finally { clearTimeout(timer); }
    console.warn(`[FINANCEIRO] ${/^[A-Z_]+$/.test(reason) ? reason : 'ACCESS_NOT_CONFIRMED'}: e-mail sem a linha de senha.`);
    return null;
}
function createSender(transport, env = process.env, resolveAccess = null, lookupLimit = 5000) {
    return async ({ event, pdfs, now, access = null }) => {
        if (env.BILLING_EMAILS_ENABLED !== 'true' || env.EMAIL_ATIVO !== 'true' || String(env.EMAIL_MODO_TESTE || '').trim() || !valid(event)) throw new Error('BILLING_SMTP_DISABLED');
        if (!Array.isArray(pdfs) || pdfs.length !== (event.document ? 1 : 0) || pdfs.some(p => !Buffer.isBuffer(p.content) || p.content.length !== event.document.size || hash(p.content) !== event.document.sha256 || p.content.subarray(0, 5).toString() !== '%PDF-')) throw new Error('INVALID_PDF');
        const contact = financeContact(env), password = await accessPassword(resolveAccess, access, lookupLimit), message = render(event, now, access, contact, password);
        const attachments = ['logo.png', 'portal-cta.png'].map((name, i) => ({ filename: name,
            content: fs.readFileSync(path.join(__dirname, '..', 'assets', name)), cid: i ? 'portalCta' : 'logoITR', contentDisposition: 'inline' }));
        attachments.push(...pdfs.map(p => ({ content: p.content, filename: event.document.kind === 'nfse' ? 'NFSe.pdf' : 'Boleto.pdf', contentType: 'application/pdf', contentDisposition: 'attachment' })));
        const info = await transport.sendMail({ from: String(env.EMAIL_REMETENTE || '').trim() || 'ITR Engenharia <naoresponda@itr.eng.br>', to: event.recipient, ...(contact ? { replyTo: contact } : {}),
            subject: message.assunto, html: message.html, text: message.texto, attachments,
            messageId: `<billing-${event.eventId}@itr.eng.br>`, disableFileAccess: true, disableUrlAccess: true });
        return { ok: info.accepted?.length === 1 && String(info.accepted[0]).toLowerCase() === event.recipient && !info.rejected?.length };
    };
}
module.exports = { createSender, financeContact };
