'use strict';

require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { configuration, createReceiver } = require('./receiver');

async function main() {
  const config = configuration();
  if (!config.enabled) throw new Error('TALENTOS_NOTIFICACOES_ATIVAS=false; diagnóstico não pode prosseguir.');
  const receiver = createReceiver({ config, send: async () => { throw new Error('SMTP não deve enviar no diagnóstico.'); } });
  const directory = receiver.prepare();
  const probe = path.join(directory, `diagnostico-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(probe, 'probe', { flag: 'wx', mode: 0o600 });
    if (fs.readFileSync(probe, 'utf8') !== 'probe') throw new Error('Falha na leitura do diretório.');
  } finally { if (fs.existsSync(probe)) fs.unlinkSync(probe); }
  console.log('TALENTOS: configuração HMAC, destinatário, URL WordPress e escrita no diretório verificadas.');
  console.log('ATENÇÃO: a persistência entre deploys deve ser confirmada na Hostinger. Nenhum SMTP foi acionado.');
}

main().catch(error => {
  console.error(`TALENTOS: diagnóstico falhou: ${error.message}`);
  process.exitCode = 1;
});
