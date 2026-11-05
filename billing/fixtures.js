'use strict';
const { hash } = require('./protocol');
const { eventId } = require('./contract');
const pdf = Buffer.from('%PDF-1.4\n% Documento ficticio, sem valor fiscal\n%%EOF');
function event(type = 'BOLETO_AVAILABLE') {
    const p = { protocol: 'itr-billing-v1', type, eventId: '', recipient: 'financeiro@example.test',
        clientId: 'recAAAAAAAAAAAAAA', proposalId: 'recBBBBBBBBBBBBBB', contractId: 'recCCCCCCCCCCCCCC', invoiceId: 'recDDDDDDDDDDDDDD',
        contractName: 'C-EXEMPLO', installment: 'Parcela Única', amountCents: 150050, dueDate: '2026-11-05', stateVersion: 'a'.repeat(64),
        transitionId: type === 'BOLETO_PAYMENT_RECORDED' ? 'b'.repeat(64) : null,
        document: type === 'BOLETO_PAYMENT_RECORDED' ? null : { id: 'attEEEEEEEEEEEEEE', kind: type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto', version: 'c'.repeat(64), sha256: hash(pdf), size: pdf.length } };
    if (type === 'BOLETO_OVERDUE_REMINDER') p.scheduledFor = '2026-11-10';
    if (type === 'BOLETO_UPDATED') p.previous = { sha256: 'd'.repeat(64), dueDate: p.dueDate, amountCents: p.amountCents };
    p.eventId = eventId(p); return p;
}
// Synthetic access identity for previews/tests only; never loaded by the receiver.
const access = p => ({ clientId: p.clientId, recipient: p.recipient, cnpj: '12345678000195' });
module.exports = { event, pdf, access };
