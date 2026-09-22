'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executar,
  validarPayloadControlado,
  validarDefinicaoTemplateMeta,
} = require('../teste_template_whatsapp_producao.js');

function comEnv(variaveis, fn) {
  const anterior = {};

  for (const [chave, valor] of Object.entries(variaveis)) {
    anterior[chave] = process.env[chave];
    process.env[chave] = valor;
  }

  try {
    return fn();
  } finally {
    for (const chave of Object.keys(variaveis)) {
      if (anterior[chave] === undefined) {
        delete process.env[chave];
      } else {
        process.env[chave] = anterior[chave];
      }
    }
  }
}

function envV3() {
  return {
    WHATSAPP_TEMPLATE_NAME:
      'atualizacao_ordem_servico_v3',
    WHATSAPP_TEMPLATE_LANGUAGE:
      'pt_BR',
    WHATSAPP_TEMPLATE_PARAMETER_MODE:
      'named',
    WHATSAPP_TEMPLATE_BODY_PARAMETERS:
      'order_service,order_status',
    WHATSAPP_TEMPLATE_HEADER_TYPE:
      'image',
    WHATSAPP_TEMPLATE_HEADER_MEDIA_ID:
      '',
    WHATSAPP_TEMPLATE_HEADER_MEDIA_URL:
      'https://notificacoes.itr.eng.br/assets/logo-whatsapp.jpeg',
    PORTAL_CLIENTE_URL:
      'https://portal.itr.eng.br/login.html',
  };
}

test('validador de produção reconhece o contrato V3 sem detalhes', () => {
  comEnv(envV3(), () => {
    const destino = '5561000000000';

    const preparado = {
      ok: true,
      quantidadeItens: 2,
      quantidadePartes: 1,
      quantidadeMensagens: 1,
      formatoDetalhes: 'nao-utilizado',
      payload: {
        messaging_product: 'whatsapp',
        to: destino,
        type: 'template',
        template: {
          name: 'atualizacao_ordem_servico_v3',
          language: { code: 'pt_BR' },
          components: [
            {
              type: 'header',
              parameters: [
                {
                  type: 'image',
                  image: {
                    link: 'https://notificacoes.itr.eng.br/assets/logo-whatsapp.jpeg',
                  },
                },
              ],
            },
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  parameter_name: 'order_service',
                  text: 'OS-TESTE-01/2026',
                },
                {
                  type: 'text',
                  parameter_name: 'order_status',
                  text: 'Relatório Pronto',
                },
              ],
            },
          ],
        },
      },
    };

    const resultado =
      validarPayloadControlado(
        preparado,
        destino
      );

    assert.equal(
      resultado.contrato,
      'v3'
    );

    assert.equal(
      resultado.quantidadeParametros,
      2
    );
  });
});

test('definição aprovada na Meta precisa coincidir com placeholders e header V3', () => {
  comEnv(envV3(), () => {
    const template = {
      id: 'template-teste',
      name:
        'atualizacao_ordem_servico_v3',
      language: 'pt_BR',
      status: 'APPROVED',
      parameter_format: 'NAMED',
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
        },
        {
          type: 'BODY',
          text:
            'Ordem: {{order_service}} Status: {{order_status}}',
        },
        {
          type: 'BUTTONS',
          buttons: [
            {
              type: 'URL',
              text: 'Portal do Cliente',
              url: 'https://portal.itr.eng.br/login.html',
            },
          ],
        },
      ],
    };

    assert.doesNotThrow(
      () =>
        validarDefinicaoTemplateMeta(
          template
        )
    );

    const incorreto = {
      ...template,
      components:
        template.components.map(
          item =>
            item.type === 'BODY'
              ? {
                  ...item,
                  text:
                    'Ordem: {{order_service}}',
                }
              : item
        ),
    };

    assert.throws(
      () =>
        validarDefinicaoTemplateMeta(
          incorreto
        ),
      /Placeholders BODY na Meta/
    );
  });
});

test('validação Meta de produção não exige WHATSAPP_TEST_NUMBER quando não há envio real', async () => {
  const env = {
    ...envV3(),
    WHATSAPP_ACCESS_TOKEN: 'TOKEN_FICTICIO',
    WHATSAPP_API_VERSION: 'v25.0',
    WHATSAPP_BUSINESS_ACCOUNT_ID: '1111111111111111',
    WHATSAPP_PHONE_NUMBER_ID: '2222222222222222',
    WHATSAPP_EXPECTED_WABA_ID: '1111111111111111',
    WHATSAPP_EXPECTED_PHONE_NUMBER_ID: '2222222222222222',
    WHATSAPP_TEST_NUMBER: '',
    WHATSAPP_COUNTRY_CODE: '55',
    WHATSAPP_NUMEROS_BLOQUEADOS: '',
    WHATSAPP_ATIVO: 'true',
    WHATSAPP_SIMULAR: 'false',
    WHATSAPP_MODO_TESTE: 'false',
    WHATSAPP_LOG_PAYLOAD: 'false',
    WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
    WHATSAPP_TIMEOUT_MS: '20000',
    WHATSAPP_MAX_TENTATIVAS: '1',
    WHATSAPP_RETRY_BASE_MS: '1',
    WHATSAPP_PAUSA_ENTRE_MENSAGENS_MS: '0',
  };

  const anterior = { ...process.env };
  const fetchAnterior = global.fetch;
  const logAnterior = console.log;
  const saidas = [];

  try {
    for (const chave of Object.keys(process.env)) delete process.env[chave];
    Object.assign(process.env, env);

    global.fetch = async url => {
      const u = String(url);

      if (u.includes('/message_templates')) {
        return new Response(JSON.stringify({
          data: [{
            id: 'template-1',
            name: 'atualizacao_ordem_servico_v3',
            language: 'pt_BR',
            status: 'APPROVED',
            category: 'UTILITY',
            parameter_format: 'NAMED',
            components: [
              { type: 'HEADER', format: 'IMAGE' },
              {
                type: 'BODY',
                text: 'Ordem {{order_service}} Status {{order_status}}',
              },
              {
                type: 'BUTTONS',
                buttons: [{
                  type: 'URL',
                  text: 'Portal do Cliente',
                  url: 'https://portal.itr.eng.br/login.html',
                }],
              },
            ],
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (u.includes('/phone_numbers')) {
        return new Response(JSON.stringify({
          data: [{
            id: '2222222222222222',
            display_phone_number: '+55 61 00000-0000',
            verified_name: 'ITR Engenharia',
            code_verification_status: 'VERIFIED',
            platform_type: 'CLOUD_API',
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (u === 'https://notificacoes.itr.eng.br/assets/logo-whatsapp.jpeg') {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }

      throw new Error(`URL inesperada no teste: ${u}`);
    };

    console.log = (...args) => {
      saidas.push(args.join(' '));
    };

    await executar();

    assert.ok(
      saidas.some(item =>
        item.includes('validacao-producao-sem-envio')
      )
    );
  } finally {
    console.log = logAnterior;
    global.fetch = fetchAnterior;
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, anterior);

    for (const modulo of [
      '../enviar_whatsapp.js',
      '../whatsapp_template.js',
    ]) {
      try {
        delete require.cache[
          require.resolve(modulo)
        ];
      } catch (_) {}
    }
  }
});
