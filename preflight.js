'use strict';

const fs = require('fs');
const path = require('path');
const { validarConfiguracao } = require('./config_validation.js');

function carregarEnvLocal() {
  const arquivo = path.join(__dirname, '.env');
  if (!fs.existsSync(arquivo)) return;

  const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/);
  for (const linhaOriginal of linhas) {
    const linha = linhaOriginal.trim();
    if (!linha || linha.startsWith('#')) continue;
    const indice = linha.indexOf('=');
    if (indice <= 0) continue;
    const nome = linha.slice(0, indice).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome)) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, nome)) continue;
    let valor = linha.slice(indice + 1);
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    process.env[nome] = valor;
  }
}

carregarEnvLocal();

const resultado = validarConfiguracao(process.env, { estrito: true });

console.log('[preflight] configuração do serviço ITR Notificações');
for (const [chave, valor] of Object.entries(resultado.resumo)) {
  console.log(`[preflight] ${chave}: ${String(valor)}`);
}
for (const aviso of resultado.avisos) {
  console.warn(`[preflight] AVISO: ${aviso}`);
}
if (!resultado.ok) {
  for (const erro of resultado.erros) console.error(`[preflight] ERRO: ${erro}`);
  process.exitCode = 1;
} else {
  console.log('[preflight] OK');
}
