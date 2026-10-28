'use strict';

const crypto = require('node:crypto');

const VERSION = 'itr-talentos-v1';

function keyFromBase64(secret) {
  const value = String(secret || '').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const key = Buffer.from(value, 'base64');
  return key.length >= 32 && key.toString('base64') === value ? key : null;
}

function signature(secret, method, route, timestamp, nonce, body = '') {
  const key = keyFromBase64(secret);
  if (!key) throw new Error('Segredo HMAC do Banco de Talentos inválido.');
  return crypto.createHmac('sha256', key)
    .update(`${VERSION}\n${method}\n${route}\n${timestamp}\n${nonce}\n`, 'utf8')
    .update(body)
    .digest('hex');
}

function headers(secret, method, route, body = '') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(24).toString('hex');
  return {
    'x-itr-talentos-timestamp': timestamp,
    'x-itr-talentos-nonce': nonce,
    'x-itr-talentos-signature': signature(secret, method, route, timestamp, nonce, body),
  };
}

function verify(secret, method, route, receivedHeaders, body = '', nowSeconds = Math.floor(Date.now() / 1000)) {
  const timestamp = receivedHeaders['x-itr-talentos-timestamp'];
  const nonce = receivedHeaders['x-itr-talentos-nonce'];
  const received = receivedHeaders['x-itr-talentos-signature'];
  if (!keyFromBase64(secret) || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) ||
      Math.abs(nowSeconds - Number(timestamp)) > 300 ||
      typeof nonce !== 'string' || !/^[a-f0-9]{48}$/.test(nonce) ||
      typeof received !== 'string' || !/^[a-f0-9]{64}$/.test(received)) return false;
  const expected = signature(secret, method, route, timestamp, nonce, body);
  return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

module.exports = { VERSION, keyFromBase64, signature, headers, verify };
