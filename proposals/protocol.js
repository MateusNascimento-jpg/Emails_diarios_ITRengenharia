'use strict';

const crypto = require('node:crypto');

function signature(secret, method, path, timestamp, nonce, body) {
    return crypto
        .createHmac('sha256', Buffer.from(secret, 'base64'))
        .update(`itr-proposals-v1\n${method}\n${path}\n${timestamp}\n${nonce}\n`)
        .update(body)
        .digest('hex');
}

function headers(secret, method, path, body = '') {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(24).toString('base64url');
    return {
        'content-type': 'application/json',
        'x-itr-timestamp': timestamp,
        'x-itr-nonce': nonce,
        'x-itr-signature': signature(secret, method, path, timestamp, nonce, body),
    };
}

function verify(secret, method, path, input, body = '') {
    const timestamp = input['x-itr-timestamp'];
    const nonce = input['x-itr-nonce'];
    const received = input['x-itr-signature'];
    if (
        Buffer.from(secret || '', 'base64').length < 32 ||
        !/^\d{10}$/.test(timestamp || '') ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        !/^[\w-]{32}$/.test(nonce || '') ||
        !/^[a-f0-9]{64}$/.test(received || '')
    )
        return false;
    return crypto.timingSafeEqual(
        Buffer.from(received, 'hex'),
        Buffer.from(signature(secret, method, path, timestamp, nonce, body), 'hex'),
    );
}

module.exports = { headers, verify };
