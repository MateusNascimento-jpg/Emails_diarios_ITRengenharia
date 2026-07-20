'use strict';

// Validação local segura: não consulta Airtable, não envia e-mail
// e não chama a Meta.

process.env.WHATSAPP_TEMPLATE_NAME ||=
  'atualizacao_ordem_servico';

process.env.WHATSAPP_TEMPLATE_LANGUAGE ||=
  'pt_BR';

process.env.WHATSAPP_TEMPLATE_PARAMETER_MODE ||=
  'named';

process.env.WHATSAPP_TEMPLATE_BODY_PARAMETERS ||=
  'ordem_servico,detalhes';

process.env.WHATSAPP_FORMATO_DETALHES ||=
  'auto';

process.env.WHATSAPP_DETALHES_MAX_CHARS ||=
  '800';

process.env.WHATSAPP_TEMPLATE_BODY_MAX_CHARS ||=
  '1024';

process.env.WHATSAPP_TEMPLATE_BODY_FIXED_CHARS ||=
  '306';

process.env.WHATSAPP_TEMPLATE_BODY_SAFETY_MARGIN ||=
  '20';

process.env.WHATSAPP_TEMPLATE_HEADER_TYPE ||=
  'image';

process.env.WHATSAPP_TEMPLATE_HEADER_MEDIA_URL ||=
  'https://emails-diarios-itrengenharia.onrender.com/assets/logo-whatsapp.jpeg';

process.env.WHATSAPP_ATIVO =
  'false';

process.env.WHATSAPP_SIMULAR =
  'true';

process.env.WHATSAPP_MODO_TESTE =
  'true';

process.env.WHATSAPP_TEST_NUMBER ||=
  '5561999999999';

process.env.WHATSAPP_PHONE_NUMBER_ID ||=
  '123456789012345';

process.env.WHATSAPP_ACCESS_TOKEN ||=
  'TOKEN_LOCAL_NAO_USADO';

const assert =
  require('node:assert/strict');

const {
  montarPayloadTemplateWhatsApp,
  montarVariaveisDaOS,
  normalizarParametroMeta,
} = require('./whatsapp_template.js');

const {
  normalizarTelefone,
  prepararEnvioWhatsAppDaOS,
} = require('./enviar_whatsapp.js');

function clienteBase() {
  return {
    clienteId:
      'cliente-teste',

    clienteNome:
      'Cliente de teste',

    whatsapp:
      '61999999999',
  };
}

function linha({
  amostra,
  ensaioNome =
    'Índice de Suporte Califórnia',
  ensaioSigla =
    'CBR-N',
  status =
    'Enviado ao Cliente',
}) {
  return {
    amostra,
    ensaioNome,
    ensaioSigla,
    status,
  };
}

function parametrosDoCorpo(
  payload
) {
  return (
    payload.template.components
      .find(
        componente =>
          componente.type ===
          'body'
      )
      ?.parameters || []
  );
}

function parametroNomeado(
  payload,
  nome
) {
  return parametrosDoCorpo(
    payload
  ).find(
    parametro =>
      parametro.parameter_name ===
      nome
  );
}

function validarMensagemPequena() {
  const ordem = {
    osId:
      'os-43',

    osNome:
      'OS 43',

    linhas: [
      linha({
        amostra:
          'REG 1593 (ST-TCV-TPS-G21-1089)',

        ensaioSigla:
          'CBR-N',
      }),

      linha({
        amostra:
          'REG 1573 (ST-TCV-TPS-G21-1078)',

        ensaioSigla:
          'CBR-N',
      }),

      linha({
        amostra:
          'REG 1592 (ST-TCV-TPS-G21-1089)',

        ensaioSigla:
          'CBR-I',
      }),

      linha({
        amostra:
          'REG 1621 (ST-TCV-TPS-G21-2006)',

        ensaioSigla:
          'CBR-N',
      }),

      linha({
        amostra:
          'REG 1623 (ST-TCV-TPS-G21-2007)',

        ensaioSigla:
          'CBR-I',
      }),

      linha({
        amostra:
          'REG 1594 (ST-TCV-TPS-G21-1089)',

        ensaioSigla:
          'CBR-I',
      }),

      linha({
        amostra:
          'REG 1615 (ST-TCV-TAC-C21-2005)',

        ensaioSigla:
          'CBR-I',
      }),
    ],
  };

  const resultado =
    montarPayloadTemplateWhatsApp({
      cliente:
        clienteBase(),

      ordem,

      telefone:
        '5561999999999',
    });

  assert.equal(
    resultado.ok,
    true
  );

  assert.equal(
    resultado.formatoDetalhes,
    'blocos'
  );

  assert.equal(
    resultado.quantidadeItens,
    7
  );

  assert.ok(
    resultado.tamanhoCorpoEstimado <=
      resultado.limiteCorpo
  );

  const detalhes =
    parametroNomeado(
      resultado.payload,
      'detalhes'
    )?.text || '';

  assert.match(
    detalhes,
    /1\) Amostra:/
  );

  assert.match(
    detalhes,
    /Ensaio: CBR-N/
  );

  assert.match(
    detalhes,
    /Status: Relatório Pronto/
  );

  assert.equal(
    /[\r\n\t]/.test(
      detalhes
    ),
    false
  );

  assert.equal(
    detalhes.includes(
      ' || '
    ),
    true
  );

  const cabecalho =
    resultado.payload.template.components
      .find(
        componente =>
          componente.type ===
          'header'
      );

  assert.equal(
    cabecalho
      ?.parameters
      ?.[0]
      ?.type,

    'image'
  );

  assert.match(
    cabecalho
      ?.parameters
      ?.[0]
      ?.image
      ?.link || '',

    /^https:\/\//
  );
}

function validarDeduplicacao() {
  const item =
    linha({
      amostra:
        'A-01',
    });

  const resultado =
    montarVariaveisDaOS(
      clienteBase(),

      {
        osId:
          'os-dedup',

        osNome:
          'OS DEDUP',

        linhas: [
          item,
          {
            ...item,
          },
        ],
      }
    );

  assert.equal(
    resultado.ok,
    true
  );

  assert.equal(
    resultado.quantidadeItens,
    1
  );
}

function validarFallbackCompactoOuBloqueioSeguro() {
  const linhas =
    Array.from(
      {
        length:
          70,
      },

      (_, indice) =>
        linha({
          amostra:
            `Registro ${1000 + indice} ` +
            `- Trecho muito extenso ` +
            `${indice + 1}`,

          ensaioNome:
            'Módulo de Resiliência',

          ensaioSigla:
            'MR-I',
        })
    );

  const resultado =
    montarVariaveisDaOS(
      clienteBase(),

      {
        osId:
          'os-grande',

        osNome:
          'OS GRANDE',

        linhas,
      }
    );

  if (resultado.ok) {
    assert.equal(
      resultado.formatoDetalhes,
      'compacto'
    );

    assert.ok(
      resultado.tamanhoCorpoEstimado <=
        resultado.limiteCorpo
    );

    return;
  }

  assert.equal(
    resultado.motivo,
    'detalhes-excedem-limite'
  );

  assert.ok(
    resultado.tamanhoCorpoEstimado >
      resultado.limiteCorpo ||
      resultado.tamanho >
        800
  );
}

function validarTelefone() {
  const nacional =
    normalizarTelefone(
      '(61) 99999-9999'
    );

  assert.equal(
    nacional.ok,
    true
  );

  assert.equal(
    nacional.telefone,
    '5561999999999'
  );

  const invalido =
    normalizarTelefone(
      '123'
    );

  assert.equal(
    invalido.ok,
    false
  );
}

function validarPreparacao() {
  const resultado =
    prepararEnvioWhatsAppDaOS({
      cliente:
        clienteBase(),

      ordem: {
        osId:
          'os-preparacao',

        osNome:
          'OS PREPARAÇÃO',

        linhas: [
          linha({
            amostra:
              'A-01',
          }),
        ],
      },
    });

  assert.equal(
    resultado.ok,
    true
  );

  assert.equal(
    resultado.origemDestino,
    'teste'
  );

  assert.ok(
    resultado.tamanhoCorpoEstimado >
      0
  );

  assert.ok(
    resultado.limiteCorpo >
      0
  );
}

function validarNormalizacao() {
  const valor =
    normalizarParametroMeta(
      'A\n\nB\tC ||  D'
    );

  assert.equal(
    valor,
    'A || B C || D'
  );
}

function executar() {
  validarMensagemPequena();
  validarDeduplicacao();
  validarFallbackCompactoOuBloqueioSeguro();
  validarTelefone();
  validarPreparacao();
  validarNormalizacao();

  console.log(
    'VALIDAÇÃO WHATSAPP: OK'
  );

  console.log(
    'CHAMADA À META: NÃO'
  );

  console.log(
    'CONSULTA AO AIRTABLE: NÃO'
  );

  console.log(
    'ENVIO DE E-MAIL: NÃO'
  );
}

try {
  executar();
} catch (erro) {
  console.error(
    'VALIDAÇÃO WHATSAPP: FALHOU'
  );

  console.error(
    erro?.stack ||
    erro
  );

  process.exitCode =
    1;
}