'use strict';

// Usa dois itens reais do Airtable para testar a separação visual.
// O destino continua exclusivamente sendo o cliente TESTE 1 - SISTEMA.
// Não altera registros no Airtable.
//
// Sem argumento: prévia segura.
// Com --confirmar-envio-real: envia ao telefone controlado.

process.env.DOTENV_CONFIG_QUIET = 'true';
require('dotenv').config({ quiet: true });

const ALVO = Object.freeze({
  clienteId: 'rec2FXoUxhQ3qKgbE',
  clienteNome: 'TESTE 1 - SISTEMA',
  osNomeTeste: 'TESTE VISUAL SISTEMA',
  prefixoTelefone: '5561',
  sufixoTelefone: '2746',
  quantidadeItens: 2,
});

const ENVIO_REAL = process.argv.includes(
  '--confirmar-envio-real'
);

function exigir(condicao, mensagem) {
  if (!condicao) {
    throw new Error(mensagem);
  }
}

function texto(valor) {
  return String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitos(valor) {
  return String(valor ?? '')
    .replace(/\D/g, '');
}

function envBooleano(nome, padrao = false) {
  const valor = texto(
    process.env[nome]
  ).toLowerCase();

  if (!valor) {
    return padrao;
  }

  return [
    '1',
    'true',
    'sim',
    'yes',
    'on',
  ].includes(valor);
}

function mascararTelefone(valor) {
  const numero = digitos(valor);

  if (numero.length <= 8) {
    return '****';
  }

  return (
    numero.slice(0, 4) +
    '*'.repeat(
      Math.max(
        numero.length - 8,
        4
      )
    ) +
    numero.slice(-4)
  );
}

function mascararId(valor) {
  const id = String(valor ?? '');

  if (!id) {
    return '';
  }

  return id.length <= 14
    ? '***'
    : `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function criarIdExecucao() {
  return new Date()
    .toISOString()
    .replace(/\D/g, '')
    .slice(0, 17);
}

function selecionarItensReais({
  clientes,
  itensDaOS,
  quantidade,
}) {
  const linhasSelecionadas = [];
  const origens = [];
  let quantidadeAtual = 0;

  for (const cliente of clientes) {
    const ordens = Array.isArray(
      cliente?.ordens
    )
      ? cliente.ordens
      : [];

    for (const ordem of ordens) {
      const linhas = Array.isArray(
        ordem?.linhas
      )
        ? ordem.linhas
        : [];

      for (const linha of linhas) {
        const tentativa = [
          ...linhasSelecionadas,
          {
            ...linha,
          },
        ];

        const itensTentativa = itensDaOS({
          linhas: tentativa,
        });

        if (
          itensTentativa.length <=
          quantidadeAtual
        ) {
          continue;
        }

        linhasSelecionadas.push({
          ...linha,
        });

        origens.push({
          cliente:
            texto(
              cliente?.clienteNome
            ),

          ordemServico:
            texto(
              ordem?.osNome ||
              ordem?.osId
            ),
        });

        quantidadeAtual =
          itensTentativa.length;

        if (
          quantidadeAtual >= quantidade
        ) {
          return {
            linhas:
              linhasSelecionadas,

            origens,
          };
        }
      }
    }
  }

  return {
    linhas: [],
    origens: [],
  };
}

async function executar() {
  exigir(
    !envBooleano('CRON_ATIVO'),
    'CRON_ATIVO deve permanecer false durante o teste.'
  );

  const {
    buscarResumoDiario,
  } = require('./airtable.js');

  console.log(
    '[Teste Visual] Consultando itens reais do Airtable...'
  );

  const clientes =
    await buscarResumoDiario({
      ignorarData: true,
      modoAuditoria: true,
      ignorarCorteAutomacao: true,
    });

  exigir(
    Array.isArray(clientes),
    'O Airtable não retornou uma lista válida.'
  );

  const candidatosTeste =
    clientes.filter(
      cliente =>
        cliente?.clienteId ===
        ALVO.clienteId
    );

  exigir(
    candidatosTeste.length === 1,
    'O cliente de teste não foi encontrado de forma única.'
  );

  const clienteTeste =
    candidatosTeste[0];

  exigir(
    texto(
      clienteTeste?.clienteNome
    ) === ALVO.clienteNome,
    'O nome do cliente de teste está incorreto.'
  );

  exigir(
    clienteTeste?.whatsappAmbiguo !== true &&
      clienteTeste?.whatsappBloqueado !== true &&
      clienteTeste
        ?.whatsappDuplicadoEntreClientes !== true,
    'O WhatsApp do cliente de teste não está seguro.'
  );

  exigir(
    Array.isArray(
      clienteTeste?.whatsappsEncontrados
    ) &&
      clienteTeste
        .whatsappsEncontrados
        .length === 1,
    'O cliente de teste deve possuir exatamente um WhatsApp.'
  );

  process.env.WHATSAPP_ATIVO = 'true';

  process.env.WHATSAPP_SIMULAR =
    ENVIO_REAL
      ? 'false'
      : 'true';

  process.env.WHATSAPP_MODO_TESTE =
    'false';

  process.env.WHATSAPP_LOG_PAYLOAD =
    'false';

  const {
    itensDaOS,
    SEPARADOR_VISUAL_ITENS,
  } = require('./whatsapp_template.js');

  const {
    prepararEnvioWhatsAppDaOS,
    enviarWhatsAppDaOS,
    normalizarTelefone,
  } = require('./enviar_whatsapp.js');

  const telefoneAirtable =
    normalizarTelefone(
      clienteTeste?.whatsapp
    );

  exigir(
    telefoneAirtable.ok === true,
    'O WhatsApp do cliente de teste é inválido.'
  );

  exigir(
    telefoneAirtable.telefone.startsWith(
      ALVO.prefixoTelefone
    ) &&
      telefoneAirtable.telefone.endsWith(
        ALVO.sufixoTelefone
      ),
    'O telefone não corresponde ao destino controlado.'
  );

  const selecao =
    selecionarItensReais({
      clientes,
      itensDaOS,
      quantidade:
        ALVO.quantidadeItens,
    });

  exigir(
    selecao.linhas.length >=
      ALVO.quantidadeItens,
    'Não foram encontrados dois itens reais distintos no Airtable.'
  );

  const ordemTeste = {
    osId:
      `teste_visual_${criarIdExecucao()}`,

    osNome:
      ALVO.osNomeTeste,

    linhas:
      selecao.linhas,
  };

  const preparado =
    prepararEnvioWhatsAppDaOS({
      cliente:
        clienteTeste,

      ordem:
        ordemTeste,
    });

  exigir(
    preparado?.ok === true,
    preparado?.mensagem ||
      preparado?.motivo ||
      'Não foi possível preparar a mensagem.'
  );

  exigir(
    preparado.origemDestino ===
      'airtable',
    'O telefone não veio do Airtable.'
  );

  exigir(
    preparado.telefone ===
      telefoneAirtable.telefone,
    'O destino preparado está incorreto.'
  );

  exigir(
    preparado.clienteId ===
      ALVO.clienteId,
    'O envio não pertence ao cliente de teste.'
  );

  exigir(
    preparado.quantidadeItens ===
      ALVO.quantidadeItens,
    'A mensagem não possui exatamente dois itens.'
  );

  exigir(
    preparado.formatoDetalhes ===
      'blocos',
    'A mensagem não utilizou o formato em blocos.'
  );

  exigir(
    String(
      preparado.contexto?.detalhes || ''
    ).includes(
      SEPARADOR_VISUAL_ITENS
    ),
    'O separador visual não foi encontrado.'
  );

  const resumo = {
    ok: true,
    enviado: false,
    simulado: !ENVIO_REAL,

    fonteDados:
      'Dois itens reais do Airtable',

    fonteTelefone:
      'Cliente TESTE 1 - SISTEMA',

    origensItens:
      selecao.origens,

    destino:
      mascararTelefone(
        preparado.telefone
      ),

    origemDestino:
      preparado.origemDestino,

    ordemExibida:
      preparado.osNome,

    quantidadeItens:
      preparado.quantidadeItens,

    formatoDetalhes:
      preparado.formatoDetalhes,

    tamanhoCorpoEstimado:
      preparado.tamanhoCorpoEstimado,

    limiteCorpo:
      preparado.limiteCorpo,

    detalhes:
      preparado.contexto?.detalhes ||
      '',
  };

  if (!ENVIO_REAL) {
    console.log(
      JSON.stringify(
        resumo,
        null,
        2
      )
    );

    return;
  }

  const resultado =
    await enviarWhatsAppDaOS({
      cliente:
        clienteTeste,

      ordem:
        ordemTeste,
    });

  exigir(
    resultado?.ok === true &&
      resultado?.enviado === true,
    resultado?.mensagem ||
      resultado?.motivo ||
      'A Meta não confirmou o envio.'
  );

  console.log(
    JSON.stringify(
      {
        ...resumo,

        enviado:
          true,

        simulado:
          false,

        messageId:
          mascararId(
            resultado.messageId
          ),
      },
      null,
      2
    )
  );
}

executar().catch(erro => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        enviado: false,
        erro:
          erro?.message ||
          String(erro),
      },
      null,
      2
    )
  );

  process.exitCode = 1;
});