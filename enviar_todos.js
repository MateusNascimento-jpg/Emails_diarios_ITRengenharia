// ============================================================
//  enviar_todos.js  -  ORQUESTRADOR DO ENVIO DIARIO
// ------------------------------------------------------------
//  Junta as pecas: le o resumo (airtable) -> monta cada email
//  (template) -> envia (smtp). Um email por OS de cada cliente.
//
//  Pode ser executado direto (node enviar_todos.js) para um
//  disparo manual, ou chamado pelo agendador (server.js).
// ============================================================

require('dotenv').config();
const { buscarResumoDiario } = require('./airtable.js');
const { montarEmailDaOS } = require('./email_template.js');
const { enviar, MODO_TESTE } = require('./enviar_email.js');

// pequena pausa entre envios (evita estourar limite do servidor SMTP)
const PAUSA_MS = 1500;
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function executarEnvioDiario(opcoes = {}) {
  const inicio = new Date();
  console.log(`\n[${inicio.toLocaleString('pt-BR')}] Iniciando envio diario...`);
  if (MODO_TESTE) {
    console.log(`*** MODO TESTE ATIVO: todos os emails vao para ${MODO_TESTE} ***`);
  }
  if (opcoes.ignorarData) {
    console.log(`*** IGNORANDO filtro de data (teste): considerando todos os status validos ***`);
  }

  const clientes = await buscarResumoDiario(opcoes);
  console.log(`Clientes com movimento de ontem: ${clientes.length}`);
  // Número de emails enviados, falhas e clientes sem email ou problemas estruturais 
  let enviados = 0;
  let semEmail = 0;
  let falhas = 0;

  for (const cliente of clientes) {
    // se nao ha email de destino e nao estamos em modo teste, pula
    if (!cliente.email && !MODO_TESTE) {
      console.log(`  [PULADO] ${cliente.clienteNome}: sem email cadastrado`);
      semEmail += cliente.ordens.length;
      continue;
    }

    for (const ordem of cliente.ordens) {
      // blindagem: nunca enviar email de OS vazia (sem ensaios/linhas)
      if (!ordem.linhas || ordem.linhas.length === 0) {
        console.log(`  [IGNORADO] ${cliente.clienteNome} / ${ordem.osNome}: sem dados na view`);
        continue;
      }

      const { assunto, html, texto } = montarEmailDaOS(cliente, ordem);
      try {
        const r = await enviar({ para: cliente.email, assunto, html, texto });
        if (r.ok) {
          enviados++;
          console.log(`  [OK] ${cliente.clienteNome} / ${ordem.osNome} -> ${r.destino}`);
        } else {
          falhas++;
          console.log(`  [FALHA] ${cliente.clienteNome} / ${ordem.osNome}: ${r.motivo}`);
        }
      } catch (e) {
        falhas++;
        console.log(`  [ERRO] ${cliente.clienteNome} / ${ordem.osNome}: ${e.message}`);
      }
      await dormir(PAUSA_MS);
    }
  }

//Console para evitar falhas estruturais no envio de emails na dada prevista (manutenção) 
  console.log(`\nResumo: ${enviados} enviado(s), ${falhas} falha(s), ${semEmail} sem email.`);
  console.log(`[${new Date().toLocaleString('pt-BR')}] Envio diario concluido.\n`);
  return { enviados, falhas, semEmail };
}

module.exports = { executarEnvioDiario };

// se rodado diretamente (node enviar_todos.js), dispara na hora
// use "node enviar_todos.js --ignorar-data" para testar sem o filtro de ontem
if (require.main === module) {
  const ignorarData = process.argv.includes('--ignorar-data');
  executarEnvioDiario({ ignorarData }).catch(e => {
    console.error('ERRO FATAL no envio:', e.message);
    process.exit(1);
  });
}