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
// The ten homologation scenarios: package name, official preview name, event type and the day it is seen.
const SCENARIOS = Object.freeze([
    ['01_BOLETO_DISPONIVEL', 'BOLETO_AVAILABLE', 'BOLETO_AVAILABLE', '2026-11-04'],
    ['02_BOLETO_JA_VENCIDO', 'BOLETO_AVAILABLE_VENCIDO', 'BOLETO_AVAILABLE', '2026-11-08'],
    ['03_BOLETO_D_MENOS_1', 'BOLETO_D_MINUS_1', 'BOLETO_D_MINUS_1', '2026-11-04'],
    ['04_BOLETO_D0', 'BOLETO_DUE_TODAY', 'BOLETO_DUE_TODAY', '2026-11-05'],
    ['05_BOLETO_D_MAIS_5', 'BOLETO_OVERDUE_REMINDER', 'BOLETO_OVERDUE_REMINDER', '2026-11-10'],
    ['06_BOLETO_D_MAIS_10', 'BOLETO_OVERDUE_REMINDER_D10', 'BOLETO_OVERDUE_REMINDER', '2026-11-15'],
    ['07_BOLETO_PDF_ATUALIZADO', 'BOLETO_UPDATED', 'BOLETO_UPDATED', '2026-11-04'],
    ['08_DADOS_BOLETO_ATUALIZADOS', 'BOLETO_UPDATED_DADOS', 'BOLETO_UPDATED', '2026-11-04'],
    ['09_PAGAMENTO_REGISTRADO', 'BOLETO_PAYMENT_RECORDED', 'BOLETO_PAYMENT_RECORDED', '2026-11-04'],
    ['10_NFSE_DISPONIVEL', 'NFSE_AVAILABLE', 'NFSE_AVAILABLE', '2026-11-04'],
]);
function scenarios(recipient = 'financeiro@example.test') {
    return SCENARIOS.map(([id, preview, type, day]) => {
        const p = event(type); p.recipient = recipient;
        if (type === 'BOLETO_OVERDUE_REMINDER') p.scheduledFor = day;
        if (preview === 'BOLETO_UPDATED_DADOS') p.previous = { sha256: p.document.sha256, dueDate: '2026-10-30', amountCents: 140000 };
        p.eventId = eventId(p);
        return { id, preview, event: p, now: Date.parse(`${day}T12:00:00Z`) };
    });
}
// Synthetic password in the format the Portal accepts; previews and tests only.
const password = 'EX123456';
module.exports = { event, pdf, access, password, scenarios };
