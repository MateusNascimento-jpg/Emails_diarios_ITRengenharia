'use strict';

const crypto = require('crypto');
const { segredoBase64Valido } = require('./config_validation.js');

function limparNonces(store, agoraMs = Date.now()) {
  for (const [nonce, expiraEm] of store.entries()) {
    if (expiraEm <= agoraMs) store.delete(nonce);
  }

  if (store.size > 5000) {
    const excedente = store.size - 4000;
    for (const chave of Array.from(store.keys()).slice(0, excedente)) store.delete(chave);
  }
}

function validarAssinaturaPortal({
  secretBase64,
  timestamp,
  nonce,
  signature,
  rawBody,
  maxSkewSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
  nonceStore = new Map(),
}) {
  const secretTexto = String(secretBase64 || '').trim();
  if (!segredoBase64Valido(secretTexto, 32)) {
    return { ok: false, status: 503, motivo: 'segredo-nao-configurado' };
  }

  const tsTexto = String(timestamp || '');
  const nonceTexto = String(nonce || '');
  const assinaturaTexto = String(signature || '').toLowerCase();

  if (!/^\d{10,11}$/.test(tsTexto) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonceTexto) || !/^[a-f0-9]{64}$/.test(assinaturaTexto)) {
    return { ok: false, status: 401, motivo: 'assinatura-invalida' };
  }

  const ts = Number(tsTexto);
  const skew = Number(maxSkewSeconds);
  if (!Number.isFinite(ts) || !Number.isFinite(skew) || Math.abs(Number(nowSeconds) - ts) > skew) {
    return { ok: false, status: 401, motivo: 'timestamp-invalido' };
  }

  limparNonces(nonceStore, Number(nowSeconds) * 1000);
  if (nonceStore.has(nonceTexto)) {
    return { ok: false, status: 409, motivo: 'nonce-repetido' };
  }

  const corpo = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
  const secret = Buffer.from(secretTexto, 'base64');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${tsTexto}.${nonceTexto}.`, 'utf8')
    .update(corpo)
    .digest('hex');

  const recebido = Buffer.from(assinaturaTexto, 'utf8');
  const esperado = Buffer.from(expected, 'utf8');
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) {
    return { ok: false, status: 401, motivo: 'assinatura-invalida' };
  }

  nonceStore.set(nonceTexto, (Number(nowSeconds) + skew) * 1000);
  return { ok: true };
}

module.exports = {
  validarAssinaturaPortal,
  limparNonces,
};
