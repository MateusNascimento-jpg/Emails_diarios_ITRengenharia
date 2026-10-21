'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fingerprintAcesso, parametrosAcesso, validarRegraSenha, FIXTURES } = require('../lib/confluence-contract');
const { senhaGerada } = require('../lib/portal-access');

const base = 'appConfluenceTeste';
const table = 'tblkQxQ6q7cBKXZ3C';
function env(overrides = {}) { return { AIRTABLE_BASE_ID: base, AIRTABLE_CLIENTES_TABLE_ID: table, AIRTABLE_CLIENT_SIGLA_FIELD: 'Sigla Cliente', ...overrides }; }

test('contrato da credencial preserva fixtures sem alterar clientes existentes', () => {
  assert.equal(validarRegraSenha(), true);
  for (const {sigla, cnpj, expected} of FIXTURES) assert.equal(senhaGerada(sigla, cnpj), expected);
});
test('diagnóstico distingue base, tabela e campo de sigla sem expor valor bruto', () => {
  const expected = fingerprintAcesso(env());
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.notEqual(expected, fingerprintAcesso(env({ AIRTABLE_BASE_ID: 'appOutraBase' })));
  assert.notEqual(expected, fingerprintAcesso(env({ AIRTABLE_CLIENTES_TABLE_ID: 'tbl12345678901234' })));
  assert.notEqual(expected, fingerprintAcesso(env({ AIRTABLE_CLIENT_SIGLA_FIELD: 'Outra sigla' })));
  assert.equal(expected, fingerprintAcesso(env({ AIRTABLE_CLIENTES_TABLE_ID: ` ${table} ` })));
  assert.throws(() => fingerprintAcesso(env({ AIRTABLE_BASE_ID: '' })), /incompleto/);
  assert.deepEqual(parametrosAcesso(env()).passwordRule, 'trim(sigla)+first6Digits(cnpj)');
});
test('diagnóstico e credencial não dependem de um segredo HMAC publicado no código', () => {
  const code = fs.readFileSync(path.join(__dirname, '../lib/confluence-contract.js'), 'utf8');
  assert.doesNotMatch(code, /PORTAL_NOTIFICATIONS_HMAC_SECRET|PORTAL_INTERNAL_HMAC_SECRET/);
});
