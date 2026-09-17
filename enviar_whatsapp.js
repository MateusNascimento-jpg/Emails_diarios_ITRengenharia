'use strict';

// ============================================================
// enviar_whatsapp.js — ENVIO FINAL PELA WHATSAPP CLOUD API
// ============================================================
// Responsabilidades:
//
// 1. Receber um cliente e uma Ordem de Serviço já agrupada.
// 2. Escolher os telefones reais ou o telefone controlado de teste.
// 3. Normalizar o telefone para o padrão internacional.
// 4. Validar a segurança do contato consolidado pelo Airtable.
// 5. Bloquear números proibidos, inclusive o WhatsApp principal.
// 6. Gerar o payload pelo whatsapp_template.js.
// 7. Simular o envio enquanto a integração estiver desativada.
// 8. Enviar o template pela Meta Cloud API.
// 9. Aplicar timeout e tentativas controladas.
// 10. Nunca expor o token nos logs.
// 11. Retornar um resultado estruturado para enviar_todos.js.
//
// Regra definitiva:
//
// UMA ORDEM DE SERVIÇO = UMA NOTIFICAÇÃO POR DESTINATÁRIO.
//
// Quando a OS cabe no template, cada destinatário recebe uma mensagem.
// Quando a OS é grande, ela é dividida automaticamente em partes e cada
// destinatário recebe TODAS as partes. Um destino com falha não impede
// os demais destinos de continuarem sendo processados.
// ============================================================

require('dotenv').config();

const {
  montarPayloadTemplateWhatsApp,
  montarPayloadsTemplateWhatsApp,
} = require('./whatsapp_template.js');

// ============================================================
// LEITURA DO AMBIENTE
// ============================================================

function textoEnv(nome, padrao = '') {
  return String(
    process.env[nome] ?? padrao
  ).trim();
}

function booleanoEnv(nome, padrao = false) {
  const valor = textoEnv(nome);

  if (!valor) {
    return padrao;
  }

  return [
    '1',
    'true',
    'sim',
    'yes',
    'on',
  ].includes(valor.toLowerCase());
}

function numeroInteiroPositivo(
  valor,
  padrao
) {
  const numero = Number.parseInt(
    String(valor ?? ''),
    10
  );

  return Number.isInteger(numero) &&
    numero > 0
    ? numero
    : padrao;
}

function normalizarVersaoApi(valor) {
  const versao = String(
    valor || ''
  ).trim();

  if (!versao) {
    return 'v25.0';
  }

  if (/^v\d+\.\d+$/.test(versao)) {
    return versao;
  }

  if (/^\d+\.\d+$/.test(versao)) {
    return `v${versao}`;
  }

  return versao;
}

const CONFIG = Object.freeze({
  ativo: booleanoEnv(
    'WHATSAPP_ATIVO',
    false
  ),

  simular: booleanoEnv(
    'WHATSAPP_SIMULAR',
    true
  ),

  modoTeste: booleanoEnv(
    'WHATSAPP_MODO_TESTE',
    true
  ),

  numeroTeste: textoEnv(
    'WHATSAPP_TEST_NUMBER'
  ),

  codigoPaisPadrao: textoEnv(
    'WHATSAPP_COUNTRY_CODE',
    '55'
  ).replace(/\D/g, ''),

  accessToken: textoEnv(
    'WHATSAPP_ACCESS_TOKEN'
  ),

  phoneNumberId: textoEnv(
    'WHATSAPP_PHONE_NUMBER_ID'
  ),

  businessAccountId: textoEnv(
    'WHATSAPP_BUSINESS_ACCOUNT_ID'
  ),

  apiVersion: normalizarVersaoApi(
    textoEnv(
      'WHATSAPP_API_VERSION',
      'v25.0'
    )
  ),

  graphBaseUrl: textoEnv(
    'WHATSAPP_GRAPH_BASE_URL',
    'https://graph.facebook.com'
  ).replace(/\/+$/, ''),

  timeoutMs: numeroInteiroPositivo(
    process.env.WHATSAPP_TIMEOUT_MS,
    20000
  ),

  maxTentativas: numeroInteiroPositivo(
    process.env.WHATSAPP_MAX_TENTATIVAS,
    1
  ),

  esperaEntreTentativasMs:
    numeroInteiroPositivo(
      process.env.WHATSAPP_RETRY_BASE_MS,
      1500
    ),

  pausaEntreMensagensMs:
    numeroInteiroPositivo(
      process.env.WHATSAPP_PAUSA_ENTRE_MENSAGENS_MS,
      250
    ),

  logPayload: booleanoEnv(
    'WHATSAPP_LOG_PAYLOAD',
    false
  ),

  numerosBloqueados: textoEnv(
    'WHATSAPP_NUMEROS_BLOQUEADOS'
  ),

  bloqueioRigidoNumeros: booleanoEnv(
    'WHATSAPP_BLOQUEIO_RIGIDO_NUMEROS',
    false
  ),
});

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function dormir(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function limparTexto(valor) {
  return String(
    valor ?? ''
  ).trim();
}

function somenteDigitos(valor) {
  return String(
    valor ?? ''
  ).replace(/\D/g, '');
}

function mascararTelefone(telefone) {
  const digitos =
    somenteDigitos(telefone);

  if (!digitos) {
    return '(não informado)';
  }

  if (digitos.length <= 4) {
    return '*'.repeat(
      digitos.length
    );
  }

  const inicio =
    digitos.slice(0, 4);

  const final =
    digitos.slice(-4);

  const ocultos =
    '*'.repeat(
      Math.max(
        digitos.length - 8,
        3
      )
    );

  return `${inicio}${ocultos}${final}`;
}

function mascararId(valor) {
  const texto = limparTexto(valor);

  if (!texto) {
    return '(não informado)';
  }

  if (texto.length <= 8) {
    return '*'.repeat(
      texto.length
    );
  }

  return (
    texto.slice(0, 4) +
    '*'.repeat(
      Math.max(
        texto.length - 8,
        4
      )
    ) +
    texto.slice(-4)
  );
}

function dividirLista(valor) {
  return String(
    valor ?? ''
  )
    .split(/[;,|\n\r/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function valorEhVerdadeiro(valor) {
  if (valor === true) {
    return true;
  }

  if (
    valor === false ||
    valor === null ||
    valor === undefined
  ) {
    return false;
  }

  return [
    '1',
    'true',
    'sim',
    'yes',
    'on',
  ].includes(
    limparTexto(valor)
      .toLowerCase()
  );
}

function valorEhFalsoExplicito(
  valor
) {
  if (valor === false) {
    return true;
  }

  if (
    valor === true ||
    valor === null ||
    valor === undefined ||
    limparTexto(valor) === ''
  ) {
    return false;
  }

  return [
    '0',
    'false',
    'nao',
    'não',
    'no',
    'off',
  ].includes(
    limparTexto(valor)
      .toLowerCase()
  );
}

function listaNormalizada(
  valor
) {
  const itensBrutos =
    Array.isArray(valor)
      ? valor.flat(Infinity)
      : (
          valor instanceof Set
            ? [...valor]
            : [valor]
        );

  const itens = itensBrutos
    .flatMap(item =>
      dividirLista(item)
    )
    .map(item =>
      limparTexto(item)
    )
    .filter(Boolean);

  return [
    ...new Set(itens),
  ];
}

function normalizarMotivo(
  valor
) {
  return limparTexto(valor)
    .toLowerCase()
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .replace(
      /[^a-z0-9]+/g,
      '-'
    )
    .replace(
      /^-+|-+$/g,
      ''
    );
}

// ============================================================
// NORMALIZAÇÃO DO TELEFONE
// ============================================================

function normalizarTelefone(
  valor,
  codigoPaisPadrao =
    CONFIG.codigoPaisPadrao
) {
  const original =
    limparTexto(valor);

  if (!original) {
    return {
      ok: false,
      motivo: 'telefone-vazio',
      original,
      telefone: '',
    };
  }

  let digitos =
    somenteDigitos(original);

  if (digitos.startsWith('00')) {
    digitos =
      digitos.slice(2);
  }

  if (
    digitos.startsWith('0') &&
    (digitos.length === 11 || digitos.length === 12)
  ) {
    const semZero = digitos.slice(1);

    if (
      semZero.length === 10 ||
      semZero.length === 11
    ) {
      digitos = semZero;
    }
  }

  if (
    codigoPaisPadrao === '55' &&
    digitos.startsWith('550') &&
    (digitos.length === 13 || digitos.length === 14)
  ) {
    digitos = `55${digitos.slice(3)}`;
  }

  if (
    codigoPaisPadrao &&
    (
      digitos.length === 10 ||
      digitos.length === 11
    )
  ) {
    digitos =
      `${codigoPaisPadrao}${digitos}`;
  }

  if (
    !/^[1-9]\d{7,14}$/.test(
      digitos
    )
  ) {
    return {
      ok: false,
      motivo: 'telefone-invalido',
      original,
      telefone: digitos,
    };
  }

  return {
    ok: true,
    motivo: '',
    original,
    telefone: digitos,
  };
}

function normalizarListaTelefones(valor) {
  const itens =
    listaNormalizada(valor);

  const validos = new Map();
  const invalidos = [];

  for (const item of itens) {
    const normalizado =
      normalizarTelefone(item);

    if (!normalizado.ok) {
      invalidos.push({
        original:
          normalizado.original,

        motivo:
          normalizado.motivo,
      });

      continue;
    }

    if (
      !validos.has(
        normalizado.telefone
      )
    ) {
      validos.set(
        normalizado.telefone,
        normalizado.original
      );
    }
  }

  return {
    validos: [
      ...validos.entries(),
    ].map(
      ([telefone, original]) => ({
        telefone,
        original,
      })
    ),

    invalidos,
  };
}

// ============================================================
// NÚMEROS BLOQUEADOS
// ============================================================

function obterNumerosBloqueados() {
  const bloqueados = new Set();

  for (
    const item of dividirLista(
      CONFIG.numerosBloqueados
    )
  ) {
    const normalizado =
      normalizarTelefone(item);

    if (normalizado.ok) {
      bloqueados.add(
        normalizado.telefone
      );
    }
  }

  return bloqueados;
}

function telefoneEstaBloqueado(
  telefone
) {
  if (!CONFIG.bloqueioRigidoNumeros) {
    return false;
  }

  return obterNumerosBloqueados()
    .has(telefone);
}

function telefoneEstaListadoParaAuditoria(
  telefone
) {
  return obterNumerosBloqueados()
    .has(telefone);
}

// ============================================================
// BLINDAGEM DO CONTATO CONSOLIDADO PELO AIRTABLE
// ============================================================

function validarSegurancaWhatsappCliente(
  cliente,
  {
    modoTeste =
      CONFIG.modoTeste,
  } = {}
) {
  if (!cliente) {
    return {
      ok: false,

      motivo:
        'cliente-ausente',

      mensagem:
        'Não foi possível validar o contato sem o cliente.',
    };
  }

  const motivosOriginais =
    listaNormalizada(
      cliente
        ?.whatsappMotivosBloqueio
    );

  const motivosNormalizados =
    new Set(
      motivosOriginais.map(
        normalizarMotivo
      )
    );

  const fontesTelefones =
    Array.isArray(
      cliente?.whatsappsParaEnvio
    ) &&
    cliente.whatsappsParaEnvio.length > 0
      ? cliente.whatsappsParaEnvio
      : (
          Array.isArray(
            cliente?.whatsappsEncontrados
          ) &&
          cliente.whatsappsEncontrados.length > 0
            ? cliente.whatsappsEncontrados
            : cliente?.whatsapp
        );

  const telefonesAnalisados =
    normalizarListaTelefones(
      fontesTelefones
    );

  const telefonesCliente =
    telefonesAnalisados.validos;

  const numerosMascarados =
    telefonesCliente.map(
      item =>
        mascararTelefone(
          item.telefone
        )
    );

  const respostaBase = {
    clienteId:
      cliente?.clienteId || '',

    clienteNome:
      cliente?.clienteNome || '',

    motivosOriginais,

    quantidadeNumerosEncontrados:
      telefonesCliente.length,

    quantidadeNumerosInvalidos:
      telefonesAnalisados
        .invalidos.length,

    numerosMascarados,

    telefoneMascarado:
      numerosMascarados[0] || '',
  };

  const numeroCompartilhado =
    valorEhVerdadeiro(
      cliente
        ?.whatsappDuplicadoEntreClientes
    );

  const compartilhadoBloqueante =
    valorEhVerdadeiro(
      cliente
        ?.whatsappCompartilhadoBloqueante
    ) ||
    motivosNormalizados.has(
      'numero-compartilhado-entre-clientes'
    ) ||
    motivosNormalizados.has(
      'whatsapp-compartilhado-bloqueante'
    );

  if (compartilhadoBloqueante) {
    return {
      ok: false,

      motivo:
        'numero-compartilhado-entre-clientes',

      mensagem:
        'Ao menos um número foi associado a mais de um cliente ' +
        'e a configuração atual exige bloqueio.',

      clientesComMesmoWhatsapp:
        listaNormalizada(
          cliente
            ?.clientesComMesmoWhatsapp
        ),

      ...respostaBase,
    };
  }

  const contatoAmbiguoNaoRelacionadoAMultiplos =
    valorEhVerdadeiro(
      cliente?.whatsappAmbiguo
    ) &&
    telefonesCliente.length <= 1;

  if (
    contatoAmbiguoNaoRelacionadoAMultiplos
  ) {
    return {
      ok: false,

      motivo:
        'whatsapp-ambiguo',

      mensagem:
        'O contato do cliente foi marcado como ambíguo.',

      ...respostaBase,
    };
  }

  const contatoMarcadoInvalido =
    valorEhVerdadeiro(
      cliente
        ?.whatsappInvalido
    ) ||
    valorEhVerdadeiro(
      cliente
        ?.telefoneInvalido
    ) ||
    valorEhFalsoExplicito(
      cliente
        ?.whatsappValido
    ) ||
    motivosNormalizados.has(
      'telefone-invalido'
    ) ||
    motivosNormalizados.has(
      'whatsapp-invalido'
    ) ||
    motivosNormalizados.has(
      'whatsapp-cliente-invalido'
    );

  if (contatoMarcadoInvalido) {
    return {
      ok: false,

      motivo:
        'whatsapp-cliente-invalido',

      mensagem:
        'O contato do cliente foi marcado como inválido ' +
        'durante a consolidação do Airtable.',

      ...respostaBase,
    };
  }

  const numerosBloqueados =
    telefonesCliente.filter(
      item =>
        telefoneEstaBloqueado(
          item.telefone
        )
    );

  const telefonesPermitidos =
    telefonesCliente.filter(
      item =>
        !telefoneEstaBloqueado(
          item.telefone
        )
    );

  if (
    !modoTeste &&
    telefonesCliente.length > 0 &&
    telefonesPermitidos.length === 0
  ) {
    return {
      ok: false,

      motivo:
        'todos-numeros-bloqueados',

      mensagem:
        'Todos os números válidos do cliente estão bloqueados.',

      numerosBloqueadosMascarados:
        numerosBloqueados.map(
          item =>
            mascararTelefone(
              item.telefone
            )
        ),

      ...respostaBase,
    };
  }

  const marcadoComoInseguro =
    valorEhFalsoExplicito(
      cliente
        ?.whatsappSeguroParaEnvio
    );

  if (marcadoComoInseguro) {
    return {
      ok: false,

      motivo:
        'whatsapp-inseguro-para-envio',

      mensagem:
        'O Airtable marcou o contato como não seguro ' +
        'para envio de WhatsApp.',

      ...respostaBase,
    };
  }

  if (
    !modoTeste &&
    telefonesPermitidos.length === 0
  ) {
    return {
      ok: false,

      motivo:
        'cliente-sem-whatsapp',

      mensagem:
        'O Airtable não retornou nenhum número válido e seguro ' +
        'para este cliente.',

      ...respostaBase,
    };
  }

  return {
    ok: true,

    motivo:
      '',

    mensagem:
      '',

    telefoneCliente:
      telefonesPermitidos[0]
        ?.original || '',

    telefonesCliente:
      telefonesPermitidos,

    numerosBloqueadosMascarados:
      numerosBloqueados.map(
        item =>
          mascararTelefone(
            item.telefone
          )
      ),

    numeroCompartilhado,

    clientesComMesmoWhatsapp:
      listaNormalizada(
        cliente
          ?.clientesComMesmoWhatsapp
      ),

    ...respostaBase,
  };
}

// ============================================================
// ESCOLHA DOS DESTINATÁRIOS
// ============================================================

function escolherTelefonesDestino(
  cliente
) {
  const segurancaCliente =
    validarSegurancaWhatsappCliente(
      cliente
    );

  if (!segurancaCliente.ok) {
    return segurancaCliente;
  }

  if (CONFIG.modoTeste) {
    if (!CONFIG.numeroTeste) {
      return {
        ok: false,

        motivo:
          'numero-teste-nao-configurado',

        mensagem:
          'WHATSAPP_MODO_TESTE=true, mas ' +
          'WHATSAPP_TEST_NUMBER está vazio.',
      };
    }

    const normalizado =
      normalizarTelefone(
        CONFIG.numeroTeste
      );

    if (!normalizado.ok) {
      return {
        ok: false,

        motivo:
          'numero-teste-invalido',

        mensagem:
          'WHATSAPP_TEST_NUMBER não possui ' +
          'um telefone internacional válido.',

        telefoneMascarado:
          mascararTelefone(
            CONFIG.numeroTeste
          ),
      };
    }

    return {
      ok: true,

      destinos: [
        {
          telefone:
            normalizado.telefone,

          origem:
            'teste',

          telefoneOriginal:
            CONFIG.numeroTeste,
        },
      ],

      segurancaCliente,
    };
  }

  const destinos =
    segurancaCliente
      .telefonesCliente
      .map(item => ({
        telefone:
          item.telefone,

        origem:
          'airtable',

        telefoneOriginal:
          item.original,
      }));

  if (destinos.length === 0) {
    return {
      ok: false,

      motivo:
        'cliente-sem-whatsapp',

      mensagem:
        'O Airtable não retornou nenhum número ' +
        'válido e seguro para este cliente.',
    };
  }

  return {
    ok: true,
    destinos,
    segurancaCliente,
  };
}

function escolherTelefoneDestino(
  cliente
) {
  const resultado =
    escolherTelefonesDestino(cliente);

  if (!resultado.ok) {
    return resultado;
  }

  return {
    ok: true,

    ...resultado.destinos[0],

    segurancaCliente:
      resultado.segurancaCliente,
  };
}

// ============================================================
// VALIDAÇÃO DA CONFIGURAÇÃO DA META
// ============================================================

function validarConfiguracaoMeta() {
  const ausentes = [];

  if (!CONFIG.accessToken) {
    ausentes.push(
      'WHATSAPP_ACCESS_TOKEN'
    );
  }

  if (!CONFIG.phoneNumberId) {
    ausentes.push(
      'WHATSAPP_PHONE_NUMBER_ID'
    );
  }

  if (!CONFIG.apiVersion) {
    ausentes.push(
      'WHATSAPP_API_VERSION'
    );
  }

  if (!CONFIG.graphBaseUrl) {
    ausentes.push(
      'WHATSAPP_GRAPH_BASE_URL'
    );
  }

  if (ausentes.length > 0) {
    return {
      ok: false,

      motivo:
        'configuracao-meta-incompleta',

      mensagem:
        `Variáveis ausentes: ` +
        `${ausentes.join(', ')}`,

      ausentes,
    };
  }

  if (
    !/^v\d+\.\d+$/.test(
      CONFIG.apiVersion
    )
  ) {
    return {
      ok: false,

      motivo:
        'versao-api-invalida',

      mensagem:
        'WHATSAPP_API_VERSION deve seguir ' +
        'o formato v25.0, v26.0 etc.',
    };
  }

  if (
    !/^\d+$/.test(
      CONFIG.phoneNumberId
    )
  ) {
    return {
      ok: false,

      motivo:
        'phone-number-id-invalido',

      mensagem:
        'WHATSAPP_PHONE_NUMBER_ID deve conter ' +
        'somente números.',
    };
  }

  try {
    const graphUrl =
      new URL(
        CONFIG.graphBaseUrl
      );

    if (
      graphUrl.protocol !== 'https:'
    ) {
      throw new Error(
        'protocolo'
      );
    }
  } catch {
    return {
      ok: false,

      motivo:
        'graph-base-url-invalida',

      mensagem:
        'WHATSAPP_GRAPH_BASE_URL deve ser ' +
        'uma URL HTTPS válida.',
    };
  }

  return {
    ok: true,
    ausentes: [],
  };
}

// ============================================================
// LOG SEGURO DO PAYLOAD
// ============================================================

function payloadSeguroParaLog(
  payload
) {
  if (!payload) {
    return null;
  }

  const seguro = JSON.parse(
    JSON.stringify(payload)
  );

  seguro.to =
    mascararTelefone(
      seguro.to
    );

  const componentes =
    seguro?.template?.components;

  if (Array.isArray(componentes)) {
    for (
      const componente
      of componentes
    ) {
      if (
        !Array.isArray(
          componente?.parameters
        )
      ) {
        continue;
      }

      componente.parameters =
        componente.parameters.map(
          parametro => {
            if (
              parametro?.type === 'text'
            ) {
              const tamanho =
                String(
                  parametro.text ?? ''
                ).length;

              return {
                type:
                  'text',

                parameter_name:
                  parametro.parameter_name,

                text:
                  `[CONTEÚDO OCULTO: ` +
                  `${tamanho} caractere(s)]`,
              };
            }

            if (
              parametro?.image?.link
            ) {
              return {
                type:
                  'image',

                image: {
                  link:
                    '[URL HTTPS CONFIGURADA]',
                },
              };
            }

            if (
              parametro?.image?.id
            ) {
              return {
                type:
                  'image',

                image: {
                  id:
                    '[MEDIA ID OCULTO]',
                },
              };
            }

            return parametro;
          }
        );
    }
  }

  return seguro;
}

// ============================================================
// LEITURA SEGURA DA RESPOSTA
// ============================================================

async function lerRespostaMeta(
  resposta
) {
  const texto =
    await resposta.text();

  if (!texto) {
    return {};
  }

  try {
    return JSON.parse(texto);
  } catch {
    return {
      resposta_texto:
        texto.slice(0, 3000),
    };
  }
}

function extrairMensagemErroMeta(
  dados,
  statusHttp
) {
  const erro =
    dados?.error || {};

  const partes = [
    erro.message,
    erro.error_data?.details,
    erro.error_user_msg,
    erro.error_user_title,
  ]
    .map(item =>
      limparTexto(item)
    )
    .filter(Boolean);

  if (partes.length > 0) {
    return partes.join(' | ');
  }

  return (
    `A Meta respondeu HTTP ` +
    `${statusHttp}.`
  );
}

function statusPodeSerRetentado(
  statusHttp
) {
  return (
    statusHttp === 408 ||
    statusHttp === 429 ||
    statusHttp >= 500
  );
}

function calcularEspera(
  resposta,
  tentativa
) {
  const retryAfter = Number(
    resposta?.headers?.get(
      'retry-after'
    )
  );

  if (
    Number.isFinite(retryAfter) &&
    retryAfter > 0
  ) {
    return retryAfter * 1000;
  }

  return (
    CONFIG.esperaEntreTentativasMs *
    tentativa
  );
}

// ============================================================
// REQUISIÇÃO REAL À META
// ============================================================

async function requisitarMeta(
  payload
) {
  if (
    typeof fetch !== 'function'
  ) {
    throw new Error(
      'O ambiente Node.js não possui fetch. ' +
      'Utilize Node.js 20 ou superior.'
    );
  }

  const endpoint =
    `${CONFIG.graphBaseUrl}/` +
    `${CONFIG.apiVersion}/` +
    `${encodeURIComponent(
      CONFIG.phoneNumberId
    )}/messages`;

  let ultimoResultado = null;

  for (
    let tentativa = 1;
    tentativa <=
      CONFIG.maxTentativas;
    tentativa += 1
  ) {
    const controlador =
      new AbortController();

    const temporizador =
      setTimeout(
        () =>
          controlador.abort(),

        CONFIG.timeoutMs
      );

    try {
      const resposta =
        await fetch(
          endpoint,
          {
            method:
              'POST',

            headers: {
              Authorization:
                `Bearer ${CONFIG.accessToken}`,

              'Content-Type':
                'application/json',

              Accept:
                'application/json',
            },

            body:
              JSON.stringify(
                payload
              ),

            signal:
              controlador.signal,
          }
        );

      const dados =
        await lerRespostaMeta(
          resposta
        );

      const requestId =
        resposta.headers.get(
          'x-fb-trace-id'
        ) ||
        resposta.headers.get(
          'x-business-use-case-usage'
        ) ||
        '';

      if (resposta.ok) {
        const messageId =
          dados?.messages?.[0]?.id ||
          '';

        if (!messageId) {
          return {
            ok: false,

            statusHttp:
              resposta.status,

            dados,

            messageId:
              '',

            requestId,

            tentativa,

            mensagem:
              'A Meta respondeu com sucesso, ' +
              'mas não retornou o ID da mensagem.',

            tipoErro:
              'resposta-meta-sem-message-id',
          };
        }

        return {
          ok: true,

          statusHttp:
            resposta.status,

          dados,

          messageId,

          requestId,

          tentativa,

          endpoint:
            `${CONFIG.graphBaseUrl}/` +
            `${CONFIG.apiVersion}/` +
            `***PHONE_NUMBER_ID***/messages`,
        };
      }

      ultimoResultado = {
        ok: false,

        statusHttp:
          resposta.status,

        dados,

        requestId,

        tentativa,

        mensagem:
          extrairMensagemErroMeta(
            dados,
            resposta.status
          ),
      };

      const deveRepetir =
        tentativa <
          CONFIG.maxTentativas &&
        statusPodeSerRetentado(
          resposta.status
        );

      if (!deveRepetir) {
        return ultimoResultado;
      }

      const espera =
        calcularEspera(
          resposta,
          tentativa
        );

      console.warn(
        `[WhatsApp/Meta] HTTP ` +
        `${resposta.status}. ` +
        `Nova tentativa em ${espera} ms ` +
        `(${tentativa}/` +
        `${CONFIG.maxTentativas}).`
      );

      await dormir(espera);
    } catch (erro) {
      const foiTimeout =
        erro?.name ===
        'AbortError';

      ultimoResultado = {
        ok: false,

        statusHttp:
          0,

        dados:
          {},

        requestId:
          '',

        tentativa,

        mensagem:
          foiTimeout
            ? (
                `A Meta não respondeu em ` +
                `${CONFIG.timeoutMs} ms.`
              )
            : (
                erro?.message ||
                'Falha de rede ao acessar a Meta.'
              ),

        tipoErro:
          foiTimeout
            ? 'timeout'
            : 'rede',
      };

      return ultimoResultado;
    } finally {
      clearTimeout(
        temporizador
      );
    }
  }

  return (
    ultimoResultado || {
      ok: false,

      statusHttp:
        0,

      dados:
        {},

      mensagem:
        'Falha desconhecida no envio à Meta.',
    }
  );
}

// ============================================================
// PREPARAÇÃO DO ENVIO DA OS
// ============================================================

function prepararEnvioWhatsAppDaOS({
  cliente,
  ordem,
} = {}) {
  if (!cliente) {
    return {
      ok: false,
      motivo:
        'cliente-ausente',
      mensagem:
        'O envio não recebeu o cliente.',
    };
  }

  if (!ordem) {
    return {
      ok: false,
      motivo:
        'ordem-ausente',
      mensagem:
        'O envio não recebeu a Ordem de Serviço.',
    };
  }

  const destinosResultado =
    escolherTelefonesDestino(
      cliente
    );

  if (!destinosResultado.ok) {
    return {
      ...destinosResultado,
      clienteId:
        cliente?.clienteId || '',
      clienteNome:
        cliente?.clienteNome || '',
      osId:
        ordem?.osId || '',
      osNome:
        ordem?.osNome ||
        ordem?.osId ||
        '',
    };
  }

  const envios = [];
  const destinosIgnorados = [];
  const falhasPreparacao = [];
  const telefonesMascarados = [];
  let referenciaResultado = null;
  let quantidadePartes = 0;
  let quantidadeItens = 0;
  let indiceDestinoValido = 0;

  for (
    const destino
    of destinosResultado.destinos
  ) {
    if (
      telefoneEstaBloqueado(
        destino.telefone
      )
    ) {
      destinosIgnorados.push({
        telefoneMascarado:
          mascararTelefone(
            destino.telefone
          ),
        motivo:
          'numero-bloqueado',
      });

      continue;
    }

    const resultadoPayloads =
      montarPayloadsTemplateWhatsApp({
        cliente,
        ordem,
        telefone:
          destino.telefone,
      });

    if (!resultadoPayloads.ok) {
      falhasPreparacao.push({
        telefoneMascarado:
          mascararTelefone(
            destino.telefone
          ),
        motivo:
          resultadoPayloads.motivo ||
          'falha-preparacao',
        mensagem:
          resultadoPayloads.mensagem || '',
      });

      continue;
    }

    indiceDestinoValido += 1;

    if (!referenciaResultado) {
      referenciaResultado =
        resultadoPayloads
          .partes[0];

      quantidadePartes =
        resultadoPayloads
          .quantidadePartes;

      quantidadeItens =
        resultadoPayloads
          .quantidadeItens;
    }

    const telefoneMascarado =
      mascararTelefone(
        destino.telefone
      );

    telefonesMascarados.push(
      telefoneMascarado
    );

    for (
      const parte
      of resultadoPayloads.partes
    ) {
      envios.push({
        payload:
          parte.payload,

        telefone:
          destino.telefone,

        telefoneMascarado,

        origemDestino:
          destino.origem,

        telefoneOriginal:
          destino.telefoneOriginal,

        indiceDestino:
          indiceDestinoValido,

        indiceParte:
          parte.parteAtual || 1,

        quantidadePartes:
          parte.totalPartes ||
          resultadoPayloads
            .quantidadePartes || 1,

        quantidadeItensParte:
          parte.quantidadeItens || 0,

        quantidadeItensTotal:
          parte.quantidadeItensTotal ||
          resultadoPayloads
            .quantidadeItens || 0,

        formatoDetalhes:
          parte.formatoDetalhes,

        tamanhoDetalhes:
          parte.tamanhoDetalhes,

        tamanhoCorpoEstimado:
          parte.tamanhoCorpoEstimado,

        limiteCorpo:
          parte.limiteCorpo,

        ordemServico:
          parte.ordemServico,
      });
    }
  }

  if (envios.length === 0) {
    const falha =
      falhasPreparacao[0] ||
      destinosIgnorados[0] || {
        motivo:
          'cliente-sem-whatsapp',
        mensagem:
          'Nenhum destino pôde ser preparado.',
      };

    return {
      ok: false,
      motivo:
        falha.motivo ||
        'falha-preparacao',
      mensagem:
        falha.mensagem ||
        'Nenhum destino pôde ser preparado.',
      destinosIgnorados,
      falhasPreparacao,
      clienteId:
        cliente?.clienteId || '',
      clienteNome:
        cliente?.clienteNome || '',
      osId:
        ordem?.osId || '',
      osNome:
        ordem?.osNome ||
        ordem?.osId ||
        '',
    };
  }

  const primeiroEnvio =
    envios[0];

  const referencia =
    referenciaResultado;

  return {
    ok: true,

    envios,

    multipart:
      quantidadePartes > 1,

    quantidadePartes,

    quantidadeMensagens:
      envios.length,

    quantidadeDestinos:
      indiceDestinoValido,

    quantidadeDestinosIgnorados:
      destinosIgnorados.length,

    quantidadeFalhasPreparacao:
      falhasPreparacao.length,

    destinosIgnorados,
    falhasPreparacao,

    telefonesMascarados,

    payload:
      primeiroEnvio.payload,

    telefone:
      primeiroEnvio.telefone,

    telefoneMascarado:
      primeiroEnvio.telefoneMascarado,

    origemDestino:
      primeiroEnvio.origemDestino,

    contexto:
      referencia.contexto,

    itens:
      referencia.itens,

    quantidadeItens:
      quantidadeItens ||
      referencia.quantidadeItensTotal ||
      referencia.quantidadeItens,

    formatoDetalhes:
      referencia.formatoDetalhes,

    tamanhoDetalhes:
      referencia.tamanhoDetalhes,

    tamanhoCorpoEstimado:
      referencia.tamanhoCorpoEstimado,

    limiteCorpo:
      referencia.limiteCorpo,

    clienteId:
      referencia.clienteId,

    clienteNome:
      referencia.clienteNome,

    osId:
      referencia.osId,

    osNome:
      referencia.osNome,
  };
}

// ============================================================
// ENVIO PRINCIPAL
// ============================================================

async function enviarWhatsAppDaOS({
  cliente,
  ordem,
} = {}) {
  const identificacaoOs =
    ordem?.osNome ||
    ordem?.osId ||
    '(OS não informada)';

  const identificacaoCliente =
    cliente?.clienteNome ||
    cliente?.clienteId ||
    '(cliente não informado)';

  if (!CONFIG.ativo) {
    console.log(
      `[WhatsApp] Desativado: ` +
      `${identificacaoCliente} | ` +
      `${identificacaoOs}`
    );

    return {
      ok: true,
      enviado: false,
      simulado: false,
      ignorado: true,
      motivo: 'whatsapp-desativado',
      clienteId:
        cliente?.clienteId || '',
      clienteNome:
        cliente?.clienteNome || '',
      osId:
        ordem?.osId || '',
      osNome:
        identificacaoOs,
    };
  }

  const preparado =
    prepararEnvioWhatsAppDaOS({
      cliente,
      ordem,
    });

  if (!preparado.ok) {
    console.error(
      `[WhatsApp] OS não enviada: ` +
      `${identificacaoCliente} | ` +
      `${identificacaoOs} | ` +
      `${preparado.motivo || 'erro'} | ` +
      `${preparado.mensagem || ''}`
    );

    return {
      ...preparado,
      enviado: false,
      simulado: false,
      ignorado: false,
    };
  }

  if (preparado.multipart) {
    console.log(
      `[WhatsApp] OS grande dividida automaticamente: ` +
      `${preparado.clienteNome} | ` +
      `${preparado.osNome} | ` +
      `${preparado.quantidadeItens} item(ns) | ` +
      `${preparado.quantidadePartes} parte(s) por destinatário | ` +
      `${preparado.quantidadeDestinos} destinatário(s).`
    );
  }

  if (
    preparado.quantidadeDestinosIgnorados > 0 ||
    preparado.quantidadeFalhasPreparacao > 0
  ) {
    console.warn(
      `[WhatsApp] Preparação parcial: ` +
      `${preparado.quantidadeDestinosIgnorados} destino(s) ignorado(s), ` +
      `${preparado.quantidadeFalhasPreparacao} falha(s) de preparação. ` +
      `Os demais continuarão.`
    );
  }

  if (CONFIG.logPayload) {
    preparado.envios.forEach(
      (envio, indice) => {
        console.log(
          `[WhatsApp] Payload preparado ` +
          `${indice + 1}/` +
          `${preparado.quantidadeMensagens} ` +
          `(destino ${envio.indiceDestino}/${preparado.quantidadeDestinos}, ` +
          `parte ${envio.indiceParte}/${envio.quantidadePartes}):`,

          JSON.stringify(
            payloadSeguroParaLog(
              envio.payload
            ),
            null,
            2
          )
        );
      }
    );
  }

  if (CONFIG.simular) {
    console.log(
      `[WhatsApp/SIMULAÇÃO] ` +
      `${preparado.clienteNome} | ` +
      `${preparado.osNome} | ` +
      `${preparado.quantidadeItens} item(ns) | ` +
      `${preparado.quantidadePartes} parte(s) | ` +
      `${preparado.quantidadeDestinos} destino(s) | ` +
      `${preparado.quantidadeMensagens} mensagem(ns): ` +
      `${preparado.telefonesMascarados.join(' | ')}`
    );

    return {
      ok: true,
      enviado: false,
      simulado: true,
      ignorado: false,
      motivo: 'simulacao',
      quantidadeEnviados: 0,
      quantidadeFalhas: 0,
      quantidadeMensagensEnviadas: 0,
      quantidadeMensagensComFalha: 0,
      ...preparado,
    };
  }

  const configuracaoMeta =
    validarConfiguracaoMeta();

  if (!configuracaoMeta.ok) {
    console.error(
      `[WhatsApp] Configuração incompleta: ` +
      `${configuracaoMeta.mensagem}`
    );

    return {
      ...configuracaoMeta,
      enviado: false,
      simulado: false,
      ignorado: false,
      clienteId:
        preparado.clienteId,
      clienteNome:
        preparado.clienteNome,
      osId:
        preparado.osId,
      osNome:
        preparado.osNome,
      quantidadeDestinos:
        preparado.quantidadeDestinos,
      quantidadePartes:
        preparado.quantidadePartes,
      quantidadeMensagens:
        preparado.quantidadeMensagens,
      telefonesMascarados:
        preparado.telefonesMascarados,
    };
  }

  const resultados = [];

  for (
    let indice = 0;
    indice < preparado.envios.length;
    indice += 1
  ) {
    const envio =
      preparado.envios[indice];

    console.log(
      `[WhatsApp] Enviando mensagem ` +
      `${indice + 1}/${preparado.quantidadeMensagens}: ` +
      `${preparado.clienteNome} | ` +
      `${preparado.osNome} | ` +
      `destino ${envio.indiceDestino}/${preparado.quantidadeDestinos} ` +
      `${envio.telefoneMascarado} | ` +
      `parte ${envio.indiceParte}/${envio.quantidadePartes} | ` +
      `${envio.quantidadeItensParte} item(ns) | ` +
      `Phone Number ID ` +
      `${mascararId(
        CONFIG.phoneNumberId
      )}`
    );

    const respostaMeta =
      await requisitarMeta(
        envio.payload
      );

    if (!respostaMeta.ok) {
      const erroMeta =
        respostaMeta.dados?.error || {};

      const codigoMeta =
        erroMeta.code ?? null;

      const subcodigoMeta =
        erroMeta.error_subcode ?? null;

      const detalhesMeta =
        erroMeta.error_data?.details || '';

      console.error(
        `[WhatsApp] Falha mensagem ` +
        `${indice + 1}/${preparado.quantidadeMensagens}: ` +
        `${preparado.clienteNome} | ` +
        `${preparado.osNome} | ` +
        `${envio.telefoneMascarado} | ` +
        `parte ${envio.indiceParte}/${envio.quantidadePartes} | ` +
        `${respostaMeta.mensagem}`
      );

      console.error(
        `[WhatsApp/Meta] ` +
        `HTTP=${respostaMeta.statusHttp || 0}; ` +
        `code=${codigoMeta ?? '-'}; ` +
        `subcode=${subcodigoMeta ?? '-'}; ` +
        `details=${detalhesMeta || '-'}; ` +
        `trace=${respostaMeta.requestId || '-'}.`
      );

      resultados.push({
        ok: false,
        enviado: false,
        indiceDestino:
          envio.indiceDestino,
        indiceParte:
          envio.indiceParte,
        quantidadePartes:
          envio.quantidadePartes,
        telefoneMascarado:
          envio.telefoneMascarado,
        origemDestino:
          envio.origemDestino,
        motivo: 'erro-meta',
        mensagem:
          respostaMeta.mensagem,
        statusHttp:
          respostaMeta.statusHttp,
        requestId:
          respostaMeta.requestId,
        tentativa:
          respostaMeta.tentativa,
        codigoMeta,
        subcodigoMeta,
        detalhesMeta,
        tipoErro:
          respostaMeta.tipoErro || '',
      });
    } else {
      console.log(
        `[WhatsApp] Enviado com sucesso mensagem ` +
        `${indice + 1}/${preparado.quantidadeMensagens}: ` +
        `${preparado.clienteNome} | ` +
        `${preparado.osNome} | ` +
        `${envio.telefoneMascarado} | ` +
        `parte ${envio.indiceParte}/${envio.quantidadePartes} | ` +
        `Message ID ` +
        `${mascararId(
          respostaMeta.messageId
        )}`
      );

      resultados.push({
        ok: true,
        enviado: true,
        indiceDestino:
          envio.indiceDestino,
        indiceParte:
          envio.indiceParte,
        quantidadePartes:
          envio.quantidadePartes,
        telefoneMascarado:
          envio.telefoneMascarado,
        origemDestino:
          envio.origemDestino,
        messageId:
          respostaMeta.messageId,
        statusHttp:
          respostaMeta.statusHttp,
        requestId:
          respostaMeta.requestId,
        tentativa:
          respostaMeta.tentativa,
      });
    }

    if (
      indice < preparado.envios.length - 1 &&
      CONFIG.pausaEntreMensagensMs > 0
    ) {
      await dormir(
        CONFIG.pausaEntreMensagensMs
      );
    }
  }

  const porDestino = new Map();

  for (const resultado of resultados) {
    if (!porDestino.has(resultado.indiceDestino)) {
      porDestino.set(
        resultado.indiceDestino,
        {
          indiceDestino:
            resultado.indiceDestino,
          telefoneMascarado:
            resultado.telefoneMascarado,
          total: 0,
          enviados: 0,
          falhas: 0,
        }
      );
    }

    const grupo =
      porDestino.get(
        resultado.indiceDestino
      );

    grupo.total += 1;

    if (resultado.enviado) {
      grupo.enviados += 1;
    } else {
      grupo.falhas += 1;
    }
  }

  const destinosConcluidos =
    [...porDestino.values()]
      .filter(
        item =>
          item.total > 0 &&
          item.falhas === 0
      );

  const destinosComFalha =
    [...porDestino.values()]
      .filter(
        item =>
          item.falhas > 0
      );

  const mensagensEnviadas =
    resultados.filter(
      item => item.enviado === true
    );

  const mensagensComFalha =
    resultados.filter(
      item => item.ok === false
    );

  const houveQualquerEnvio =
    mensagensEnviadas.length > 0;

  const houveFalha =
    destinosComFalha.length > 0 ||
    preparado.quantidadeFalhasPreparacao > 0;

  const parcial =
    houveFalha &&
    houveQualquerEnvio;

  const baseResultado = {
    clienteId:
      preparado.clienteId,
    clienteNome:
      preparado.clienteNome,
    osId:
      preparado.osId,
    osNome:
      preparado.osNome,
    quantidadeItens:
      preparado.quantidadeItens,
    quantidadePartes:
      preparado.quantidadePartes,
    quantidadeMensagens:
      preparado.quantidadeMensagens,
    quantidadeMensagensEnviadas:
      mensagensEnviadas.length,
    quantidadeMensagensComFalha:
      mensagensComFalha.length,
    quantidadeDestinos:
      preparado.quantidadeDestinos,
    quantidadeEnviados:
      destinosConcluidos.length,
    quantidadeFalhas:
      destinosComFalha.length +
      preparado.quantidadeFalhasPreparacao,
    quantidadeDestinosIgnorados:
      preparado.quantidadeDestinosIgnorados,
    quantidadeFalhasPreparacao:
      preparado.quantidadeFalhasPreparacao,
    telefonesMascarados:
      preparado.telefonesMascarados,
    destinosIgnorados:
      preparado.destinosIgnorados,
    falhasPreparacao:
      preparado.falhasPreparacao,
    destinosConcluidos,
    destinosComFalha,
    messageIds:
      mensagensEnviadas.map(
        item => item.messageId
      ),
    resultados,
  };

  if (houveFalha) {
    const primeiraFalha =
      mensagensComFalha[0] ||
      preparado.falhasPreparacao[0] ||
      {};

    return {
      ok: false,

      // "enviado" representa destinatário completamente concluído.
      // Envios parciais continuam marcados como parciais/incertos.
      enviado:
        destinosConcluidos.length > 0,

      simulado: false,
      ignorado: false,
      parcial,

      motivo:
        parcial
          ? 'erro-meta-parcial'
          : 'erro-meta',

      mensagem:
        `${destinosConcluidos.length} de ` +
        `${preparado.quantidadeDestinos} destinatário(s) ` +
        `receberam todas as partes; ` +
        `${destinosComFalha.length + preparado.quantidadeFalhasPreparacao} ` +
        `destinatário(s) tiveram falha.`,

      statusHttp:
        primeiraFalha.statusHttp || 0,
      requestId:
        primeiraFalha.requestId || '',
      tentativa:
        primeiraFalha.tentativa || 0,
      codigoMeta:
        primeiraFalha.codigoMeta ?? null,
      subcodigoMeta:
        primeiraFalha.subcodigoMeta ?? null,
      detalhesMeta:
        primeiraFalha.detalhesMeta || '',
      tipoErro:
        primeiraFalha.tipoErro || '',

      ...baseResultado,
    };
  }

  return {
    ok: true,
    enviado: true,
    simulado: false,
    ignorado: false,
    parcial: false,
    motivo: '',

    messageId:
      mensagensEnviadas[0]
        ?.messageId || '',
    statusHttp:
      mensagensEnviadas[0]
        ?.statusHttp || 200,
    requestId:
      mensagensEnviadas[0]
        ?.requestId || '',
    tentativa:
      mensagensEnviadas[0]
        ?.tentativa || 1,
    telefoneMascarado:
      resultados[0]
        ?.telefoneMascarado || '',
    origemDestino:
      resultados[0]
        ?.origemDestino || '',

    ...baseResultado,
  };
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  enviarWhatsAppDaOS,
  prepararEnvioWhatsAppDaOS,

  normalizarTelefone,
  normalizarListaTelefones,

  validarSegurancaWhatsappCliente,

  escolherTelefonesDestino,
  escolherTelefoneDestino,

  telefoneEstaBloqueado,
  telefoneEstaListadoParaAuditoria,
  validarConfiguracaoMeta,

  CONFIG,
};