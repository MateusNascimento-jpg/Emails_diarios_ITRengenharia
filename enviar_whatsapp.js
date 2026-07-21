'use strict';

// ============================================================
// enviar_whatsapp.js — ENVIO FINAL PELA WHATSAPP CLOUD API
// ============================================================
// Responsabilidades:
//
// 1. Receber um cliente e uma Ordem de Serviço já agrupada.
// 2. Escolher o telefone real ou o telefone controlado de teste.
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
// UMA ORDEM DE SERVIÇO = UMA REQUISIÇÃO PARA A META.
//
// Todas as amostras, ensaios e status da OS já estarão
// consolidados dentro do payload produzido pelo template.
// ============================================================

require('dotenv').config();

const {
  montarPayloadTemplateWhatsApp,
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
  // false:
  // o módulo não envia nem simula.
  ativo: booleanoEnv(
    'WHATSAPP_ATIVO',
    false
  ),

  // true:
  // monta o payload completo, mas não chama a Meta.
  simular: booleanoEnv(
    'WHATSAPP_SIMULAR',
    true
  ),

  // true:
  // todos os envios são redirecionados para
  // WHATSAPP_TEST_NUMBER.
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

  // Armazenado para conferência e diagnóstico.
  // O envio de mensagens utiliza PHONE_NUMBER_ID.
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

  // O padrão é uma tentativa para reduzir o risco
  // de mensagem duplicada quando uma resposta se perde.
  //
  // Pode ser aumentado pelo .env depois de existir
  // um mecanismo persistente de idempotência.
  maxTentativas: numeroInteiroPositivo(
    process.env.WHATSAPP_MAX_TENTATIVAS,
    1
  ),

  esperaEntreTentativasMs:
    numeroInteiroPositivo(
      process.env.WHATSAPP_RETRY_BASE_MS,
      1500
    ),

  logPayload: booleanoEnv(
    'WHATSAPP_LOG_PAYLOAD',
    false
  ),

  // Lista separada por vírgula, ponto e vírgula,
  // quebra de linha ou barra vertical.
  //
  // Deve conter o número principal da ITR para impedir
  // qualquer envio acidental a ele durante os testes.
  numerosBloqueados: textoEnv(
    'WHATSAPP_NUMEROS_BLOQUEADOS'
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
    .split(/[;,|\n]+/)
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
  const itens =
    Array.isArray(valor)
      ? valor
      : (
          valor instanceof Set
            ? [...valor]
            : dividirLista(valor)
        );

  return [
    ...new Set(
      itens
        .map(item =>
          limparTexto(item)
        )
        .filter(Boolean)
    ),
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

  // Remove prefixo internacional 00.
  //
  // Exemplo:
  // 005561999999999
  // vira:
  // 5561999999999
  if (digitos.startsWith('00')) {
    digitos =
      digitos.slice(2);
  }

  // Números nacionais brasileiros geralmente chegam
  // com 10 ou 11 dígitos:
  //
  // DDD + número
  //
  // Nesse caso, o código do país é acrescentado.
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

  // Validação compatível com E.164:
  //
  // - somente números;
  // - entre 8 e 15 dígitos;
  // - não pode começar com zero.
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

  const whatsappsEncontrados =
    listaNormalizada(
      cliente
        ?.whatsappsEncontrados
    );

  const numerosMascarados =
    whatsappsEncontrados.map(
      mascararTelefone
    );

  const respostaBase = {
    clienteId:
      cliente?.clienteId || '',

    clienteNome:
      cliente?.clienteNome || '',

    motivosOriginais,

    quantidadeNumerosEncontrados:
      whatsappsEncontrados.length,

    numerosMascarados,
  };

  const marcadoComoBloqueado =
    valorEhVerdadeiro(
      cliente
        ?.whatsappBloqueado
    ) ||
    motivosNormalizados.has(
      'numero-bloqueado'
    ) ||
    motivosNormalizados.has(
      'whatsapp-bloqueado'
    );

  if (marcadoComoBloqueado) {
    return {
      ok: false,

      motivo:
        'numero-bloqueado-no-airtable',

      mensagem:
        'O contato do cliente foi marcado como bloqueado ' +
        'durante a consolidação do Airtable.',

      ...respostaBase,
    };
  }

  const numeroCompartilhado =
    valorEhVerdadeiro(
      cliente
        ?.whatsappDuplicadoEntreClientes
    ) ||
    motivosNormalizados.has(
      'numero-compartilhado-entre-clientes'
    ) ||
    motivosNormalizados.has(
      'whatsapp-compartilhado'
    );

  if (numeroCompartilhado) {
    return {
      ok: false,

      motivo:
        'numero-compartilhado-entre-clientes',

      mensagem:
        'O mesmo número foi associado a mais de um cliente. ' +
        'O envio foi bloqueado para evitar destinatário incorreto.',

      clientesComMesmoWhatsapp:
        listaNormalizada(
          cliente
            ?.clientesComMesmoWhatsapp
        ),

      ...respostaBase,
    };
  }

  const contatoAmbiguo =
    valorEhVerdadeiro(
      cliente
        ?.whatsappAmbiguo
    ) ||
    whatsappsEncontrados.length > 1 ||
    motivosNormalizados.has(
      'cliente-com-mais-de-um-whatsapp'
    ) ||
    motivosNormalizados.has(
      'mais-de-um-whatsapp'
    ) ||
    motivosNormalizados.has(
      'whatsapp-ambiguo'
    );

  if (contatoAmbiguo) {
    return {
      ok: false,

      motivo:
        'cliente-com-mais-de-um-whatsapp',

      mensagem:
        'O cliente possui contato ambíguo ou mais de um ' +
        'número consolidado no Airtable.',

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

  const telefoneCliente =
    limparTexto(
      cliente?.whatsapp
    );

  if (telefoneCliente) {
    const normalizado =
      normalizarTelefone(
        telefoneCliente
      );

    if (!normalizado.ok) {
      return {
        ok: false,

        motivo:
          'whatsapp-cliente-invalido',

        mensagem:
          'O telefone consolidado do cliente não pôde ' +
          'ser normalizado para o padrão internacional.',

        telefoneMascarado:
          mascararTelefone(
            telefoneCliente
          ),

        ...respostaBase,
      };
    }

    if (
      telefoneEstaBloqueado(
        normalizado.telefone
      )
    ) {
      return {
        ok: false,

        motivo:
          'numero-bloqueado',

        mensagem:
          'O telefone consolidado do cliente está presente ' +
          'em WHATSAPP_NUMEROS_BLOQUEADOS.',

        telefoneMascarado:
          mascararTelefone(
            normalizado.telefone
          ),

        ...respostaBase,
      };
    }
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

  // No modo de teste, o destino é WHATSAPP_TEST_NUMBER.
  // Mesmo assim, todos os bloqueios explícitos acima continuam
  // sendo respeitados. A única concessão é permitir que um
  // objeto legado, sem whatsapp e sem flag explícita de risco,
  // utilize o número controlado de teste.
  if (
    !modoTeste &&
    !telefoneCliente
  ) {
    return {
      ok: false,

      motivo:
        'cliente-sem-whatsapp',

      mensagem:
        'O Airtable não retornou um número único e seguro ' +
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

    telefoneCliente,

    ...respostaBase,
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
  return obterNumerosBloqueados()
    .has(telefone);
}

// ============================================================
// ESCOLHA DO DESTINO
// ============================================================

function escolherTelefoneDestino(
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

      telefone:
        normalizado.telefone,

      origem:
        'teste',

      telefoneOriginal:
        CONFIG.numeroTeste,

      segurancaCliente,
    };
  }

  const telefoneCliente =
    limparTexto(
      cliente?.whatsapp
    );

  // Defesa redundante: a validação anterior já bloqueia
  // cliente sem número fora do modo de teste.
  if (!telefoneCliente) {
    return {
      ok: false,

      motivo:
        'cliente-sem-whatsapp',

      mensagem:
        'O Airtable não retornou um número ' +
        'único e seguro para este cliente.',
    };
  }

  const normalizado =
    normalizarTelefone(
      telefoneCliente
    );

  // Defesa redundante: a validação anterior já bloqueia
  // telefone inválido, mas esta verificação protege o uso
  // direto desta função em integrações futuras.
  if (!normalizado.ok) {
    return {
      ok: false,

      motivo:
        'whatsapp-cliente-invalido',

      mensagem:
        'O telefone do cliente vindo do ' +
        'Airtable não pôde ser normalizado.',

      telefoneMascarado:
        mascararTelefone(
          telefoneCliente
        ),
    };
  }

  return {
    ok: true,

    telefone:
      normalizado.telefone,

    origem:
      'airtable',

    telefoneOriginal:
      telefoneCliente,

    segurancaCliente,
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

      // Por segurança, uma falha de rede ou timeout
      // não é repetida automaticamente.
      //
      // A primeira requisição pode ter sido aceita pela Meta,
      // mesmo que a resposta não tenha chegado ao servidor.
      //
      // Isso reduz o risco de mensagens duplicadas.
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

  const destino =
    escolherTelefoneDestino(
      cliente
    );

  if (!destino.ok) {
    return {
      ...destino,

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

  if (
    telefoneEstaBloqueado(
      destino.telefone
    )
  ) {
    return {
      ok: false,

      motivo:
        'numero-bloqueado',

      mensagem:
        'O destino está presente em ' +
        'WHATSAPP_NUMEROS_BLOQUEADOS.',

      telefone:
        destino.telefone,

      telefoneMascarado:
        mascararTelefone(
          destino.telefone
        ),

      origemDestino:
        destino.origem,

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

  const resultadoPayload =
    montarPayloadTemplateWhatsApp({
      cliente,
      ordem,

      telefone:
        destino.telefone,
    });

  if (!resultadoPayload.ok) {
    return {
      ...resultadoPayload,

      telefone:
        destino.telefone,

      telefoneMascarado:
        mascararTelefone(
          destino.telefone
        ),

      origemDestino:
        destino.origem,
    };
  }

  return {
    ok: true,

    payload:
      resultadoPayload.payload,

    contexto:
      resultadoPayload.contexto,

    itens:
      resultadoPayload.itens,

    quantidadeItens:
      resultadoPayload.quantidadeItens,

    formatoDetalhes:
      resultadoPayload.formatoDetalhes,

    tamanhoDetalhes:
      resultadoPayload.tamanhoDetalhes,

    tamanhoCorpoEstimado:
      resultadoPayload.tamanhoCorpoEstimado,

    limiteCorpo:
      resultadoPayload.limiteCorpo,

    telefone:
      destino.telefone,

    telefoneMascarado:
      mascararTelefone(
        destino.telefone
      ),

    origemDestino:
      destino.origem,

    clienteId:
      resultadoPayload.clienteId,

    clienteNome:
      resultadoPayload.clienteNome,

    osId:
      resultadoPayload.osId,

    osNome:
      resultadoPayload.osNome,
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

  // O canal permanece totalmente inativo até
  // WHATSAPP_ATIVO=true.
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

      motivo:
        'whatsapp-desativado',

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

      enviado:
        false,

      simulado:
        false,

      ignorado:
        false,
    };
  }

  if (CONFIG.logPayload) {
    console.log(
      '[WhatsApp] Payload preparado:',

      JSON.stringify(
        payloadSeguroParaLog(
          preparado.payload
        ),
        null,
        2
      )
    );
  }

  // Simulação:
  //
  // O payload é gerado integralmente, mas não existe
  // comunicação com a Meta.
  if (CONFIG.simular) {
    console.log(
      `[WhatsApp/SIMULAÇÃO] ` +
      `${preparado.clienteNome} | ` +
      `${preparado.osNome} | ` +
      `${preparado.quantidadeItens} item(ns) | ` +
      `destino ${preparado.telefoneMascarado}`
    );

    return {
      ok: true,

      enviado:
        false,

      simulado:
        true,

      ignorado:
        false,

      motivo:
        'simulacao',

      ...preparado,

      // Mantido para conferência local.
      payload:
        preparado.payload,
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

      enviado:
        false,

      simulado:
        false,

      ignorado:
        false,

      clienteId:
        preparado.clienteId,

      clienteNome:
        preparado.clienteNome,

      osId:
        preparado.osId,

      osNome:
        preparado.osNome,

      telefoneMascarado:
        preparado.telefoneMascarado,
    };
  }

  console.log(
    `[WhatsApp] Enviando: ` +
    `${preparado.clienteNome} | ` +
    `${preparado.osNome} | ` +
    `${preparado.quantidadeItens} item(ns) | ` +
    `destino ${preparado.telefoneMascarado} | ` +
    `Phone Number ID ` +
    `${mascararId(
      CONFIG.phoneNumberId
    )}`
  );

  const respostaMeta =
    await requisitarMeta(
      preparado.payload
    );

  if (!respostaMeta.ok) {
    console.error(
      `[WhatsApp] Falha: ` +
      `${preparado.clienteNome} | ` +
      `${preparado.osNome} | ` +
      `${respostaMeta.mensagem}`
    );

    return {
      ok:
        false,

      enviado:
        false,

      simulado:
        false,

      ignorado:
        false,

      motivo:
        'erro-meta',

      mensagem:
        respostaMeta.mensagem,

      statusHttp:
        respostaMeta.statusHttp,

      requestId:
        respostaMeta.requestId,

      tentativa:
        respostaMeta.tentativa,

      erroMeta:
        respostaMeta.dados?.error ||
        respostaMeta.dados ||
        {},

      codigoMeta:
        respostaMeta.dados?.error?.code ??
        null,

      subcodigoMeta:
        respostaMeta.dados?.error
          ?.error_subcode ??
        null,

      detalhesMeta:
        respostaMeta.dados?.error
          ?.error_data?.details ||
        '',

      tipoErro:
        respostaMeta.tipoErro ||
        '',

      clienteId:
        preparado.clienteId,

      clienteNome:
        preparado.clienteNome,

      osId:
        preparado.osId,

      osNome:
        preparado.osNome,

      telefoneMascarado:
        preparado.telefoneMascarado,

      quantidadeItens:
        preparado.quantidadeItens,

      formatoDetalhes:
        preparado.formatoDetalhes,

      tamanhoDetalhes:
        preparado.tamanhoDetalhes,

      tamanhoCorpoEstimado:
        preparado.tamanhoCorpoEstimado,

      limiteCorpo:
        preparado.limiteCorpo,
    };
  }

  console.log(
    `[WhatsApp] Enviado com sucesso: ` +
    `${preparado.clienteNome} | ` +
    `${preparado.osNome} | ` +
    `Message ID ` +
    `${mascararId(
      respostaMeta.messageId
    )}`
  );

  return {
    ok:
      true,

    enviado:
      true,

    simulado:
      false,

    ignorado:
      false,

    motivo:
      '',

    messageId:
      respostaMeta.messageId,

    statusHttp:
      respostaMeta.statusHttp,

    requestId:
      respostaMeta.requestId,

    tentativa:
      respostaMeta.tentativa,

    clienteId:
      preparado.clienteId,

    clienteNome:
      preparado.clienteNome,

    osId:
      preparado.osId,

    osNome:
      preparado.osNome,

    telefoneMascarado:
      preparado.telefoneMascarado,

    origemDestino:
      preparado.origemDestino,

    quantidadeItens:
      preparado.quantidadeItens,

    formatoDetalhes:
      preparado.formatoDetalhes,

    tamanhoDetalhes:
      preparado.tamanhoDetalhes,

    tamanhoCorpoEstimado:
      preparado.tamanhoCorpoEstimado,

    limiteCorpo:
      preparado.limiteCorpo,
  };
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  enviarWhatsAppDaOS,
  prepararEnvioWhatsAppDaOS,

  normalizarTelefone,
  validarSegurancaWhatsappCliente,
  escolherTelefoneDestino,
  telefoneEstaBloqueado,

  validarConfiguracaoMeta,

  CONFIG,
};