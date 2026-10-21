'use strict';

// Contrato versionado: manter este arquivo byte a byte igual nos dois serviços.
// O hash não é segredo e serve somente para detectar divergência operacional.
const crypto = require('node:crypto');
const { campoSigla, senhaGerada } = require('./portal-access');
const DEFAULT_CLIENTES_TABLE = 'tblkQxQ6q7cBKXZ3C';

function parametrosAcesso(env = process.env) {
  return {
    protocol: 1,
    base: String(env.AIRTABLE_BASE_ID || '').trim(),
    clientesTable: String(env.AIRTABLE_CLIENTES_TABLE_ID || DEFAULT_CLIENTES_TABLE).trim(),
    siglaField: campoSigla(env),
    passwordRule: 'trim(sigla)+first6Digits(cnpj)',
  };
}

function fingerprintAcesso(env = process.env) {
  const parametros = parametrosAcesso(env);
  if (!parametros.base || !/^tbl[A-Za-z0-9]{14}$/.test(parametros.clientesTable)) {
    throw new Error('Contrato Airtable incompleto: confirme AIRTABLE_BASE_ID e AIRTABLE_CLIENTES_TABLE_ID.');
  }
  return crypto.createHash('sha256').update(JSON.stringify(parametros)).digest('hex');
}

const FIXTURES = Object.freeze([
  { sigla: ' EX ', cnpj: '12.345.678/0001-90', expected: 'EX123456' },
  { sigla: 'gco', cnpj: '17.205.251/0001-00', expected: 'gco172052' },
  { sigla: '', cnpj: '12.345.678/0001-90', expected: null },
]);

function validarRegraSenha() {
  return FIXTURES.every(({ sigla, cnpj, expected }) => senhaGerada(sigla, cnpj) === expected);
}

module.exports = { parametrosAcesso, fingerprintAcesso, validarRegraSenha, FIXTURES };
