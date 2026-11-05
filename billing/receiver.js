'use strict';
const path = require('node:path');
const { hash, canonical, verify } = require('./protocol');
const { valid, calendar, withinWindow } = require('./contract');
const { Store } = require('./store');
const { createPortal } = require('./portal');
const ROUTE = '/internal/billing/v1/events';
function configuration(env = process.env) {
    if (!['true', 'false'].includes(env.BILLING_EMAILS_ENABLED || 'false')) throw new Error('INVALID_BILLING_FLAG');
    if (env.BILLING_EMAILS_ENABLED !== 'true') return { enabled: false };
    const directory = env.BILLING_RECEIPTS_DIRECTORY, secret = env.BILLING_HMAC_SECRET;
    const origin = new URL(env.BILLING_PORTAL_ORIGIN);
    const relative = directory && path.relative(path.resolve(__dirname, '..'), path.resolve(directory));
    if (!directory || !path.isAbsolute(directory) || !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) ||
        Buffer.from(secret || '', 'base64').length < 32 || origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash ||
        env.EMAIL_ATIVO !== 'true' || String(env.EMAIL_MODO_TESTE || '').trim()) throw new Error('INVALID_BILLING_CONFIGURATION');
    return { enabled: true, directory, secret, origin: origin.origin };
}
function createReceiver({ config, send, fetcher, clock = Date.now }) {
    const store = config.enabled ? new Store(config.directory) : null;
    const portal = config.enabled ? createPortal(config, fetcher, clock) : null;
    const reply = (status, code, eventId) => ({ status, body: { ok: status === 200, code, eventId } });
    async function handle(req, raw) {
        if (!config.enabled) return reply(503, 'DISABLED');
        if (!Buffer.isBuffer(raw) || raw.length > 16384) return reply(422, 'INVALID_EVENT');
        if (req.method !== 'POST' || req.path !== ROUTE || !verify(config.secret, req.method, req.path, req.headers, raw, clock())) return reply(401, 'UNAUTHORIZED');
        if (!store.create('nonce:' + req.headers['x-itr-nonce'], { at: clock() })) return reply(401, 'REPLAY');
        let p; try { p = JSON.parse(raw); } catch { return reply(422, 'INVALID_EVENT'); }
        if (!valid(p)) return reply(422, 'INVALID_EVENT');
        const digest = hash(canonical(p));
        // Serialize all recipients/events for a single installment, including paid transitions.
        const scope = canonical([p.clientId, p.contractId, p.invoiceId]);
        if (!store.lock(scope)) return reply(503, 'BUSY', p.eventId);
        try {
            const key = 'event:' + p.eventId;
            const existing = store.read(key);
            if (existing && existing.digest !== digest) return reply(409, 'EVENT_CONFLICT', p.eventId);
            if (!existing) store.create(key, { digest, at: clock() });
            if (store.read('sent:' + p.eventId)) return reply(200, 'ALREADY_SENT', p.eventId);
            if (store.read('sending:' + p.eventId)) return reply(409, 'DELIVERY_UNCERTAIN', p.eventId);
            if (p.type !== 'NFSE_AVAILABLE' && p.type !== 'BOLETO_PAYMENT_RECORDED' && store.read('stopped:' + scope)) return reply(409, 'COLLECTION_STOPPED', p.eventId);
            if (!calendar(p, clock())) return reply(409, 'OBSOLETE', p.eventId);
            if (!withinWindow(clock())) return reply(503, 'OUTSIDE_SEND_WINDOW', p.eventId);
            let pdfs, proof;
            try {
                await portal.authorize(p, 'prepare');
                pdfs = await portal.document(p);
                proof = await portal.authorize(p, 'smtp');
            } catch { return reply(503, 'PORTAL_VALIDATION_FAILED', p.eventId); }
            if (!calendar(p, clock()) || proof.expiresAt <= clock()) return reply(409, 'OBSOLETE', p.eventId);
            if (proof.paymentStatus === 'Pago') store.create('stopped:' + scope, { at: clock() });
            if (!withinWindow(clock())) return reply(503, 'OUTSIDE_SEND_WINDOW', p.eventId);
            store.create('sending:' + p.eventId, { at: clock() });
            // From this point every failure requires reconciliation, never automatic resend.
            try {
                const result = await send({ event: p, pdfs, now: clock(), access: proof.access ?? null });
                if (!result?.ok) return reply(409, 'DELIVERY_UNCERTAIN', p.eventId);
                store.create('sent:' + p.eventId, { at: clock(), digest });
                return reply(200, 'SENT', p.eventId);
            } catch { return reply(409, 'DELIVERY_UNCERTAIN', p.eventId); }
        } finally { store.unlock(scope); }
    }
    return { handle };
}
function register(app, express, options = {}) {
    const config = options.config || configuration();
    const receiver = createReceiver({ config, send: options.send || (args => require('../enviar_email').enviarFinanceiro(args)), fetcher: options.fetcher, clock: options.clock });
    // Fixed global budget, no unbounded per-IP map. Independent from existing limits.
    let minute = 0, count = 0;
    app.post(ROUTE, (req, res, next) => {
        const current = Math.floor(Date.now() / 60000);
        if (current !== minute) { minute = current; count = 0; }
        res.set('Cache-Control', 'no-store');
        if (++count > 120) return res.status(429).json({ ok: false, code: 'RATE_LIMIT' });
        next();
    }, express.raw({ type: 'application/json', limit: '16kb' }), async (req, res) => {
        try {
            const result = await receiver.handle(req, req.body);
            res.status(result.status).json(result.body);
        } catch { res.status(503).json({ ok: false, code: 'STORAGE_UNAVAILABLE' }); }
    });
    app.use('/internal/billing/v1', (err, req, res, next) => {
        if (!err) return next();
        res.status(err.type === 'entity.too.large' ? 413 : 400).json({ ok: false, code: 'INVALID_EVENT' });
    });
}
module.exports = { ROUTE, configuration, createReceiver, register };
