'use strict';
const { hash, canonical } = require('./protocol');
const EVENTS = Object.freeze(['BOLETO_AVAILABLE', 'BOLETO_D_MINUS_1', 'BOLETO_DUE_TODAY', 'BOLETO_OVERDUE_REMINDER', 'BOLETO_PAYMENT_RECORDED', 'NFSE_AVAILABLE']);
const MAX_PDF = 10 * 1024 * 1024;
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const id = x => typeof x === 'string' && /^rec[A-Za-z0-9]{14}$/.test(x);
const label = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 120 && !/[\x00-\x1f\x7f]/.test(x);
const email = x => typeof x === 'string' && x === x.toLowerCase() && x.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(x);
function exact(o, keys) { return o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k)); }
function date(x) { return typeof x === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x; }
function today(now) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); }
function eventId(p) {
    // Availability is content-based: attachment URL/ID changes do not trigger a resend.
    const version = p.type === 'BOLETO_PAYMENT_RECORDED' ? p.transitionId : p.document?.sha256;
    const key = [1, p.type, p.clientId, p.contractId, p.invoiceId, p.recipient, version,
        /MINUS|TODAY|OVERDUE/.test(p.type) ? p.dueDate : null];
    if (p.type === 'BOLETO_OVERDUE_REMINDER') key.push(p.scheduledFor);
    return hash(canonical(key));
}
function recurring(p) {
    if (!date(p.dueDate) || !date(p.scheduledFor)) return false;
    const days = (Date.parse(p.scheduledFor) - Date.parse(p.dueDate)) / 86400000;
    return days > 0 && days % 5 === 0;
}
// Only consume this context from a verified Portal proof, never from the event.
function validAccess(access, p) {
    return exact(access, ['clientId', 'recipient', 'cnpj']) && access.clientId === p.clientId &&
        access.recipient === p.recipient && typeof access.cnpj === 'string' && /^\d{14}$/.test(access.cnpj);
}
function valid(p) {
    const keys = ['protocol', 'eventId', 'type', 'recipient', 'clientId', 'proposalId', 'contractId', 'invoiceId', 'contractName', 'installment', 'amountCents', 'dueDate', 'stateVersion', 'transitionId', 'document'];
    if (p?.type === 'BOLETO_OVERDUE_REMINDER') keys.push('scheduledFor');
    if (!exact(p, keys) ||
        p.protocol !== 'itr-billing-v1' || !EVENTS.includes(p.type) || !email(p.recipient) ||
        ![p.clientId, p.proposalId, p.contractId, p.invoiceId].every(id) || !label(p.contractName) || !label(p.installment) ||
        !(p.amountCents === null || Number.isSafeInteger(p.amountCents) && p.amountCents >= 0) ||
        !(p.dueDate === null || date(p.dueDate)) || !hex(p.stateVersion)) return false;
    if (/MINUS|TODAY|OVERDUE/.test(p.type) && !date(p.dueDate)) return false;
    if (p.type === 'BOLETO_OVERDUE_REMINDER' && !recurring(p)) return false;
    if (p.type === 'BOLETO_PAYMENT_RECORDED') {
        if (p.document !== null || !hex(p.transitionId)) return false;
    } else {
        const d = p.document;
        if (p.transitionId !== null || !exact(d, ['id', 'kind', 'version', 'sha256', 'size']) ||
            !/^att[A-Za-z0-9]{14}$/.test(d.id || '') || d.kind !== (p.type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto') ||
            !hex(d.version) || !hex(d.sha256) || !Number.isInteger(d.size) || d.size < 5 || d.size > MAX_PDF) return false;
    }
    return hex(p.eventId) && p.eventId === eventId(p);
}
function calendar(p, now) {
    if (!EVENTS.includes(p.type)) return false;
    if (p.type === 'BOLETO_OVERDUE_REMINDER') return recurring(p) && p.scheduledFor === today(now);
    const delta = { BOLETO_D_MINUS_1: 1, BOLETO_DUE_TODAY: 0 }[p.type];
    return delta === undefined || (Date.parse(p.dueDate) - Date.parse(today(now))) / 86400000 === delta;
}
module.exports = { EVENTS, MAX_PDF, valid, eventId, date, today, calendar, email, validAccess };
