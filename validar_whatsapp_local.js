'use strict';

process.env.WHATSAPP_TEMPLATE_NAME =
  'atualizacao_ordem_servico';

process.env.WHATSAPP_TEMPLATE_LANGUAGE =
  'pt_BR';

process.env.WHATSAPP_TEMPLATE_PARAMETER_MODE =
  'named';

process.env.WHATSAPP_TEMPLATE_BODY_PARAMETERS =
  'ordem_servico,detalhes';

process.env.WHATSAPP_FORMATO_DETALHES =
  'auto';

process.env.WHATSAPP_DETALHES_MAX_CHARS =
  '800';

process.env.WHATSAPP_TEMPLATE_BODY_MAX_CHARS =
  '1024';

process.env.WHATSAPP_TEMPLATE_BODY_FIXED_CHARS =
  '306';

process.env.WHATSAPP_TEMPLATE_BODY_SAFETY_MARGIN =
  '20';

process.env.WHATSAPP_TEMPLATE_HEADER_TYPE =
  'image';

process.env.WHATSAPP_TEMPLATE_HEADER_MEDIA_URL =
  'https://emails-diarios-itrengenharia.onrender.com/assets/logo-whatsapp.jpeg';

process.env.WHATSAPP_ATIVO =
  'false';

process.env.WHATSAPP_SIMULAR =
  'true';

process.env.WHATSAPP_MODO_TESTE =
  'true';

process.env.WHATSAPP_TEST_NUMBER =
  '5561999999999';

process.env.WHATSAPP_PHONE_NUMBER_ID =
  '123456789012345';

process.env.WHATSAPP_ACCESS_TOKEN =
  'TOKEN_LOCAL_NAO_USADO';

process.env.WHATSAPP_API_VERSION =
  'v25.0';

process.env.WHATSAPP_COUNTRY_CODE =
  '55';

process.env.WHATSAPP_NUMEROS_BLOQUEADOS =
  '5561988887777';

const assert =
  require('node:assert/strict');

const {
  montarPayloadTemplateWhatsApp,
  montarVariaveisDaOS,
  normalizarParametroMeta,
  validarPayloadTemplateMeta,
} = require('./whatsapp_template.js');

const {
  normalizarTelefone,
  validarSegurancaWhatsappCliente,
  prepararEnvioWhatsAppDaOS,
} = require('./enviar_whatsapp.js');

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

function clienteBase(
  alteracoes = {}
) {
  return {
    clienteId:
      'cliente-teste',

    clienteNome:
      'Cliente de teste',

    whatsapp:
      '61999999999',

    whatsappsEncontrados: [
      '5561999999999',
    ],

    whatsappAmbiguo:
      false,

    whatsappBloqueado:
      false,

    whatsappDuplicadoEntreClientes:
      false,

    whatsappSeguroParaEnvio:
      true,

    whatsappMotivosBloqueio:
      [],

    clientesComMesmoWhatsapp:
      [],

    ...alteracoes,
  };
}

function ordemBase(
  alteracoes = {}
) {
  return {
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

    ...alteracoes,
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

function prepararComCliente(
  alteracoesCliente = {}
) {
  return prepararEnvioWhatsAppDaOS({
    cliente:
      clienteBase(
        alteracoesCliente
      ),

    ordem:
      ordemBase(),
  });
}

function validarMensagemPequena() {
  const amostras = [
    [
      'REG 1593 (ST-TCV-TPS-G21-1089)',
      'CBR-N',
    ],
    [
      'REG 1573 (ST-TCV-TPS-G21-1078)',
      'CBR-N',
    ],
    [
      'REG 1592 (ST-TCV-TPS-G21-1089)',
      'CBR-I',
    ],
    [
      'REG 1621 (ST-TCV-TPS-G21-2006)',
      'CBR-N',
    ],
    [
      'REG 1623 (ST-TCV-TPS-G21-2007)',
      'CBR-I',
    ],
    [
      'REG 1594 (ST-TCV-TPS-G21-1089)',
      'CBR-I',
    ],
    [
      'REG 1615 (ST-TCV-TAC-C21-2005)',
      'CBR-I',
    ],
  ];

  const resultado =
    montarPayloadTemplateWhatsApp({
      cliente:
        clienteBase(),

      ordem: {
        osId:
          'os-43',

        osNome:
          'OS 43',

        linhas:
          amostras.map(
            ([
              amostra,
              ensaioSigla,
            ]) =>
              linha({
                amostra,
                ensaioSigla,
              })
          ),
      },

      telefone:
        '5561999999999',
    });

  assert.equal(
    resultado.ok,
    true
  );

  assert.equal(
    resultado.formatoDetalhes,
    'compacto'
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
    /^Status: Relatório Pronto/m
  );

  assert.match(
    detalhes,
    /Índice de Suporte Califórnia:/
  );

  assert.match(
    detalhes,
    /REG 1593 \(ST-TCV-TPS-G21-1089\)/
  );

  assert.match(
    detalhes,
    /1615 \(ST-TCV-TAC-C21-2005\)/
  );

  assert.equal(
    /[\r\n\t\u2028\u2029]/.test(
      detalhes
    ),
    false
  );

  assert.equal(
    / {5,}/.test(
      detalhes
    ),
    false
  );

  assert.equal(
    detalhes.includes(
      ' || '
    ),
    false
  );

  assert.equal(
    validarPayloadTemplateMeta(
      resultado.payload
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

  if (
    resultado.ok
  ) {
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

  assert.equal(
    normalizarTelefone(
      '123'
    ).ok,
    false
  );
}

function validarContatoSeguro() {
  const resultado =
    validarSegurancaWhatsappCliente(
      clienteBase()
    );

  assert.equal(
    resultado.ok,
    true
  );

  assert.equal(
    resultado.quantidadeNumerosEncontrados,
    1
  );
}

function validarPreparacao() {
  const resultado =
    prepararComCliente();

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

function validarBloqueioContatoInseguro() {
  const resultado =
    prepararComCliente({
      whatsappSeguroParaEnvio:
        false,
    });

  assert.equal(
    resultado.ok,
    false
  );

  assert.equal(
    resultado.motivo,
    'whatsapp-inseguro-para-envio'
  );
}

function validarBloqueioMarcadoNoAirtable() {
  const resultado =
    prepararComCliente({
      whatsappBloqueado:
        true,

      whatsappMotivosBloqueio: [
        'numero-bloqueado',
      ],
    });

  assert.equal(
    resultado.ok,
    false
  );

  assert.equal(
    resultado.motivo,
    'numero-bloqueado-no-airtable'
  );
}

function validarBloqueioNumeroCompartilhado() {
  const resultado =
    prepararComCliente({
      whatsappDuplicadoEntreClientes:
        true,

      whatsappAmbiguo:
        true,

      whatsappSeguroParaEnvio:
        false,

      whatsappMotivosBloqueio: [
        'numero-compartilhado-entre-clientes',
      ],

      clientesComMesmoWhatsapp: [
        'Cliente A',
        'Cliente B',
      ],
    });

  assert.equal(
    resultado.ok,
    false
  );

  assert.equal(
    resultado.motivo,
    'numero-compartilhado-entre-clientes'
  );

  assert.equal(
    resultado.clientesComMesmoWhatsapp.length,
    2
  );
}

function validarBloqueioContatoAmbiguo() {
  const resultado =
    prepararComCliente({
      whatsappAmbiguo:
        true,

      whatsappsEncontrados: [
        '5561999999999',
        '5561977776666',
      ],

      whatsappSeguroParaEnvio:
        false,

      whatsappMotivosBloqueio: [
        'cliente-com-mais-de-um-whatsapp',
      ],
    });

  assert.equal(
    resultado.ok,
    false
  );

  assert.equal(
    resultado.motivo,
    'cliente-com-mais-de-um-whatsapp'
  );

  assert.equal(
    resultado.quantidadeNumerosEncontrados,
    2
  );

  assert.equal(
    Array.isArray(
      resultado.numerosMascarados
    ),
    true
  );

  assert.equal(
    Object.hasOwn(
      resultado,
      'numeros'
    ),
    false
  );
}

function validarBloqueioContatoInvalido() {
  const resultado =
    prepararComCliente({
      whatsappInvalido:
        true,

      whatsappSeguroParaEnvio:
        false,

      whatsappMotivosBloqueio: [
        'telefone-invalido',
      ],
    });

  assert.equal(
    resultado.ok,
    false
  );

  assert.equal(
    resultado.motivo,
    'whatsapp-cliente-invalido'
  );
}

function validarBloqueioPorListaDoAmbiente() {
  const resultado =
    prepararComCliente({
      whatsapp:
        '61988887777',

      whatsappsEncontrados: [
        '5561988887777',
      ],

      whatsappSeguroParaEnvio:
        true,
    });

  assert.equal(
    resultado.ok,
    false
  );

  assert.equal(
    resultado.motivo,
    'numero-bloqueado'
  );

  assert.match(
    resultado.telefoneMascarado || '',
    /\*/
  );

  assert.equal(
    JSON.stringify(
      resultado
    ).includes(
      '5561988887777'
    ),
    false
  );
}

function validarCompatibilidadeModoTeste() {
  const resultado =
    prepararComCliente({
      whatsapp:
        '',

      whatsappsEncontrados:
        [],

      whatsappSeguroParaEnvio:
        undefined,
    });

  assert.equal(
    resultado.ok,
    true
  );

  assert.equal(
    resultado.origemDestino,
    'teste'
  );
}

function validarNormalizacao() {
  const valor =
    normalizarParametroMeta(
      'A\n\nB\tC ||  D'
    );

  assert.equal(
    valor,
    'A • B • C • D'
  );

  assert.equal(
    /[\r\n\t\u2028\u2029]/.test(
      valor
    ),
    false
  );

  assert.equal(
    valor.includes(
      '||'
    ),
    false
  );

  assert.equal(
    / {2,}/.test(
      valor
    ),
    false
  );

  assert.equal(
    /(?:•\s*){2,}/.test(
      valor
    ),
    false
  );
}

function validarPrioridadeNomeEnsaio() {
  const comNome =
    montarPayloadTemplateWhatsApp({
      cliente:
        clienteBase(),

      ordem: {
        osId:
          'os-nome-ensaio',

        osNome:
          'OS NOME ENSAIO',

        linhas: [
          linha({
            amostra:
              'A-01',

            ensaioNome:
              'Limite de Liquidez',

            ensaioSigla:
              'LL',
          }),
        ],
      },

      telefone:
        '5561999999999',
    });

  assert.equal(
    comNome.ok,
    true
  );

  const detalhesComNome =
    parametroNomeado(
      comNome.payload,
      'detalhes'
    )?.text || '';

  assert.match(
    detalhesComNome,
    /\*Ensaio:\* Limite de Liquidez/
  );

  assert.equal(
    detalhesComNome.includes(
      '*Ensaio:* LL'
    ),
    false
  );

  const semNome =
    montarPayloadTemplateWhatsApp({
      cliente:
        clienteBase(),

      ordem: {
        osId:
          'os-sigla-ensaio',

        osNome:
          'OS SIGLA ENSAIO',

        linhas: [
          linha({
            amostra:
              'A-02',

            ensaioNome:
              '',

            ensaioSigla:
              'LL',
          }),
        ],
      },

      telefone:
        '5561999999999',
    });

  assert.equal(
    semNome.ok,
    true
  );

  assert.match(
    parametroNomeado(
      semNome.payload,
      'detalhes'
    )?.text || '',

    /\*Ensaio:\* LL/
  );
}

function validarPayloadFinalCompativelComMeta() {
  const resultado =
    montarPayloadTemplateWhatsApp({
      cliente:
        clienteBase(),

      ordem: {
        osId:
          'os-payload-meta',

        osNome:
          'OS PAYLOAD META',

        linhas: [
          linha({
            amostra:
              'CP-01',

            ensaioNome:
              'Limite de Liquidez',
          }),

          linha({
            amostra:
              'CP-02',

            ensaioNome:
              'Módulo de Resiliência',
          }),
        ],
      },

      telefone:
        '5561999999999',
    });

  assert.equal(
    resultado.ok,
    true
  );

  const detalhes =
    parametroNomeado(
      resultado.payload,
      'detalhes'
    )?.text || '';

  assert.match(
    detalhes,
    /◆ \*1\) Amostra:\* CP-01/
  );

  assert.match(
    detalhes,
    / {2}◆ \*2\) Amostra:\* CP-02/
  );

  assert.equal(
    / {3,}/.test(
      detalhes
    ),
    false
  );

  assert.equal(
    /[\r\n\t\u2028\u2029]/.test(
      detalhes
    ),
    false
  );

  assert.equal(
    / {5,}/.test(
      detalhes
    ),
    false
  );

  assert.equal(
    validarPayloadTemplateMeta(
      resultado.payload
    ),
    true
  );
}

function executar() {
  validarMensagemPequena();
  validarDeduplicacao();
  validarFallbackCompactoOuBloqueioSeguro();
  validarTelefone();
  validarContatoSeguro();
  validarPreparacao();
  validarBloqueioContatoInseguro();
  validarBloqueioMarcadoNoAirtable();
  validarBloqueioNumeroCompartilhado();
  validarBloqueioContatoAmbiguo();
  validarBloqueioContatoInvalido();
  validarBloqueioPorListaDoAmbiente();
  validarCompatibilidadeModoTeste();
  validarNormalizacao();
  validarPrioridadeNomeEnsaio();
  validarPayloadFinalCompativelComMeta();

  console.log(
    'VALIDAÇÃO WHATSAPP: OK'
  );

  console.log(
    'TESTES EXECUTADOS: 16'
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

  console.log(
    'CONTATOS INSEGUROS: BLOQUEADOS'
  );

  console.log(
    'NÚMEROS COMPARTILHADOS: BLOQUEADOS'
  );

  console.log(
    'NÚMEROS PROIBIDOS: BLOQUEADOS'
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