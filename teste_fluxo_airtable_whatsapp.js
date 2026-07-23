'use strict';

// Teste controlado usando o cliente e a OS de teste do Airtable.
// Sem argumento: apenas prévia.
// Com --confirmar-envio-real: envia somente a OS fixa abaixo.

require('dotenv').config();

const ALVO = Object.freeze({
  clienteId: 'rec2FXoUxhQ3qKgbE',
  clienteNome: 'TESTE 1 - SISTEMA',
  osId: 'recOybdpjpk5HKPl7',
  osNome: 'TESTE 2 SISTEMA',
  prefixoTelefone: '5561',
  sufixoTelefone: '8001',
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
  return String(valor ?? '').replace(/\D/g, '');
}

function envBooleano(nome, padrao = false) {
  const valor = texto(process.env[nome]).toLowerCase();

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

async function executar() {
  exigir(
    !envBooleano('CRON_ATIVO'),
    'CRON_ATIVO deve permanecer false durante o teste.'
  );

  const {
    buscarResumoDiario,
  } = require('./airtable.js');

  console.log(
    '[Teste Airtable] Localizando o cliente e a OS controlados...'
  );

  const clientes = await buscarResumoDiario({
    ignorarData: true,
    modoAuditoria: true,
    ignorarCorteAutomacao: true,
  });

  const candidatosCliente = clientes.filter(
    item =>
      item?.clienteId === ALVO.clienteId
  );

  exigir(
    candidatosCliente.length === 1,
    'O cliente de teste não foi encontrado de forma única.'
  );

  const cliente = candidatosCliente[0];

  exigir(
    texto(cliente?.clienteNome) ===
      ALVO.clienteNome,
    'O nome do cliente não corresponde ao alvo controlado.'
  );

  const ordens = Array.isArray(
    cliente?.ordens
  )
    ? cliente.ordens
    : [];

  const candidatasOs = ordens.filter(
    item =>
      item?.osId === ALVO.osId
  );

  exigir(
    candidatasOs.length === 1,
    'A OS de teste não foi encontrada de forma única.'
  );

  const ordem = candidatasOs[0];

  exigir(
    texto(ordem?.osNome) ===
      ALVO.osNome,
    'O nome da OS não corresponde ao alvo controlado.'
  );

  exigir(
    Array.isArray(ordem?.linhas) &&
      ordem.linhas.length === 1,
    'A OS de teste deve possuir exatamente um item.'
  );

  exigir(
    cliente?.whatsappAmbiguo !== true &&
      cliente?.whatsappBloqueado !== true &&
      cliente?.whatsappDuplicadoEntreClientes !== true,
    'O WhatsApp do cliente de teste não está seguro para envio.'
  );

  exigir(
    Array.isArray(
      cliente?.whatsappsEncontrados
    ) &&
      cliente.whatsappsEncontrados.length === 1,
    'O Airtable deve retornar exatamente um WhatsApp para o cliente.'
  );

  // Alterações apenas em memória.
  // O arquivo .env não é modificado.
  process.env.WHATSAPP_ATIVO =
    'true';

  process.env.WHATSAPP_SIMULAR =
    ENVIO_REAL
      ? 'false'
      : 'true';

  // false obriga o uso do telefone vindo do Airtable.
  process.env.WHATSAPP_MODO_TESTE =
    'false';

  process.env.WHATSAPP_LOG_PAYLOAD =
    'false';

  const {
    prepararEnvioWhatsAppDaOS,
    enviarWhatsAppDaOS,
    normalizarTelefone,
  } = require('./enviar_whatsapp.js');

  const telefoneAirtable =
    normalizarTelefone(
      cliente?.whatsapp
    );

  exigir(
    telefoneAirtable.ok === true,
    'O WhatsApp vindo do Airtable é inválido.'
  );

  exigir(
    telefoneAirtable.telefone.startsWith(
      ALVO.prefixoTelefone
    ) &&
      telefoneAirtable.telefone.endsWith(
        ALVO.sufixoTelefone
      ),
    'O WhatsApp do Airtable não corresponde ao destino controlado.'
  );

  const preparado =
    prepararEnvioWhatsAppDaOS({
      cliente,
      ordem,
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
    'O telefone não foi obtido do Airtable.'
  );

  exigir(
    preparado.telefone ===
      telefoneAirtable.telefone,
    'O destino preparado difere do WhatsApp armazenado no Airtable.'
  );

  exigir(
    preparado.clienteId ===
      ALVO.clienteId &&
      preparado.osId ===
        ALVO.osId &&
      preparado.quantidadeItens ===
        1,
    'O payload não pertence exclusivamente ao registro controlado.'
  );

  const resumo = {
    ok:
      true,

    enviado:
      false,

    simulado:
      !ENVIO_REAL,

    fonteDados:
      'Airtable',

    fonteTelefone:
      'WhatsApp do Cliente',

    cliente: {
      id:
        preparado.clienteId,

      nome:
        preparado.clienteNome,
    },

    ordemServico: {
      id:
        preparado.osId,

      nome:
        preparado.osNome,
    },

    destino:
      mascararTelefone(
        preparado.telefone
      ),

    origemDestino:
      preparado.origemDestino,

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
      cliente,
      ordem,
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

executar().catch(
  erro => {
    console.error(
      JSON.stringify(
        {
          ok:
            false,

          enviado:
            false,

          erro:
            erro?.message ||
            String(erro),
        },
        null,
        2
      )
    );

    process.exitCode =
      1;
  }
);