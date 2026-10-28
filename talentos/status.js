'use strict';

// Consulta somente metadados de recibos. Não envia e-mails nem altera estados.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { configuration } = require('./receiver');

function main() {
  const config = configuration();
  if (!config.enabled) throw new Error('Módulo Talentos está desativado.');
  const counts = { retryable: 0, sending: 0, uncertain: 0, sent: 0, unknown: 0, staleLocks: 0 };
  for (const name of fs.readdirSync(config.directory)) {
    if (/^[a-f0-9]{64}\.json$/.test(name)) {
      const receipt = JSON.parse(fs.readFileSync(path.join(config.directory, name), 'utf8'));
      if (Object.hasOwn(counts, receipt.state)) counts[receipt.state]++;
      else counts.unknown++;
    } else if (/^[a-f0-9]{64}\.json\.lock$/.test(name)) {
      const stat = fs.statSync(path.join(config.directory, name));
      if (Date.now() - stat.mtimeMs > 10 * 60 * 1000) counts.staleLocks++;
    }
  }
  console.log('Recibos de Talentos (sem dados pessoais):');
  for (const [state, count] of Object.entries(counts)) console.log(`${state}: ${count}`);
  if (counts.uncertain || counts.sending || counts.staleLocks) {
    console.warn('Há situações que exigem revisão manual antes de qualquer reenvio.');
  }
}

try { main(); }
catch (error) { console.error(`TALENTOS: consulta falhou: ${error.message}`); process.exitCode = 1; }
