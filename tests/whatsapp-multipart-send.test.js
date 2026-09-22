'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');

function executarCenario(script) {
  const saida = execFileSync(
    process.execPath,
    ['-e', script],
    {
      cwd: raiz,
      encoding: 'utf8',
      env: {
        ...process.env,
        WHATSAPP_ATIVO: 'true',
        WHATSAPP_SIMULAR: 'false',
        WHATSAPP_MODO_TESTE: 'false',
        WHATSAPP_COUNTRY_CODE: '55',
        WHATSAPP_ACCESS_TOKEN: 'token-controlado-teste',
        WHATSAPP_PHONE_NUMBER_ID: '2222222222222222',
        WHATSAPP_API_VERSION: 'v25.0',
        WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
        WHATSAPP_MAX_TENTATIVAS: '1',
        WHATSAPP_PAUSA_ENTRE_MENSAGENS_MS: '1',
        WHATSAPP_NUMEROS_BLOQUEADOS: '556195648450|5561995648450',
        WHATSAPP_BLOQUEIO_RIGIDO_NUMEROS: 'false',
        WHATSAPP_TEMPLATE_NAME: 'atualizacao_ordem_servico',
        WHATSAPP_TEMPLATE_LANGUAGE: 'pt_BR',
        WHATSAPP_TEMPLATE_PARAMETER_MODE: 'named',
        WHATSAPP_TEMPLATE_BODY_PARAMETERS: 'ordem_servico,detalhes',
        WHATSAPP_FORMATO_DETALHES: 'auto',
        WHATSAPP_DETALHES_MAX_CHARS: '800',
        WHATSAPP_TEMPLATE_BODY_MAX_CHARS: '1024',
        WHATSAPP_TEMPLATE_BODY_FIXED_CHARS: '306',
        WHATSAPP_TEMPLATE_BODY_SAFETY_MARGIN: '20',
      },
    }
  );

  const linha = saida
    .split(/\r?\n/)
    .find(item => item.startsWith('__RESULTADO__'));

  assert.ok(linha, `Resultado controlado ausente. Saída:\n${saida}`);
  return JSON.parse(linha.slice('__RESULTADO__'.length));
}

test('envio multipart tenta todas as partes para todos os destinatários', () => {
  const resultado = executarCenario(String.raw`
    let chamadas = 0;

    global.fetch = async () => {
      chamadas += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => '' },
        text: async () => JSON.stringify({
          messages: [{ id: 'wamid.TESTE.' + chamadas }],
        }),
      };
    };

    const { enviarWhatsAppDaOS } = require('./enviar_whatsapp.js');

    const telefones = [
      '5533000000003',
      '5522000000002',
      '5511000000001',
    ];

    const linhas = Array.from({ length: 84 }, (_, indice) => ({
      amostra: 'REG ' + (1500 + indice) + ' (ST-TCV-TPS-G21-' + (1000 + indice) + ')',
      ensaioNome: indice % 2 === 0
        ? 'Índice de Suporte Califórnia - Energia Normal'
        : 'Compactação Proctor Normal',
      ensaioSigla: indice % 2 === 0 ? 'CBR-N' : 'CP-N',
      status: indice % 2 === 0 ? 'Aguardando Preparação' : 'Enviado ao Cliente',
    }));

    (async () => {
      const r = await enviarWhatsAppDaOS({
        cliente: {
          clienteId: 'cliente-teste',
          clienteNome: 'Cliente Exemplo',
          whatsappsEncontrados: telefones,
          whatsappsParaEnvio: telefones,
          whatsappSeguroParaEnvio: true,
          whatsappDuplicadoEntreClientes: true,
          whatsappCompartilhadoBloqueante: false,
          whatsappMotivosBloqueio: [],
        },
        ordem: {
          osId: 'os-45-2026',
          osNome: '45-2026',
          linhas,
        },
      });

      console.log('__RESULTADO__' + JSON.stringify({
        ok: r.ok,
        enviado: r.enviado,
        parcial: r.parcial,
        chamadas,
        quantidadePartes: r.quantidadePartes,
        quantidadeMensagens: r.quantidadeMensagens,
        quantidadeMensagensEnviadas: r.quantidadeMensagensEnviadas,
        quantidadeDestinos: r.quantidadeDestinos,
        quantidadeEnviados: r.quantidadeEnviados,
        quantidadeFalhas: r.quantidadeFalhas,
      }));
    })().catch(erro => {
      console.error(erro);
      process.exitCode = 1;
    });
  `);

  assert.equal(resultado.ok, true);
  assert.equal(resultado.enviado, true);
  assert.equal(resultado.parcial, false);
  assert.equal(resultado.quantidadeDestinos, 3);
  assert.equal(resultado.quantidadeEnviados, 3);
  assert.equal(resultado.quantidadeFalhas, 0);
  assert.ok(resultado.quantidadePartes > 1);
  assert.equal(
    resultado.quantidadeMensagens,
    resultado.quantidadeDestinos * resultado.quantidadePartes
  );
  assert.equal(resultado.chamadas, resultado.quantidadeMensagens);
  assert.equal(
    resultado.quantidadeMensagensEnviadas,
    resultado.quantidadeMensagens
  );
});


test('lista legada informada pelo usuário permanece apenas em auditoria no modo padrão', () => {
  const resultado = executarCenario(String.raw`
    let chamadas = 0;

    global.fetch = async () => {
      chamadas += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => '' },
        text: async () => JSON.stringify({
          messages: [{ id: 'wamid.AUDITORIA.' + chamadas }],
        }),
      };
    };

    const { enviarWhatsAppDaOS } = require('./enviar_whatsapp.js');

    (async () => {
      const r = await enviarWhatsAppDaOS({
        cliente: {
          clienteId: 'cliente-lista-legada',
          clienteNome: 'Cliente Lista Legada',
          whatsappsEncontrados: [
            '556195648450',
            '5561995648450',
            '5511000000001',
          ],
          whatsappsParaEnvio: [
            '556195648450',
            '5561995648450',
            '5511000000001',
          ],
          whatsappSeguroParaEnvio: true,
          whatsappDuplicadoEntreClientes: false,
          whatsappCompartilhadoBloqueante: false,
          whatsappMotivosBloqueio: [],
        },
        ordem: {
          osId: 'os-lista-legada',
          osNome: 'OS LISTA LEGADA',
          linhas: [{
            amostra: 'A-01',
            ensaioNome: 'CBR',
            ensaioSigla: 'CBR',
            status: 'Enviado ao Cliente',
          }],
        },
      });

      console.log('__RESULTADO__' + JSON.stringify({
        ok: r.ok,
        chamadas,
        quantidadeDestinos: r.quantidadeDestinos,
        quantidadeEnviados: r.quantidadeEnviados,
        quantidadeFalhas: r.quantidadeFalhas,
      }));
    })().catch(erro => {
      console.error(erro);
      process.exitCode = 1;
    });
  `);

  assert.equal(resultado.ok, true);
  assert.equal(resultado.quantidadeDestinos, 3);
  assert.equal(resultado.quantidadeEnviados, 3);
  assert.equal(resultado.quantidadeFalhas, 0);
  assert.equal(resultado.chamadas, 3);
});
