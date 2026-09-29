"use strict";
// Contrato idêntico nos dois serviços: sigla sem espaços nas pontas + 6 dígitos.
function documento(value) { return String(value || '').replace(/\D/g, ''); }
function senhaGerada(sigla, cnpj) {
  const s = String(sigla ?? '').trim();
  const d = documento(cnpj);
  if (!s || s.length > 64 || /[\r\n\t]/.test(s) || d.length !== 14) return null;
  return s + d.slice(0, 6);
}
function emails(value) {
  return [...new Set((Array.isArray(value) ? value.flat(Infinity) : [value])
    .flatMap(v => String(v || '').split(/[;,\r\n]+/))
    .map(v => v.trim().toLowerCase()).filter(v => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))];
}
function campoSigla(env = process.env) {
  const fields = ['AIRTABLE_CLIENT_SIGLA_FIELD', 'AIRTABLE_CLIENT_ACRONYM_FIELD', 'AIRTABLE_CAMPO_SIGLA_CLIENTE']
    .map(k => String(env[k] || '').trim()).filter(Boolean);
  if (new Set(fields).size > 1) throw new Error('Campos de sigla divergentes no ambiente; use AIRTABLE_CLIENT_SIGLA_FIELD.');
  if (env.PORTAL_ACCESS_CNPJ_DIGITS && String(env.PORTAL_ACCESS_CNPJ_DIGITS).trim() !== '6')
    throw new Error('Esta versão exige PORTAL_ACCESS_CNPJ_DIGITS=6 ou ausente.');
  return fields[0] || 'Sigla Cliente';
}
module.exports = { documento, senhaGerada, emails, campoSigla };
