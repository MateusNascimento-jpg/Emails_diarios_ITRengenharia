'use strict';

// ============================================================
// whatsapp_template.js — MONTAGEM FINAL DO TEMPLATE DA META
// ============================================================

require('dotenv').config();

const {
  statusExibido,
} = require('./email_template.js');

// ============================================================
// CONFIGURAÇÃO
// ============================================================

function textoEnv(nome, padrao = '') {
  return String(
    process.env[nome] ?? padrao
  ).trim();
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

const CONFIG = Object.freeze({
  // Nome exato do template aprovado na Meta.
  templateName: textoEnv(
    'WHATSAPP_TEMPLATE_NAME'
  ),

  // Idioma exato do template aprovado.
  templateLanguage: textoEnv(
    'WHATSAPP_TEMPLATE_LANGUAGE',
    'pt_BR'
  ),

  // named:
  // envia parameter_name junto de cada valor.
  //
  // positional:
  // envia somente os valores na ordem configurada.
  parameterMode: textoEnv(
    'WHATSAPP_TEMPLATE_PARAMETER_MODE',
    'named'
  ).toLowerCase(),

  // Exemplos:
  //
  // ordem_servico,detalhes
  //
  // os_template=ordem_servico,
  // lista_template=detalhes
  //
  // A parte antes de "=" é o nome no template.
  // A parte depois de "=" é a variável interna.
  bodyParameters: textoEnv(
    'WHATSAPP_TEMPLATE_BODY_PARAMETERS',
    'ordem_servico,detalhes'
  ),

  // auto:
  // tenta blocos; caso fique grande, usa compacto.
  //
  // blocos:
  // Amostra:
  // Ensaio:
  // Status:
  //
  // compacto:
  // 1. Amostra | Ensaio | Status
  detailsFormat: textoEnv(
    'WHATSAPP_FORMATO_DETALHES',
    'auto'
  ).toLowerCase(),

  // Limite interno da variável detalhes.
  // Nenhum conteúdo é cortado silenciosamente.
  detailsMaxChars: numeroInteiroPositivo(
    process.env.WHATSAPP_DETALHES_MAX_CHARS,
    800
  ),

  // Tipos:
  //
  // none
  // text
  // image
  // document
  // video
  headerType: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_TYPE',
    'none'
  ).toLowerCase(),

  // Usado somente quando o cabeçalho for text.
  //
  // Exemplos:
  // ordem_servico
  // cliente_nome
  // literal:Atualização ITR
  headerTextSource: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_TEXT_SOURCE'
  ),

  // Nome do parâmetro do cabeçalho de texto,
  // caso o template use parâmetros nomeados.
  headerTextParameterName: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_TEXT_PARAMETER_NAME'
  ),

  // Para cabeçalhos image/document/video.
  //
  // Pode ser usado um ID de mídia da Meta
  // ou uma URL pública em HTTPS.
  headerMediaId: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_MEDIA_ID'
  ),

  headerMediaUrl: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL'
  ),

  // Nome opcional quando o cabeçalho for documento.
  headerDocumentFilename: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_DOCUMENT_FILENAME'
  ),

  // Botões dinâmicos opcionais.
  //
  // Exemplo:
  //
  // url:0=portal_url
  //
  // Mais de um:
  //
  // url:0=portal_url|quick_reply:1=literal:confirmar
  //
  // Botões com URL completamente fixa, já definidos
  // no template da Meta, devem permanecer vazios aqui.
  buttons: textoEnv(
    'WHATSAPP_TEMPLATE_BUTTONS'
  ),
});

// ============================================================
// LIMPEZA E VALIDAÇÃO
// ============================================================

function limparTexto(
  valor,
  fallback = ''
) {
  const resultado = String(
    valor ?? ''
  )
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return resultado || fallback;
}

function garantirModoParametros(modo) {
  if (
    modo !== 'named' &&
    modo !== 'positional'
  ) {
    throw new Error(
      'WHATSAPP_TEMPLATE_PARAMETER_MODE deve ser ' +
      '"named" ou "positional".'
    );
  }

  return modo;
}

function garantirFormatoDetalhes(formato) {
  const permitidos = new Set([
    'auto',
    'blocos',
    'compacto',
  ]);

  if (!permitidos.has(formato)) {
    throw new Error(
      'WHATSAPP_FORMATO_DETALHES deve ser ' +
      '"auto", "blocos" ou "compacto".'
    );
  }

  return formato;
}

function garantirTipoCabecalho(tipo) {
  const permitidos = new Set([
    'none',
    'text',
    'image',
    'document',
    'video',
  ]);

  if (!permitidos.has(tipo)) {
    throw new Error(
      'WHATSAPP_TEMPLATE_HEADER_TYPE deve ser ' +
      'none, text, image, document ou video.'
    );
  }

  return tipo;
}

// ============================================================
// DADOS DA ORDEM DE SERVIÇO
// ============================================================

function itensDaOS(ordem) {
  const linhas = Array.isArray(
    ordem?.linhas
  )
    ? ordem.linhas
    : [];

  const vistos = new Set();
  const itens = [];

  for (const linha of linhas) {
    const amostra = limparTexto(
      linha?.amostra,
      '-'
    );

    const ensaio = limparTexto(
      linha?.ensaioNome ||
        linha?.ensaioSigla,
      '-'
    );

    const status = limparTexto(
      statusExibido(
        linha?.status
      ),
      '-'
    );

    // Remove repetições somente quando o conjunto completo
    // Amostra + Ensaio + Status for igual.
    //
    // Uma mesma amostra pode continuar aparecendo quando
    // possuir outro ensaio ou outro status.
    const chave = [
      amostra,
      ensaio,
      status,
    ]
      .map(item => item.toLowerCase())
      .join('|');

    if (vistos.has(chave)) {
      continue;
    }

    vistos.add(chave);

    itens.push({
      amostra,
      ensaio,
      status,

      recordId: limparTexto(
        linha?.recordId
      ),

      idTrabalho: limparTexto(
        linha?.idTrabalho
      ),
    });
  }

  return itens;
}

// ============================================================
// FORMATOS DA LISTA DE AMOSTRAS
// ============================================================

function detalhesEmBlocos(itens) {
  return itens
    .map(item => [
      `Amostra: ${item.amostra}`,
      `Ensaio: ${item.ensaio}`,
      `Status: ${item.status}`,
    ].join('\n'))
    .join('\n\n');
}

function detalhesCompactos(itens) {
  return itens
    .map((item, indice) => (
      `${indice + 1}. ` +
      `${item.amostra} | ` +
      `${item.ensaio} | ` +
      `${item.status}`
    ))
    .join('\n');
}

function escolherDetalhes(itens) {
  const formato = garantirFormatoDetalhes(
    CONFIG.detailsFormat
  );

  const blocos = detalhesEmBlocos(itens);
  const compacto = detalhesCompactos(itens);

  if (formato === 'blocos') {
    return {
      formatoUsado: 'blocos',
      texto: blocos,
    };
  }

  if (formato === 'compacto') {
    return {
      formatoUsado: 'compacto',
      texto: compacto,
    };
  }

  // Modo automático:
  //
  // Primeiro utiliza o formato mais legível.
  // Se exceder o limite interno, utiliza o compacto.
  if (
    blocos.length <=
    CONFIG.detailsMaxChars
  ) {
    return {
      formatoUsado: 'blocos',
      texto: blocos,
    };
  }

  return {
    formatoUsado: 'compacto',
    texto: compacto,
  };
}

// ============================================================
// VARIÁVEIS INTERNAS DISPONÍVEIS PARA O TEMPLATE
// ============================================================

function montarVariaveisDaOS(
  cliente,
  ordem
) {
  const itens = itensDaOS(ordem);

  if (itens.length === 0) {
    return {
      ok: false,

      motivo:
        'os-sem-itens-validos',

      clienteId:
        cliente?.clienteId || '',

      osId:
        ordem?.osId || '',
    };
  }

  const detalhesResultado =
    escolherDetalhes(itens);

  // A OS nunca é dividida ou truncada silenciosamente.
  //
  // Se nem o formato compacto couber, o envio é bloqueado
  // e o erro será registrado pelo módulo de envio.
  if (
    detalhesResultado.texto.length >
    CONFIG.detailsMaxChars
  ) {
    return {
      ok: false,

      motivo:
        'detalhes-excedem-limite',

      limite:
        CONFIG.detailsMaxChars,

      tamanho:
        detalhesResultado.texto.length,

      quantidadeItens:
        itens.length,

      clienteId:
        cliente?.clienteId || '',

      osId:
        ordem?.osId || '',

      ordemServico:
        limparTexto(
          ordem?.osNome ||
            ordem?.osId,
          '-'
        ),
    };
  }

  const ordemServico = limparTexto(
    ordem?.osNome ||
      ordem?.osId,
    '-'
  );

  const clienteNome = limparTexto(
    cliente?.clienteNome,
    '-'
  );

  const amostras = itens
    .map(item => item.amostra)
    .join('\n');

  const ensaios = itens
    .map(item => item.ensaio)
    .join('\n');

  const status = itens
    .map(item => item.status)
    .join('\n');

  // Estas são as variáveis internas disponíveis.
  //
  // O futuro template poderá usar duas, três ou mais delas,
  // bastando alterar WHATSAPP_TEMPLATE_BODY_PARAMETERS.
  const contexto = Object.freeze({
    // Ordem de Serviço
    ordem_servico:
      ordemServico,

    os:
      ordemServico,

    os_id:
      limparTexto(ordem?.osId),

    // Lista associada:
    // Amostra → Ensaio → Status
    detalhes:
      detalhesResultado.texto,

    itens_compactos:
      detalhesCompactos(itens),

    // Listas separadas, disponíveis caso o template futuro
    // necessite desses parâmetros individualmente.
    amostras,
    ensaios,
    status,

    // Cliente
    cliente:
      clienteNome,

    cliente_nome:
      clienteNome,

    cliente_id:
      limparTexto(
        cliente?.clienteId
      ),

    // Quantidade de linhas da OS
    quantidade_itens:
      String(itens.length),

    // Portal
    portal_url:
      textoEnv(
        'PORTAL_CLIENTE_URL',
        'https://portal.itr.eng.br/login.html'
      ),
  });

  return {
    ok: true,

    contexto,
    itens,

    formatoDetalhes:
      detalhesResultado.formatoUsado,

    quantidadeItens:
      itens.length,
  };
}

// ============================================================
// RESOLUÇÃO DAS VARIÁVEIS
// ============================================================

function resolverValor(
  origem,
  contexto
) {
  const referencia = limparTexto(
    origem
  );

  if (!referencia) {
    throw new Error(
      'Foi configurado um parâmetro sem origem.'
    );
  }

  // Permite inserir um valor fixo pelo .env.
  //
  // Exemplo:
  // literal:Atualização da ITR
  if (
    referencia.startsWith('literal:')
  ) {
    return referencia.slice(
      'literal:'.length
    );
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      contexto,
      referencia
    )
  ) {
    throw new Error(
      `A origem "${referencia}" não existe ` +
      'no contexto da OS.'
    );
  }

  const valor = limparTexto(
    contexto[referencia]
  );

  if (!valor) {
    throw new Error(
      `A origem "${referencia}" está vazia.`
    );
  }

  return valor;
}

// ============================================================
// PARÂMETROS DO CORPO
// ============================================================

function analisarMapeamentoCorpo() {
  const itens = CONFIG.bodyParameters
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  if (itens.length === 0) {
    throw new Error(
      'WHATSAPP_TEMPLATE_BODY_PARAMETERS ' +
      'não possui parâmetros.'
    );
  }

  return itens.map(item => {
    const separador =
      item.indexOf('=');

    // Sem "=":
    //
    // ordem_servico
    //
    // Nome no template: ordem_servico
    // Origem interna: ordem_servico
    if (separador === -1) {
      return {
        parameterName:
          item,

        source:
          item,
      };
    }

    // Com "=":
    //
    // numero_os=ordem_servico
    //
    // Nome no template: numero_os
    // Origem interna: ordem_servico
    const parameterName = item
      .slice(0, separador)
      .trim();

    const source = item
      .slice(separador + 1)
      .trim();

    if (
      !parameterName ||
      !source
    ) {
      throw new Error(
        'Mapeamento inválido em ' +
        'WHATSAPP_TEMPLATE_BODY_PARAMETERS: ' +
        item
      );
    }

    return {
      parameterName,
      source,
    };
  });
}

function montarParametrosDoCorpo(
  contexto
) {
  const modo = garantirModoParametros(
    CONFIG.parameterMode
  );

  const mapeamentos =
    analisarMapeamentoCorpo();

  return mapeamentos.map(
    mapeamento => {
      const parametro = {
        type: 'text',

        text: resolverValor(
          mapeamento.source,
          contexto
        ),
      };

      if (modo === 'named') {
        parametro.parameter_name =
          mapeamento.parameterName;
      }

      return parametro;
    }
  );
}

// ============================================================
// CABEÇALHO OPCIONAL
// ============================================================

function montarComponenteCabecalho(
  contexto
) {
  const tipo = garantirTipoCabecalho(
    CONFIG.headerType
  );

  if (tipo === 'none') {
    return null;
  }

  // Cabeçalho variável de texto.
  if (tipo === 'text') {
    if (!CONFIG.headerTextSource) {
      throw new Error(
        'Defina ' +
        'WHATSAPP_TEMPLATE_HEADER_TEXT_SOURCE ' +
        'para o cabeçalho de texto.'
      );
    }

    const parametro = {
      type: 'text',

      text: resolverValor(
        CONFIG.headerTextSource,
        contexto
      ),
    };

    if (
      garantirModoParametros(
        CONFIG.parameterMode
      ) === 'named' &&
      CONFIG.headerTextParameterName
    ) {
      parametro.parameter_name =
        CONFIG.headerTextParameterName;
    }

    return {
      type: 'header',

      parameters: [
        parametro,
      ],
    };
  }

  // Cabeçalhos de mídia:
  //
  // image
  // document
  // video
  const midia = {};

  if (CONFIG.headerMediaId) {
    midia.id =
      CONFIG.headerMediaId;
  } else if (
    CONFIG.headerMediaUrl
  ) {
    midia.link =
      CONFIG.headerMediaUrl;
  } else {
    throw new Error(
      `O cabeçalho ${tipo} exige ` +
      'WHATSAPP_TEMPLATE_HEADER_MEDIA_ID ou ' +
      'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL.'
    );
  }

  if (
    tipo === 'document' &&
    CONFIG.headerDocumentFilename
  ) {
    midia.filename =
      CONFIG.headerDocumentFilename;
  }

  return {
    type: 'header',

    parameters: [
      {
        type: tipo,

        [tipo]: midia,
      },
    ],
  };
}

// ============================================================
// BOTÕES DINÂMICOS OPCIONAIS
// ============================================================
// Formato de WHATSAPP_TEMPLATE_BUTTONS:
//
// url:0=portal_url
//
// Mais de um:
//
// url:0=portal_url|quick_reply:1=literal:confirmar
//
// Botões com URL fixa já configurada na Meta não precisam
// aparecer nessa variável.
// ============================================================

function montarComponentesBotoes(
  contexto
) {
  if (!CONFIG.buttons) {
    return [];
  }

  const definicoes = CONFIG.buttons
    .split('|')
    .map(item => item.trim())
    .filter(Boolean);

  return definicoes.map(
    definicao => {
      const correspondencia =
        /^(url|quick_reply):(\d+)=(.+)$/.exec(
          definicao
        );

      if (!correspondencia) {
        throw new Error(
          'Botão inválido em ' +
          'WHATSAPP_TEMPLATE_BUTTONS: ' +
          definicao
        );
      }

      const [
        ,
        subtipo,
        indice,
        origem,
      ] = correspondencia;

      const valor = resolverValor(
        origem,
        contexto
      );

      const parametro =
        subtipo === 'quick_reply'
          ? {
              type: 'payload',
              payload: valor,
            }
          : {
              type: 'text',
              text: valor,
            };

      return {
        type: 'button',

        sub_type:
          subtipo,

        index:
          indice,

        parameters: [
          parametro,
        ],
      };
    }
  );
}

// ============================================================
// PAYLOAD COMPLETO DA WHATSAPP CLOUD API
// ============================================================

function montarPayloadTemplateWhatsApp({
  cliente,
  ordem,
  telefone,
}) {
  const templateName = limparTexto(
    CONFIG.templateName
  );

  const templateLanguage = limparTexto(
    CONFIG.templateLanguage
  );

  if (!templateName) {
    return {
      ok: false,

      motivo:
        'template-nao-configurado',

      mensagem:
        'Preencha WHATSAPP_TEMPLATE_NAME.',
    };
  }

  if (!templateLanguage) {
    return {
      ok: false,

      motivo:
        'idioma-template-nao-configurado',

      mensagem:
        'Preencha WHATSAPP_TEMPLATE_LANGUAGE.',
    };
  }

  const telefoneFinal = limparTexto(
    telefone ||
      cliente?.whatsapp
  );

  if (!telefoneFinal) {
    return {
      ok: false,

      motivo:
        'telefone-ausente',

      clienteId:
        cliente?.clienteId || '',

      osId:
        ordem?.osId || '',
    };
  }

  const variaveis =
    montarVariaveisDaOS(
      cliente,
      ordem
    );

  if (!variaveis.ok) {
    return variaveis;
  }

  try {
    const components = [];

    const cabecalho =
      montarComponenteCabecalho(
        variaveis.contexto
      );

    if (cabecalho) {
      components.push(
        cabecalho
      );
    }

    components.push({
      type: 'body',

      parameters:
        montarParametrosDoCorpo(
          variaveis.contexto
        ),
    });

    components.push(
      ...montarComponentesBotoes(
        variaveis.contexto
      )
    );

    return {
      ok: true,

      // Este objeto será enviado diretamente para:
      //
      // POST /{PHONE_NUMBER_ID}/messages
      payload: {
        messaging_product:
          'whatsapp',

        recipient_type:
          'individual',

        to:
          telefoneFinal,

        type:
          'template',

        template: {
          name:
            templateName,

          language: {
            code:
              templateLanguage,
          },

          components,
        },
      },

      contexto:
        variaveis.contexto,

      itens:
        variaveis.itens,

      quantidadeItens:
        variaveis.quantidadeItens,

      formatoDetalhes:
        variaveis.formatoDetalhes,

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
  } catch (erro) {
    return {
      ok: false,

      motivo:
        'configuracao-template-invalida',

      mensagem:
        erro.message,

      clienteId:
        cliente?.clienteId || '',

      osId:
        ordem?.osId || '',
    };
  }
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  montarPayloadTemplateWhatsApp,
  montarVariaveisDaOS,

  itensDaOS,
  detalhesEmBlocos,
  detalhesCompactos,

  CONFIG,
};