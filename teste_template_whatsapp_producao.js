'use strict';

require('dotenv').config({ quiet: true });

const {
  normalizarTelefoneE164,
} = require('./lib/telefone.js');

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
  ].includes(
    valor.toLowerCase()
  );
}

function exigir(
  condicao,
  mensagem
) {
  if (!condicao) {
    throw new Error(mensagem);
  }
}

function somenteDigitos(valor) {
  return String(valor || '')
    .replace(/\D/g, '');
}

function normalizarTelefone(
  valor,
  codigoPais = '55'
) {
  const resultado =
    normalizarTelefoneE164(
      valor,
      codigoPais
    );

  exigir(
    resultado.ok,
    'WHATSAPP_TEST_NUMBER está vazio ou inválido.'
  );

  return resultado.telefone;
}

function mascararTelefone(valor) {
  const numero = somenteDigitos(valor);

  if (numero.length <= 4) {
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

function mascararId(valor) {
  const texto = String(valor || '');

  if (!texto) {
    return '';
  }

  if (texto.length <= 14) {
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
  const valor = textoEnv(
    'WHATSAPP_NUMEROS_BLOQUEADOS'
  );

  if (!valor) {
    return [];
  }

  return valor
    .split(/[;,|]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item =>
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

  const temporizador = setTimeout(
    () => controlador.abort(),
    20000
  );

  try {
    const resposta = await fetch(
      url,
      {
        method: 'GET',
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
        signal:
          controlador.signal,
      }
    );

    const texto = await resposta.text();
    let dados = {};

    if (texto) {
      try {
        dados = JSON.parse(texto);
      } catch {
        throw new Error(
          'A Meta retornou uma resposta que não é JSON.'
        );
      }
    }

    if (!resposta.ok) {
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
    if (erro?.name === 'AbortError') {
      throw new Error(
        'Tempo limite excedido ao consultar a Meta.'
      );
    }

    throw erro;
  } finally {
    clearTimeout(temporizador);
  }
}

async function validarMidiaPublica() {
  const tipo = textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_TYPE',
    'none'
  ).toLowerCase();

  const mediaId = textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_MEDIA_ID'
  );

  const mediaUrl = textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL'
  );

  if (
    !['image', 'video', 'document']
      .includes(tipo) ||
    mediaId ||
    !mediaUrl
  ) {
    return {
      verificada: false,
      origem:
        mediaId
          ? 'media-id'
          : 'nao-aplicavel',
    };
  }

  exigir(
    /^https:\/\//i.test(mediaUrl),
    'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL precisa ser HTTPS.'
  );

  const controlador =
    new AbortController();

  const temporizador = setTimeout(
    () => controlador.abort(),
    20000
  );

  try {
    const resposta = await fetch(
      mediaUrl,
      {
        method: 'GET',
        signal:
          controlador.signal,
      }
    );

    exigir(
      resposta.ok,
      `A mídia pública do cabeçalho respondeu HTTP ${resposta.status}.`
    );

    const contentType = String(
      resposta.headers.get(
        'content-type'
      ) || ''
    ).toLowerCase();

    if (tipo === 'image') {
      exigir(
        contentType.startsWith('image/'),
        `A URL do cabeçalho não retornou imagem (Content-Type: ${contentType || 'ausente'}).`
      );
    }

    // Consome/cancela o corpo para liberar a conexão sem gravar o arquivo.
    if (resposta.body) {
      await resposta.body.cancel();
    }

    return {
      verificada: true,
      origem: 'url-publica',
      contentType,
    };
  } catch (erro) {
    if (erro?.name === 'AbortError') {
      throw new Error(
        'Tempo limite excedido ao validar a mídia pública do cabeçalho.'
      );
    }

    throw erro;
  } finally {
    clearTimeout(temporizador);
  }
}

function parametrosDoCorpo(payload) {
  return (
    payload
      ?.template
      ?.components
      ?.find(
        componente =>
          componente.type === 'body'
      )
      ?.parameters || []
  );
}

function parametroNomeado(
  payload,
  nome
) {
  return parametrosDoCorpo(payload)
    .find(
      parametro =>
        parametro.parameter_name === nome
    );
}

function mapeamentosCorpoConfigurados() {
  const bruto = textoEnv(
    'WHATSAPP_TEMPLATE_BODY_PARAMETERS'
  );

  const itens = bruto
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  exigir(
    itens.length > 0,
    'WHATSAPP_TEMPLATE_BODY_PARAMETERS não possui parâmetros.'
  );

  return itens.map(item => {
    const indice = item.indexOf('=');

    if (indice < 0) {
      return {
        nome: item,
        origem: item,
      };
    }

    const nome = item
      .slice(0, indice)
      .trim();

    const origem = item
      .slice(indice + 1)
      .trim();

    exigir(
      nome && origem,
      `Mapeamento inválido em WHATSAPP_TEMPLATE_BODY_PARAMETERS: ${item}`
    );

    return { nome, origem };
  });
}

function validarParametrosTextuaisDoPayload(
  payload
) {
  const componentes =
    payload?.template?.components || [];

  for (const componente of componentes) {
    const parametros =
      componente?.parameters || [];

    for (const parametro of parametros) {
      const valor =
        parametro?.type === 'text'
          ? parametro.text
          : parametro?.type === 'payload'
            ? parametro.payload
            : null;

      if (valor === null) {
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
    !/ {3,}/.test(detalhes),
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
      detalhes.includes(marcador),
      `O item ${indice} não está separado por exatamente dois espaços.`
    );
  }
}

function validarCabecalhoDoPayload(
  payload
) {
  const tipo = textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_TYPE',
    'none'
  ).toLowerCase();

  const cabecalho =
    payload?.template?.components
      ?.find(
        componente =>
          componente.type === 'header'
      );

  if (tipo === 'none') {
    exigir(
      !cabecalho,
      'O payload possui cabeçalho dinâmico, mas WHATSAPP_TEMPLATE_HEADER_TYPE=none.'
    );

    return;
  }

  exigir(
    cabecalho &&
    Array.isArray(cabecalho.parameters) &&
    cabecalho.parameters.length === 1,
    'O cabeçalho dinâmico do payload está ausente ou inválido.'
  );

  const parametro =
    cabecalho.parameters[0];

  exigir(
    parametro?.type === tipo,
    `O cabeçalho deveria usar ${tipo}.`
  );

  const mediaId = textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_MEDIA_ID'
  );

  const mediaUrl = textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL'
  );

  if (['image', 'video', 'document'].includes(tipo)) {
    const midia = parametro?.[tipo] || {};

    if (mediaId) {
      exigir(
        midia.id === mediaId,
        'O Media ID do cabeçalho no payload está incorreto.'
      );
    } else {
      exigir(
        midia.link === mediaUrl,
        'A URL de mídia do cabeçalho no payload está incorreta.'
      );
    }
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
      textoEnv('WHATSAPP_TEMPLATE_NAME'),
    'O nome do template do payload está incorreto.'
  );

  exigir(
    preparado.quantidadeItens === 2,
    'A mensagem fictícia deveria conter exatamente dois itens.'
  );

  const mapeamentos =
    mapeamentosCorpoConfigurados();

  const parametros =
    parametrosDoCorpo(
      preparado.payload
    );

  exigir(
    parametros.length ===
      mapeamentos.length,
    `O payload possui ${parametros.length} parâmetro(s) de corpo, mas a configuração exige ${mapeamentos.length}.`
  );

  const modo = textoEnv(
    'WHATSAPP_TEMPLATE_PARAMETER_MODE',
    'positional'
  ).toLowerCase();

  for (
    let indice = 0;
    indice < mapeamentos.length;
    indice += 1
  ) {
    const mapeamento =
      mapeamentos[indice];

    const parametro =
      modo === 'named'
        ? parametroNomeado(
            preparado.payload,
            mapeamento.nome
          )
        : parametros[indice];

    exigir(
      parametro,
      `O parâmetro ${mapeamento.nome} não foi encontrado no payload.`
    );

    exigir(
      parametro.type === 'text' &&
      String(parametro.text || '').trim(),
      `O parâmetro ${mapeamento.nome} não contém texto válido.`
    );
  }

  validarCabecalhoDoPayload(
    preparado.payload
  );

  validarParametrosTextuaisDoPayload(
    preparado.payload
  );

  const nomes = new Set(
    mapeamentos.map(item => item.nome)
  );

  // Contrato atual V3: exatamente uma mensagem por OS/destino,
  // independentemente da quantidade de linhas da OS.
  if (
    nomes.has('order_service') &&
    nomes.has('order_status') &&
    !nomes.has('detalhes')
  ) {
    exigir(
      preparado.quantidadePartes === 1,
      'O V3 deveria gerar exatamente uma parte por OS.'
    );

    exigir(
      preparado.quantidadeMensagens === 1,
      'O V3 deveria gerar exatamente uma mensagem para o destino controlado.'
    );

    exigir(
      preparado.formatoDetalhes ===
        'nao-utilizado',
      'O V3 não deveria montar o parâmetro detalhes.'
    );

    exigir(
      parametroNomeado(
        preparado.payload,
        'order_service'
      )?.text ===
        'OS-TESTE-01/2026',
      'order_service não corresponde à OS controlada.'
    );

    exigir(
      parametroNomeado(
        preparado.payload,
        'order_status'
      )?.text ===
        'Relatório Pronto',
      'order_status não corresponde ao status esperado.'
    );

    exigir(
      !parametroNomeado(
        preparado.payload,
        'detalhes'
      ),
      'O V3 não deve transportar detalhes no corpo.'
    );

    return {
      contrato: 'v3',
      quantidadeParametros:
        parametros.length,
      orderService:
        'OS-TESTE-01/2026',
      orderStatus:
        'Relatório Pronto',
    };
  }

  // Compatibilidade com template legado que ainda utilize detalhes.
  if (nomes.has('detalhes')) {
    exigir(
      preparado.formatoDetalhes ===
        'blocos',
      'O template com detalhes deveria usar o formato em blocos.'
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
      detalhes.includes(
        '◆ *2) Amostra:* CP-02'
      ),
      'O segundo item não foi gerado corretamente.'
    );

    validarSeparacaoDosItens(
      detalhes,
      preparado.quantidadeItens
    );

    return {
      contrato: 'legado-detalhes',
      quantidadeParametros:
        parametros.length,
      tamanhoDetalhes:
        detalhes.length,
    };
  }

  return {
    contrato: 'generico',
    quantidadeParametros:
      parametros.length,
  };
}

function placeholdersNomeados(texto) {
  const encontrados = new Set();
  const regex = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let correspondencia;

  while (
    (correspondencia = regex.exec(
      String(texto || '')
    )) !== null
  ) {
    encontrados.add(
      correspondencia[1]
    );
  }

  return [...encontrados];
}

function validarDefinicaoTemplateMeta(
  template
) {
  exigir(
    template?.status === 'APPROVED',
    `O template ${template?.name || '(sem nome)'} não está APPROVED (status: ${template?.status || 'desconhecido'}).`
  );

  const modoEsperado = textoEnv(
    'WHATSAPP_TEMPLATE_PARAMETER_MODE',
    'positional'
  ).toLowerCase();

  const formatoMeta = String(
    template?.parameter_format || ''
  ).trim().toLowerCase();

  if (formatoMeta) {
    exigir(
      formatoMeta === modoEsperado,
      `A Meta informa parameter_format=${formatoMeta}, mas o ambiente usa ${modoEsperado}.`
    );
  }

  const componentes =
    Array.isArray(template?.components)
      ? template.components
      : [];

  if (componentes.length === 0) {
    return;
  }

  const corpo = componentes.find(
    componente =>
      String(componente?.type || '')
        .toUpperCase() === 'BODY'
  );

  exigir(
    corpo,
    'O template aprovado não possui componente BODY.'
  );

  if (modoEsperado === 'named') {
    const esperados =
      mapeamentosCorpoConfigurados()
        .map(item => item.nome)
        .sort();

    const encontrados =
      placeholdersNomeados(
        corpo?.text
      ).sort();

    exigir(
      JSON.stringify(encontrados) ===
        JSON.stringify(esperados),
      `Placeholders BODY na Meta (${encontrados.join(', ') || 'nenhum'}) não correspondem ao ambiente (${esperados.join(', ')}).`
    );
  }

  const headerEsperado = textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_TYPE',
    'none'
  ).toLowerCase();

  if (headerEsperado !== 'none') {
    const header = componentes.find(
      componente =>
        String(componente?.type || '')
          .toUpperCase() === 'HEADER'
    );

    exigir(
      header,
      `O ambiente exige HEADER ${headerEsperado}, mas o template aprovado não possui HEADER.`
    );

    const formato = String(
      header?.format || ''
    ).toLowerCase();

    exigir(
      formato === headerEsperado,
      `O HEADER aprovado é ${formato || 'desconhecido'}, mas o ambiente exige ${headerEsperado}.`
    );
  }

  if (
    textoEnv('WHATSAPP_TEMPLATE_NAME') ===
      'atualizacao_ordem_servico_v3'
  ) {
    const botoes = componentes.find(
      componente =>
        String(componente?.type || '')
          .toUpperCase() === 'BUTTONS'
    );

    const portalUrl = textoEnv(
      'PORTAL_CLIENTE_URL',
      'https://portal.itr.eng.br/login.html'
    );

    const possuiPortal =
      Array.isArray(botoes?.buttons) &&
      botoes.buttons.some(botao =>
        String(botao?.type || '')
          .toUpperCase() === 'URL' &&
        String(botao?.url || '') ===
          portalUrl
      );

    exigir(
      possuiPortal,
      `O template V3 aprovado não contém o botão URL estático esperado para ${portalUrl}.`
    );
  }
}

function exigirAmbienteSeguroParaEnvioReal() {
  exigir(
    booleanoEnv('WHATSAPP_MODO_TESTE'),
    'Para um envio real controlado, WHATSAPP_MODO_TESTE deve estar true no .env.'
  );

  exigir(
    !booleanoEnv('CRON_ATIVO'),
    'Para um envio real controlado, CRON_ATIVO deve estar false no .env.'
  );

  exigir(
    !booleanoEnv('WHATSAPP_ATIVO'),
    'Para um envio real controlado, WHATSAPP_ATIVO deve estar false no .env.'
  );

  exigir(
    booleanoEnv(
      'WHATSAPP_SIMULAR',
      true
    ),
    'Para um envio real controlado, WHATSAPP_SIMULAR deve estar true no .env.'
  );
}

async function executar() {
  const token = textoEnv(
    'WHATSAPP_ACCESS_TOKEN'
  );

  const versaoApi = textoEnv(
    'WHATSAPP_API_VERSION',
    'v25.0'
  );

  const wabaId = textoEnv(
    'WHATSAPP_BUSINESS_ACCOUNT_ID'
  );

  const phoneNumberId = textoEnv(
    'WHATSAPP_PHONE_NUMBER_ID'
  );

  const templateName = textoEnv(
    'WHATSAPP_TEMPLATE_NAME'
  );

  const templateLanguage = textoEnv(
    'WHATSAPP_TEMPLATE_LANGUAGE',
    'pt_BR'
  );

  const codigoPais = textoEnv(
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

  const wabaEsperada = textoEnv(
    'WHATSAPP_EXPECTED_WABA_ID'
  );

  const phoneNumberIdEsperado = textoEnv(
    'WHATSAPP_EXPECTED_PHONE_NUMBER_ID'
  );

  exigir(
    wabaEsperada,
    'WHATSAPP_EXPECTED_WABA_ID não está configurado.'
  );

  exigir(
    phoneNumberIdEsperado,
    'WHATSAPP_EXPECTED_PHONE_NUMBER_ID não está configurado.'
  );

  exigir(
    wabaId === wabaEsperada,
    'A WABA configurada não é a conta de produção esperada.'
  );

  exigir(
    phoneNumberId ===
      phoneNumberIdEsperado,
    'O Phone Number ID configurado não é o número de produção esperado.'
  );

  if (envioRealSolicitado) {
    exigirAmbienteSeguroParaEnvioReal();
  }

  const destinoTeste =
    envioRealSolicitado
      ? normalizarTelefone(
          textoEnv('WHATSAPP_TEST_NUMBER'),
          codigoPais
        )
      : normalizarTelefone(
          `${codigoPais}61000000000`,
          codigoPais
        );

  if (envioRealSolicitado) {
    exigir(
      !listaNumerosBloqueados(
        codigoPais
      ).includes(destinoTeste),
      'WHATSAPP_TEST_NUMBER está na lista de números bloqueados.'
    );
  }

  const baseGraph =
    `https://graph.facebook.com/${versaoApi}`;

  const respostaTemplates =
    await requisitarJson(
      `${baseGraph}/${wabaId}/message_templates` +
      `?name=${encodeURIComponent(templateName)}` +
      '&fields=id,name,status,language,category,parameter_format,components',
      token
    );

  const templatesEncontrados =
    (respostaTemplates.data || [])
      .filter(template =>
        template.name === templateName &&
        template.language ===
          templateLanguage
      );

  exigir(
    templatesEncontrados.length === 1,
    `Era esperado exatamente um template ${templateName}/${templateLanguage} na WABA de produção.`
  );

  const template =
    templatesEncontrados[0];

  validarDefinicaoTemplateMeta(
    template
  );

  const respostaNumeros =
    await requisitarJson(
      `${baseGraph}/${wabaId}/phone_numbers` +
      '?fields=id,display_phone_number,verified_name,code_verification_status,platform_type&limit=100',
      token
    );

  const numeroProducao =
    (respostaNumeros.data || [])
      .find(numero =>
        numero.id === phoneNumberId
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
    numeroProducao.platform_type ===
      'CLOUD_API',
    'O número de produção não está registrado na Cloud API.'
  );

  const midia =
    await validarMidiaPublica();

  // A partir daqui, o módulo de envio é carregado com destino de teste
  // e simulação forçada. Sem --confirmar-envio-real, nenhuma mensagem é
  // enviada, mesmo que o .env original esteja em modo de produção.
  process.env.WHATSAPP_ATIVO = 'true';
  process.env.WHATSAPP_SIMULAR =
    envioRealSolicitado
      ? 'false'
      : 'true';
  process.env.WHATSAPP_MODO_TESTE = 'true';
  process.env.WHATSAPP_TEST_NUMBER = destinoTeste;
  process.env.WHATSAPP_LOG_PAYLOAD = 'false';

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
    whatsappAmbiguo: false,
    whatsappBloqueado: false,
    whatsappDuplicadoEntreClientes:
      false,
    whatsappSeguroParaEnvio: true,
    whatsappMotivosBloqueio: [],
    clientesComMesmoWhatsapp: [],
  };

  const ordemFicticia = {
    osId: 'OS-TESTE-CONTROLADO',
    osNome: 'OS-TESTE-01/2026',
    linhas: [
      {
        recordId:
          'REGISTRO-TESTE-01',
        idTrabalho:
          'TRABALHO-TESTE-01',
        amostra: 'CP-01',
        ensaioNome:
          'Limite de Liquidez',
        ensaioSigla: 'LL',
        status:
          'Enviado ao Cliente',
      },
      {
        recordId:
          'REGISTRO-TESTE-02',
        idTrabalho:
          'TRABALHO-TESTE-02',
        amostra: 'CP-02',
        ensaioNome:
          'Módulo de Resiliência',
        ensaioSigla: 'MR-I',
        status:
          'Enviado ao Cliente',
      },
    ],
  };

  const preparado =
    prepararEnvioWhatsAppDaOS({
      cliente: clienteFicticio,
      ordem: ordemFicticia,
    });

  const validacaoPayload =
    validarPayloadControlado(
      preparado,
      destinoTeste
    );

  if (!envioRealSolicitado) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          enviado: false,
          simulado: true,
          motivo:
            'validacao-producao-sem-envio',
          template: {
            id: template.id,
            name: template.name,
            language:
              template.language,
            status:
              template.status,
            parameterFormat:
              template.parameter_format,
          },
          numeroProducao: {
            verificado: true,
            plataforma:
              numeroProducao
                .platform_type,
          },
          destinoTeste:
            mascararTelefone(
              destinoTeste
            ),
          midia,
          quantidadeItens:
            preparado.quantidadeItens,
          quantidadePartes:
            preparado.quantidadePartes,
          quantidadeMensagens:
            preparado
              .quantidadeMensagens,
          validacaoPayload,
        },
        null,
        2
      )
    );

    return;
  }

  const resultado =
    await enviarWhatsAppDaOS({
      cliente: clienteFicticio,
      ordem: ordemFicticia,
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
        ok: true,
        enviado: true,
        simulado: false,
        template: {
          id: template.id,
          name: template.name,
          status: template.status,
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
          resultado.quantidadeItens,
        quantidadePartes:
          resultado.quantidadePartes,
        quantidadeMensagens:
          resultado.quantidadeMensagens,
        validacaoPayload,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
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
}

module.exports = {
  executar,
  validarPayloadControlado,
  validarDefinicaoTemplateMeta,
  placeholdersNomeados,
  mapeamentosCorpoConfigurados,
};
