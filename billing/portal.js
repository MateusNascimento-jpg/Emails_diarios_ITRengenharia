'use strict';
const { headers, verify, hash, canonical } = require('./protocol');
const { MAX_PDF, today, validAccess } = require('./contract');
async function read(response, limit) {
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) throw new Error('PORTAL_UNAVAILABLE');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error('BODY_TOO_LARGE'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks);
}
function createPortal(config, fetcher = fetch, clock = Date.now) {
    async function authorize(p, phase) {
        const route = '/internal/billing/v1/authorize';
        const body = canonical({ event: p, phase });
        const signed = headers(config.secret, 'POST', route, body, clock());
        const r = await fetcher(config.origin + route, { method: 'POST', body, headers: signed, redirect: 'error', signal: AbortSignal.timeout(10000) });
        const raw = await read(r, 16384);
        if (r.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
            !verify(config.secret, 'RESPONSE', route, Object.fromEntries(r.headers), raw, clock())) throw new Error('AUTH_PROOF_INVALID');
        const a = JSON.parse(raw);
        if (a.protocol !== 'itr-billing-v1' || a.requestNonce !== signed['x-itr-nonce'] || a.eventDigest !== hash(canonical(p)) ||
            a.phase !== phase || a.authorized !== true || a.eligible !== true || a.chainVerified !== true ||
            a.baselineVerified !== true || a.proposalStatus !== 'Aceita' || !['Ativo', 'Concluído', 'Inadimplente'].includes(a.contractStatus) ||
            !Number.isSafeInteger(a.checkedAt) || a.checkedAt > clock() || clock() - a.checkedAt > 5000 ||
            !Number.isSafeInteger(a.expiresAt) || a.expiresAt <= clock() || a.expiresAt > a.checkedAt + 10000) throw new Error('NOT_AUTHORIZED');
        if (!['Aguardando Emissão da NF', 'A Vencer', 'Vencido', 'Pago'].includes(a.paymentStatus)) throw new Error('OBSOLETE');
        if (a.access !== undefined && a.access !== null && !validAccess(a.access, p)) throw new Error('ACCESS_SCOPE_INVALID');
        if (p.type === 'BOLETO_PAYMENT_RECORDED') {
            if (a.paymentStatus !== 'Pago' || a.newPaymentTransition !== true) throw new Error('OBSOLETE');
        } else if (p.type !== 'NFSE_AVAILABLE') {
            if (a.paymentStatus === 'Pago' || a.collectionStopped !== false || a.documentPayable !== true) throw new Error('OBSOLETE');
            if ((a.paymentStatus === 'Vencido' || p.dueDate && p.dueDate < today(clock())) && a.payableAfterDue !== true) throw new Error('OBSOLETE');
        }
        if (phase === 'smtp' && (typeof a.leaseId !== 'string' || !/^[a-f0-9]{64}$/.test(a.leaseId))) throw new Error('LEASE_REQUIRED');
        return a;
    }
    async function document(p) {
        if (!p.document) return [];
        const d = p.document, route = `/internal/billing/v1/pdf/${p.eventId}/${d.id}`;
        const r = await fetcher(config.origin + route, { method: 'GET', headers: headers(config.secret, 'GET', route, '', clock()), redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (r.headers.get('content-type')?.split(';')[0] !== 'application/pdf' ||
            r.headers.get('x-itr-client-id') !== p.clientId || r.headers.get('x-itr-invoice-id') !== p.invoiceId ||
            r.headers.get('x-itr-document-kind') !== d.kind || r.headers.get('x-itr-document-version') !== d.version) throw new Error('DOCUMENT_SCOPE');
        const content = await read(r, MAX_PDF);
        if (content.length !== d.size || content.subarray(0, 5).toString() !== '%PDF-' || hash(content) !== d.sha256) throw new Error('DOCUMENT_INVALID');
        return [{ filename: d.kind === 'nfse' ? 'NFSe.pdf' : 'Boleto.pdf', content, contentType: 'application/pdf', contentDisposition: 'attachment' }];
    }
    return { authorize, document };
}
module.exports = { createPortal };
