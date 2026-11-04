'use strict';
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
}
function signature(secret, method, route, timestamp, nonce, body) {
    return crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(`itr-billing-v1\n${method}\n${route}\n${timestamp}\n${nonce}\n`).update(body).digest('hex');
}
function headers(secret, method, route, body = '', now = Date.now()) {
    const timestamp = String(Math.floor(now / 1000)), nonce = crypto.randomBytes(24).toString('base64url');
    return { 'content-type': 'application/json', 'x-itr-timestamp': timestamp, 'x-itr-nonce': nonce,
        'x-itr-signature': signature(secret, method, route, timestamp, nonce, body) };
}
function verify(secret, method, route, input, body, now = Date.now()) {
    const t = input['x-itr-timestamp'], n = input['x-itr-nonce'], s = input['x-itr-signature'];
    return Buffer.from(secret || '', 'base64').length >= 32 && /^\d{10}$/.test(t || '') &&
        Math.abs(now / 1000 - Number(t)) <= 300 && /^[\w-]{32}$/.test(n || '') && /^[a-f0-9]{64}$/.test(s || '') &&
        crypto.timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(signature(secret, method, route, t, n, body), 'hex'));
}
module.exports = { hash, canonical, headers, verify };
