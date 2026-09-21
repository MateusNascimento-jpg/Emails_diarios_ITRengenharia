'use strict';

require('dotenv').config({
  quiet: true,
});

const {
  validarConfiguracao,
} = require('./config_validation.js');

const resultado =
  validarConfiguracao(
    process.env,
    {
      estrito: true,
    }
  );

console.log(
  '[preflight] configuração do serviço ITR Notificações'
);

for (
  const [chave, valor]
  of Object.entries(
    resultado.resumo
  )
) {
  console.log(
    `[preflight] ${chave}: ${String(valor)}`
  );
}

for (const aviso of resultado.avisos) {
  console.warn(
    `[preflight] AVISO: ${aviso}`
  );
}

if (!resultado.ok) {
  for (const erro of resultado.erros) {
    console.error(
      `[preflight] ERRO: ${erro}`
    );
  }

  process.exitCode = 1;
} else {
  console.log(
    '[preflight] OK'
  );
}
