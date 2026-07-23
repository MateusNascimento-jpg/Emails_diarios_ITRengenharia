'use strict';

require('dotenv').config();

const WABA_PRODUCAO_ESPERADA =
  '3565240096975159';

const PHONE_NUMBER_ID_ESPERADO =
  '1187028514499369';

const ARGUMENTO_ENVIO_REAL =
  '--confirmar-envio-real';

const envioRealSolicitado =
  process.argv.includes(
    ARGUMENTO_ENVIO_REAL
  );

function textoEnv(
  nome,
  padrao = ''
) {
  return String(
    process.env[nome] ??
    padrao
  ).trim();
}

function booleanoEnv(
  nome,
  padrao = false
) {
  const valor =
    textoEnv(nome);

  if (!valor) {
    return padrao;
  }

  return [
    '1',
    'true',
    'sim',
    'yes',
    'on',
  ].includes(
    valor.toLowerCase()
  );
}

function exigir(
  condicao,
  mensagem
) {
  if (!condicao) {
    throw new Error(
      mensagem
    );
  }
}

function somenteDigitos(
  valor
) {
  return String(
    valor || ''
  ).replace(
    /\D/g,
    ''
  );
}

function normalizarTelefone(
  valor,
  codigoPais = '55'
) {
  let numero =
    somenteDigitos(
      valor
    );

  if (
    numero.length === 10 ||
    numero.length === 11
  ) {
    numero =
      `${codigoPais}${numero}`;
  }

  exigir(
    /^[1-9][0-9]{7,14}$/.test(
      numero
    ),
    'WHATSAPP_TEST_NUMBER está vazio ou inválido.'
  );

  return numero;
}

function mascararTelefone(
  valor
) {
  const numero =
    somenteDigitos(
      valor
    );

  if (
    numero.length <= 4
  ) {
    return '****';
  }

  return (
    `${numero.slice(0, 4)}` +
    `${'*'.repeat(
      Math.max(
        numero.length - 8,
        4
      )
    )}` +
    `${numero.slice(-4)}`
  );
}

function mascararId(
  valor
) {
  const texto =
    String(
      valor || ''
    );

  if (!texto) {
    return '';
  }

  if (
    texto.length <= 14
  ) {
    return '***';
  }

  return (
    `${texto.slice(0, 8)}` +
    '...' +
    `${texto.slice(-6)}`
  );
}

function listaNumerosBloqueados(
  codigoPais
) {
  const valor =
    textoEnv(
      'WHATSAPP_NUMEROS_BLOQUEADOS'
    );

  if (!valor) {
    return [];
  }

  return valor
    .split(/[;,|]/)
    .map(
      item =>
        item.trim()
    )
    .filter(Boolean)
    .map(
      item =>
        normalizarTelefone(
          item,
          codigoPais
        )
    );
}

async function requisitarJson(
  url,
  token
) {
  const controlador =
    new AbortController();

  const temporizador =
    setTimeout(
      () =>
        controlador.abort(),
      20000
    );

  try {
    const resposta =
      await fetch(
        url,
        {
          method:
            'GET',

          headers: {
            Authorization:
              `Bearer ${token}`,
          },

          signal:
            controlador.signal,
        }
      );

    const texto =
      await resposta.text();

    let dados = {};

    if (texto) {
      try {
        dados =
          JSON.parse(
            texto
          );
      } catch {
        throw new Error(
          'A Meta retornou uma resposta que não é JSON.'
        );
      }
    }

    if (
      !resposta.ok
    ) {
      const codigo =
        dados?.error?.code ??
        resposta.status;

      const tipo =
        dados?.error?.type ||
        'erro-meta';

      const mensagem =
        dados?.error?.message ||
        'Falha ao consultar a Meta.';

      throw new Error(
        `${tipo} (${codigo}): ${mensagem}`
      );
    }

    return dados;
  } catch (erro) {
    if (
      erro?.name ===
      'AbortError'
    ) {
      throw new Error(
        'Tempo limite excedido ao consultar a Meta.'
      );
    }

    throw erro;
  } finally {
    clearTimeout(
      temporizador
    );
  }
}

function parametrosDoCorpo(
  payload
) {
  return (
    payload
      ?.template
      ?.components
      ?.find(
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

function validarParametrosTextuaisDoPayload(
  payload
) {
  const componentes =
    payload?.template?.components ||
    [];

  for (
    const componente
    of componentes
  ) {
    const parametros =
      componente?.parameters ||
      [];

    for (
      const parametro
      of parametros
    ) {
      const valor =
        parametro?.type ===
        'text'
          ? parametro.text
          : parametro?.type ===
            'payload'
            ? parametro.payload
            : null;

      if (
        valor === null
      ) {
        continue;
      }

      exigir(
        !/[\r\n\t\u2028\u2029]/.test(
          String(valor)
        ),
        'O payload final contém quebra de linha ou tabulação em um parâmetro.'
      );

      exigir(
        !/ {5,}/.test(
          String(valor)
        ),
        'O payload final contém mais de quatro espaços consecutivos.'
      );
    }
  }
}

function validarSeparacaoDosItens(
  detalhes,
  quantidadeItens
) {
  exigir(
    !/[\r\n\t\u2028\u2029]/.test(
      detalhes
    ),
    'O parâmetro detalhes contém quebra de linha ou tabulação.'
  );

  exigir(
    !/ {3,}/.test(
      detalhes
    ),
    'O parâmetro detalhes contém três ou mais espaços consecutivos.'
  );

  for (
    let indice = 2;
    indice <= quantidadeItens;
    indice += 1
  ) {
    const marcador =
      `  ◆ *${indice}) Amostra:*`;

    exigir(
      detalhes.includes(
        marcador
      ),
      `O item ${indice} não está separado por exatamente dois espaços.`
    );
  }
}

function validarPayloadControlado(
  preparado,
  destinoEsperado
) {
  exigir(
    preparado?.ok === true,
    preparado?.mensagem ||
      preparado?.motivo ||
      'Não foi possível preparar o payload.'
  );

  exigir(
    preparado.payload?.to ===
      destinoEsperado,
    'O payload não está direcionado ao WHATSAPP_TEST_NUMBER.'
  );

  exigir(
    preparado.payload?.type ===
      'template',
    'O payload não está configurado como template.'
  );

  exigir(
    preparado.payload
      ?.template
      ?.name ===
      textoEnv(
        'WHATSAPP_TEMPLATE_NAME'
      ),
    'O nome do template do payload está incorreto.'
  );

  exigir(
    preparado.formatoDetalhes ===
      'blocos',
    'A mensagem fictícia não foi gerada no formato em blocos.'
  );

  exigir(
    preparado.quantidadeItens ===
      2,
    'A mensagem fictícia deveria conter exatamente dois itens.'
  );

  exigir(
    preparado.tamanhoCorpoEstimado <=
      preparado.limiteCorpo,
    'O corpo fictício ultrapassou o limite seguro.'
  );

  const detalhes =
    parametroNomeado(
      preparado.payload,
      'detalhes'
    )?.text || '';

  exigir(
    detalhes.includes(
      '◆ *1) Amostra:* CP-01'
    ),
    'O primeiro item não foi gerado corretamente.'
  );

  exigir(
    detalhes.includes(
      '*Ensaio:* Limite de Liquidez'
    ),
    'O nome completo do primeiro ensaio não foi utilizado.'
  );

  exigir(
    !detalhes.includes(
      '*Ensaio:* LL'
    ),
    'A sigla LL foi usada mesmo existindo nome completo.'
  );

  exigir(
    detalhes.includes(
      '◆ *2) Amostra:* CP-02'
    ),
    'O segundo item não foi gerado corretamente.'
  );

  exigir(
    detalhes.includes(
      '*Ensaio:* Módulo de Resiliência'
    ),
    'O nome completo do segundo ensaio não foi utilizado.'
  );

  validarSeparacaoDosItens(
    detalhes,
    preparado.quantidadeItens
  );

  validarParametrosTextuaisDoPayload(
    preparado.payload
  );

  return detalhes;
}

async function executar() {
  const token =
    textoEnv(
      'WHATSAPP_ACCESS_TOKEN'
    );

  const versaoApi =
    textoEnv(
      'WHATSAPP_API_VERSION',
      'v25.0'
    );

  const wabaId =
    textoEnv(
      'WHATSAPP_BUSINESS_ACCOUNT_ID'
    );

  const phoneNumberId =
    textoEnv(
      'WHATSAPP_PHONE_NUMBER_ID'
    );

  const templateName =
    textoEnv(
      'WHATSAPP_TEMPLATE_NAME'
    );

  const templateLanguage =
    textoEnv(
      'WHATSAPP_TEMPLATE_LANGUAGE',
      'pt_BR'
    );

  const codigoPais =
    textoEnv(
      'WHATSAPP_COUNTRY_CODE',
      '55'
    );

  exigir(
    token,
    'WHATSAPP_ACCESS_TOKEN não está configurado.'
  );

  exigir(
    wabaId,
    'WHATSAPP_BUSINESS_ACCOUNT_ID não está configurado.'
  );

  exigir(
    phoneNumberId,
    'WHATSAPP_PHONE_NUMBER_ID não está configurado.'
  );

  exigir(
    templateName,
    'WHATSAPP_TEMPLATE_NAME não está configurado.'
  );

  exigir(
    wabaId ===
      WABA_PRODUCAO_ESPERADA,
    'A WABA configurada não é a conta de produção esperada.'
  );

  exigir(
    phoneNumberId ===
      PHONE_NUMBER_ID_ESPERADO,
    'O Phone Number ID configurado não é o número de produção esperado.'
  );

  exigir(
    booleanoEnv(
      'WHATSAPP_MODO_TESTE'
    ),
    'WHATSAPP_MODO_TESTE deve permanecer true.'
  );

  exigir(
    !booleanoEnv(
      'CRON_ATIVO'
    ),
    'CRON_ATIVO deve permanecer false durante o teste.'
  );

  exigir(
    !booleanoEnv(
      'WHATSAPP_ATIVO'
    ),
    'O .env deve permanecer com WHATSAPP_ATIVO=false.'
  );

  exigir(
    booleanoEnv(
      'WHATSAPP_SIMULAR',
      true
    ),
    'O .env deve permanecer com WHATSAPP_SIMULAR=true.'
  );

  const destinoTeste =
    normalizarTelefone(
      textoEnv(
        'WHATSAPP_TEST_NUMBER'
      ),
      codigoPais
    );

  exigir(
    !listaNumerosBloqueados(
      codigoPais
    ).includes(
      destinoTeste
    ),
    'WHATSAPP_TEST_NUMBER está na lista de números bloqueados.'
  );

  const baseGraph =
    `https://graph.facebook.com/${versaoApi}`;

  const respostaTemplates =
    await requisitarJson(
      `${baseGraph}/${wabaId}/message_templates` +
      '?fields=id,name,status,language,category,parameter_format&limit=100',

      token
    );

  const templatesEncontrados =
    (
      respostaTemplates.data ||
      []
    ).filter(
      template =>
        template.name ===
          templateName &&
        template.language ===
          templateLanguage
    );

  exigir(
    templatesEncontrados.length ===
      1,
    `Era esperado exatamente um template ${templateName}/${templateLanguage} na WABA de produção.`
  );

  const template =
    templatesEncontrados[0];

  const respostaNumeros =
    await requisitarJson(
      `${baseGraph}/${wabaId}/phone_numbers` +
      '?fields=id,display_phone_number,verified_name,code_verification_status,platform_type&limit=100',

      token
    );

  const numeroProducao =
    (
      respostaNumeros.data ||
      []
    ).find(
      numero =>
        numero.id ===
        phoneNumberId
    );

  exigir(
    numeroProducao,
    'O Phone Number ID não pertence à WABA de produção configurada.'
  );

  exigir(
    numeroProducao
      .code_verification_status ===
      'VERIFIED',
    'O número de produção não está verificado.'
  );

  exigir(
    numeroProducao
      .platform_type ===
      'CLOUD_API',
    'O número de produção não está registrado na Cloud API.'
  );

  if (
    envioRealSolicitado &&
    template.status !==
      'APPROVED'
  ) {
    console.log(
      JSON.stringify(
        {
          ok:
            true,

          enviado:
            false,

          bloqueado:
            true,

          motivo:
            'template-nao-aprovado',

          template: {
            id:
              template.id,

            name:
              template.name,

            language:
              template.language,

            status:
              template.status,
          },

          numeroProducao: {
            verificado:
              true,

            plataforma:
              numeroProducao
                .platform_type,
          },

          destinoTeste:
            mascararTelefone(
              destinoTeste
            ),
        },
        null,
        2
      )
    );

    return;
  }

  process.env.WHATSAPP_ATIVO =
    'true';

  process.env.WHATSAPP_SIMULAR =
    envioRealSolicitado
      ? 'false'
      : 'true';

  process.env.WHATSAPP_MODO_TESTE =
    'true';

  process.env.WHATSAPP_LOG_PAYLOAD =
    'false';

  const {
    prepararEnvioWhatsAppDaOS,
    enviarWhatsAppDaOS,
  } = require('./enviar_whatsapp.js');

  const clienteFicticio = {
    clienteId:
      'CLIENTE-TESTE-CONTROLADO',

    clienteNome:
      'Cliente de validação',

    whatsapp:
      destinoTeste,

    whatsappsEncontrados: [
      destinoTeste,
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
  };

  const ordemFicticia = {
    osId:
      'OS-TESTE-CONTROLADO',

    osNome:
      'OS-TESTE-01/2026',

    linhas: [
      {
        recordId:
          'REGISTRO-TESTE-01',

        idTrabalho:
          'TRABALHO-TESTE-01',

        amostra:
          'CP-01',

        ensaioNome:
          'Limite de Liquidez',

        ensaioSigla:
          'LL',

        status:
          'Enviado ao Cliente',
      },

      {
        recordId:
          'REGISTRO-TESTE-02',

        idTrabalho:
          'TRABALHO-TESTE-02',

        amostra:
          'CP-02',

        ensaioNome:
          'Módulo de Resiliência',

        ensaioSigla:
          'MR-I',

        status:
          'Enviado ao Cliente',
      },
    ],
  };

  const preparado =
    prepararEnvioWhatsAppDaOS({
      cliente:
        clienteFicticio,

      ordem:
        ordemFicticia,
    });

  const detalhes =
    validarPayloadControlado(
      preparado,
      destinoTeste
    );

  if (
    !envioRealSolicitado
  ) {
    console.log(
      JSON.stringify(
        {
          ok:
            true,

          enviado:
            false,

          simulado:
            true,

          motivo:
            'preparacao-controlada',

          template: {
            id:
              template.id,

            name:
              template.name,

            language:
              template.language,

            status:
              template.status,
          },

          numeroProducao: {
            verificado:
              true,

            plataforma:
              numeroProducao
                .platform_type,
          },

          destinoTeste:
            mascararTelefone(
              destinoTeste
            ),

          quantidadeItens:
            preparado
              .quantidadeItens,

          formatoDetalhes:
            preparado
              .formatoDetalhes,

          tamanhoCorpoEstimado:
            preparado
              .tamanhoCorpoEstimado,

          limiteCorpo:
            preparado
              .limiteCorpo,

          detalhes,
        },
        null,
        2
      )
    );

    return;
  }

  const resultado =
    await enviarWhatsAppDaOS({
      cliente:
        clienteFicticio,

      ordem:
        ordemFicticia,
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
        ok:
          true,

        enviado:
          true,

        simulado:
          false,

        template: {
          id:
            template.id,

          name:
            template.name,

          status:
            template.status,
        },

        destinoTeste:
          resultado.telefoneMascarado ||
          mascararTelefone(
            destinoTeste
          ),

        messageId:
          mascararId(
            resultado.messageId
          ),

        quantidadeItens:
          resultado
            .quantidadeItens,

        formatoDetalhes:
          resultado
            .formatoDetalhes,

        tamanhoCorpoEstimado:
          resultado
            .tamanhoCorpoEstimado,

        limiteCorpo:
          resultado
            .limiteCorpo,
      },
      null,
      2
    )
  );
}

executar()
  .catch(
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