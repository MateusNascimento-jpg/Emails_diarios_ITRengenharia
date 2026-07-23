'use strict';

require('dotenv').config();

const { statusExibido } = require('./email_template.js');

function textoEnv(nome, padrao = '') {
  return String(process.env[nome] ?? padrao).trim();
}

function inteiroPositivo(valor, padrao) {
  const numero = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(numero) && numero > 0
    ? numero
    : padrao;
}

function inteiroNaoNegativo(valor, padrao) {
  const numero = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(numero) && numero >= 0
    ? numero
    : padrao;
}

const CONFIG = Object.freeze({
  templateName:
    textoEnv('WHATSAPP_TEMPLATE_NAME'),

  templateLanguage:
    textoEnv(
      'WHATSAPP_TEMPLATE_LANGUAGE',
      'pt_BR'
    ),

  parameterMode:
    textoEnv(
      'WHATSAPP_TEMPLATE_PARAMETER_MODE',
      'named'
    ).toLowerCase(),

  bodyParameters:
    textoEnv(
      'WHATSAPP_TEMPLATE_BODY_PARAMETERS',
      'ordem_servico,detalhes'
    ),

  detailsFormat:
    textoEnv(
      'WHATSAPP_FORMATO_DETALHES',
      'auto'
    ).toLowerCase(),

  detailsMaxChars:
    inteiroPositivo(
      process.env.WHATSAPP_DETALHES_MAX_CHARS,
      800
    ),

  templateBodyMaxChars:
    inteiroPositivo(
      process.env.WHATSAPP_TEMPLATE_BODY_MAX_CHARS,
      1024
    ),

  templateBodyFixedChars:
    inteiroNaoNegativo(
      process.env.WHATSAPP_TEMPLATE_BODY_FIXED_CHARS,
      306
    ),

  templateBodySafetyMargin:
    inteiroNaoNegativo(
      process.env.WHATSAPP_TEMPLATE_BODY_SAFETY_MARGIN,
      20
    ),

  headerType:
    textoEnv(
      'WHATSAPP_TEMPLATE_HEADER_TYPE',
      'none'
    ).toLowerCase(),

  headerTextSource:
    textoEnv(
      'WHATSAPP_TEMPLATE_HEADER_TEXT_SOURCE'
    ),

  headerTextParameterName:
    textoEnv(
      'WHATSAPP_TEMPLATE_HEADER_TEXT_PARAMETER_NAME'
    ),

  headerMediaId:
    textoEnv(
      'WHATSAPP_TEMPLATE_HEADER_MEDIA_ID'
    ),

  headerMediaUrl:
    textoEnv(
      'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL'
    ),

  headerDocumentFilename:
    textoEnv(
      'WHATSAPP_TEMPLATE_HEADER_DOCUMENT_FILENAME'
    ),

  buttons:
    textoEnv(
      'WHATSAPP_TEMPLATE_BUTTONS'
    ),
});

function limparTexto(
  valor,
  fallback = ''
) {
  const texto =
    String(valor ?? '')
      .replace(/\r\n|\r/g, '\n')
      .replace(/[\t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  return texto || fallback;
}

function normalizarParametroMeta(
  valor
) {
  return String(valor ?? '')
    .normalize('NFKC')
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ' '
    )
    .replace(
      /(?:\r\n|[\r\n\t\u2028\u2029])+/g,
      ' • '
    )
    .replace(
      /(?:\s*(?:\|\||•)\s*)+/g,
      ' • '
    )
    .replace(
      / {3,}/g,
      '  '
    )
    .replace(
      /^(?:\s*•\s*)+|(?:\s*•\s*)+$/g,
      ''
    )
    .trim();
}

function normalizarParametroMetaMultilinha(
  valor
) {
  return String(valor ?? '')
    .replace(/\r\n|\r/g, '\n')
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ' '
    )
    .replace(/\t+/g, ' ')
    .split('\n')
    .map(
      linha =>
        linha
          .replace(
            / {3,}/g,
            '  '
          )
          .trim()
    )
    .join('\n')
    .replace(
      /\n{4,}/g,
      '\n\n\n'
    )
    .trim();
}

function parametroMetaPossuiCaracterProibido(
  valor
) {
  return /[\r\n\t\u2028\u2029]/.test(
    String(valor ?? '')
  );
}

function parametroMetaPossuiEspacosExcessivos(
  valor
) {
  return / {5,}/.test(
    String(valor ?? '')
  );
}

function validarTextoParametroMeta(
  valor,
  identificacao = 'parâmetro'
) {
  const texto =
    String(valor ?? '');

  if (!texto.trim()) {
    throw new Error(
      `${identificacao} ficou vazio.`
    );
  }

  if (
    parametroMetaPossuiCaracterProibido(
      texto
    )
  ) {
    throw new Error(
      `${identificacao} contém quebra de linha ou tabulação.`
    );
  }

  if (
    parametroMetaPossuiEspacosExcessivos(
      texto
    )
  ) {
    throw new Error(
      `${identificacao} contém mais de quatro espaços consecutivos.`
    );
  }

  return texto;
}

function validarPayloadTemplateMeta(
  payload
) {
  const componentes =
    payload?.template?.components;

  if (!Array.isArray(componentes)) {
    throw new Error(
      'O payload não possui componentes de template válidos.'
    );
  }

  for (
    const componente
    of componentes
  ) {
    const parametros =
      Array.isArray(
        componente?.parameters
      )
        ? componente.parameters
        : [];

    for (
      let indice = 0;
      indice < parametros.length;
      indice += 1
    ) {
      const parametro =
        parametros[indice];

      const identificacao =
        `Componente ${componente?.type || 'desconhecido'}, ` +
        `parâmetro ${indice + 1}`;

      if (
        parametro?.type ===
        'text'
      ) {
        validarTextoParametroMeta(
          parametro.text,
          identificacao
        );
      }

      if (
        parametro?.type ===
        'payload'
      ) {
        validarTextoParametroMeta(
          parametro.payload,
          identificacao
        );
      }
    }
  }

  return true;
}

function contarCaracteres(
  valor
) {
  return Array.from(
    String(valor ?? '')
  ).length;
}

function urlHttpsValida(
  valor
) {
  try {
    return new URL(
      String(valor ?? '').trim()
    ).protocol === 'https:';
  } catch {
    return false;
  }
}

function garantirModoParametros(
  modo
) {
  if (
    ![
      'named',
      'positional',
    ].includes(modo)
  ) {
    throw new Error(
      'WHATSAPP_TEMPLATE_PARAMETER_MODE deve ser "named" ou "positional".'
    );
  }

  return modo;
}

function garantirFormatoDetalhes(
  formato
) {
  if (
    ![
      'auto',
      'blocos',
      'compacto',
    ].includes(formato)
  ) {
    throw new Error(
      'WHATSAPP_FORMATO_DETALHES deve ser "auto", "blocos" ou "compacto".'
    );
  }

  return formato;
}

function garantirTipoCabecalho(
  tipo
) {
  if (
    ![
      'none',
      'text',
      'image',
      'document',
      'video',
    ].includes(tipo)
  ) {
    throw new Error(
      'WHATSAPP_TEMPLATE_HEADER_TYPE deve ser none, text, image, document ou video.'
    );
  }

  return tipo;
}

function itensDaOS(
  ordem
) {
  const linhas =
    Array.isArray(
      ordem?.linhas
    )
      ? ordem.linhas
      : [];

  const vistos =
    new Set();

  const itens = [];

  for (
    const linha
    of linhas
  ) {
    const amostra =
      limparTexto(
        linha?.amostra,
        '-'
      );

    const ensaioNome =
      limparTexto(
        linha?.ensaioNome
      );

    const ensaioSigla =
      limparTexto(
        linha?.ensaioSigla
      );

    const ensaio =
      limparTexto(
        ensaioNome ||
          ensaioSigla,
        '-'
      );

    const ensaioCurto =
      limparTexto(
        ensaioNome ||
          ensaioSigla ||
          ensaio,
        '-'
      );

    const status =
      limparTexto(
        statusExibido(
          linha?.status
        ),
        '-'
      );

    const chave =
      [
        amostra,
        ensaio,
        status,
      ]
        .map(
          item =>
            item.toLowerCase()
        )
        .join('|');

    if (
      vistos.has(chave)
    ) {
      continue;
    }

    vistos.add(chave);

    itens.push({
      amostra,
      ensaio,
      ensaioNome,
      ensaioSigla,
      ensaioCurto,
      status,

      recordId:
        limparTexto(
          linha?.recordId
        ),

      idTrabalho:
        limparTexto(
          linha?.idTrabalho
        ),
    });
  }

  return itens;
}

function detalhesEmBlocos(
  itens
) {
  return itens
    .map(
      (item, indice) =>
        [
          `◆ *${indice + 1}) Amostra:* ${item.amostra}`,
          `*Ensaio:* ${item.ensaioCurto}`,
          `*Status:* ${item.status}`,
        ].join(' • ')
    )
    .join('  ');
}

function validarEstruturaDetalhesEmBlocos(
  texto,
  quantidadeItens
) {
  const detalhes =
    String(texto ?? '');

  if (
    /[\r\n\t\u2028\u2029]/.test(
      detalhes
    )
  ) {
    throw new Error(
      'Os detalhes em blocos contêm quebra de linha ou tabulação.'
    );
  }

  if (
    / {3,}/.test(
      detalhes
    )
  ) {
    throw new Error(
      'Os detalhes em blocos contêm mais de dois espaços consecutivos.'
    );
  }

  for (
    let indice = 2;
    indice <= quantidadeItens;
    indice += 1
  ) {
    const marcador =
      `  ◆ *${indice}) Amostra:*`;

    if (
      !detalhes.includes(
        marcador
      )
    ) {
      throw new Error(
        `A separação visual antes do item ${indice} está incorreta.`
      );
    }
  }

  return true;
}

function compactarPrefixoComum(
  valores
) {
  const lista =
    [...valores].map(
      valor =>
        limparTexto(
          valor,
          '-'
        )
    );

  if (
    lista.length < 2
  ) {
    return lista.join('; ');
  }

  let prefixo =
    lista[0];

  for (
    const valor
    of lista.slice(1)
  ) {
    while (
      prefixo &&
      !valor.startsWith(
        prefixo
      )
    ) {
      prefixo =
        prefixo.slice(
          0,
          -1
        );
    }
  }

  const ultimoEspaco =
    prefixo.lastIndexOf(' ');

  if (
    ultimoEspaco < 3
  ) {
    return lista.join('; ');
  }

  prefixo =
    prefixo.slice(
      0,
      ultimoEspaco + 1
    );

  const rotulo =
    prefixo.trim();

  const sufixos =
    lista.map(
      valor =>
        valor
          .slice(
            prefixo.length
          )
          .trim()
    );

  if (
    !rotulo ||
    sufixos.some(
      item => !item
    )
  ) {
    return lista.join('; ');
  }

  const original =
    lista.join('; ');

  const compactado =
    `${rotulo} ${sufixos.join('; ')}`;

  return compactado.length <
    original.length
    ? compactado
    : original;
}

function detalhesCompactos(
  itens
) {
  const porAmostra =
    new Map();

  const porEnsaio =
    new Map();

  for (
    const item
    of itens
  ) {
    const ensaioCurto =
      limparTexto(
        item.ensaioCurto ||
          item.ensaioSigla ||
          item.ensaioNome ||
          item.ensaio,
        '-'
      );

    const chaveAmostra =
      [
        item.amostra,
        item.status,
      ].join('\u0000');

    const chaveEnsaio =
      [
        ensaioCurto,
        item.status,
      ].join('\u0000');

    if (
      !porAmostra.has(
        chaveAmostra
      )
    ) {
      porAmostra.set(
        chaveAmostra,
        {
          amostra:
            item.amostra,

          status:
            item.status,

          ensaios:
            new Set(),
        }
      );
    }

    porAmostra
      .get(chaveAmostra)
      .ensaios
      .add(ensaioCurto);

    if (
      !porEnsaio.has(
        chaveEnsaio
      )
    ) {
      porEnsaio.set(
        chaveEnsaio,
        {
          ensaio:
            ensaioCurto,

          status:
            item.status,

          amostras:
            new Set(),
        }
      );
    }

    porEnsaio
      .get(chaveEnsaio)
      .amostras
      .add(item.amostra);
  }

  const textoPorAmostra =
    [...porAmostra.values()]
      .map(
        grupo =>
          `${grupo.amostra}: ` +
          `${[...grupo.ensaios].join('; ')} ` +
          `(${grupo.status})`
      )
      .join('\n');

  const secoesPorStatus =
    new Map();

  for (
    const grupo
    of porEnsaio.values()
  ) {
    if (
      !secoesPorStatus.has(
        grupo.status
      )
    ) {
      secoesPorStatus.set(
        grupo.status,
        []
      );
    }

    secoesPorStatus
      .get(grupo.status)
      .push(
        `${grupo.ensaio}: ` +
        `${compactarPrefixoComum(
          grupo.amostras
        )}`
      );
  }

  const textoPorEnsaio =
    [...secoesPorStatus.entries()]
      .map(
        ([status, linhas]) =>
          `Status: ${status}\n` +
          `${linhas.join('\n')}`
      )
      .join('\n\n');

  return textoPorEnsaio.length <
    textoPorAmostra.length
    ? textoPorEnsaio
    : textoPorAmostra;
}

function estimarTamanhoCorpoFinal({
  ordemServico,
  detalhes,
}) {
  return (
    CONFIG.templateBodyFixedChars +
    contarCaracteres(
      normalizarParametroMeta(
        ordemServico
      )
    ) +
    contarCaracteres(
      normalizarParametroMeta(
        detalhes
      )
    )
  );
}

function limiteEfetivoCorpo() {
  return Math.max(
    1,
    CONFIG.templateBodyMaxChars -
      CONFIG.templateBodySafetyMargin
  );
}

function candidatoDetalhes({
  formato,
  texto,
  ordemServico,
}) {
  const textoNormalizado =
    normalizarParametroMeta(
      texto
    );

  const tamanhoDetalhes =
    contarCaracteres(
      textoNormalizado
    );

  const tamanhoCorpoEstimado =
    estimarTamanhoCorpoFinal({
      ordemServico,

      detalhes:
        textoNormalizado,
    });

  const limiteCorpo =
    limiteEfetivoCorpo();

  return {
    formatoUsado:
      formato,

    texto:
      textoNormalizado,

    tamanhoDetalhes,

    tamanhoCorpoEstimado,

    limiteCorpo,

    cabeNoLimiteDetalhes:
      tamanhoDetalhes <=
      CONFIG.detailsMaxChars,

    cabeNoLimiteCorpo:
      tamanhoCorpoEstimado <=
      limiteCorpo,
  };
}

function escolherDetalhes(
  itens,
  ordemServico
) {
  const formato =
    garantirFormatoDetalhes(
      CONFIG.detailsFormat
    );

  const blocos =
    candidatoDetalhes({
      formato:
        'blocos',

      texto:
        detalhesEmBlocos(
          itens
        ),

      ordemServico,
    });

  const compacto =
    candidatoDetalhes({
      formato:
        'compacto',

      texto:
        detalhesCompactos(
          itens
        ),

      ordemServico,
    });

  if (
    formato === 'blocos'
  ) {
    return blocos;
  }

  if (
    formato === 'compacto'
  ) {
    return compacto;
  }

  return (
    blocos.cabeNoLimiteDetalhes &&
    blocos.cabeNoLimiteCorpo
  )
    ? blocos
    : compacto;
}

function montarVariaveisDaOS(
  cliente,
  ordem
) {
  const itens =
    itensDaOS(
      ordem
    );

  if (
    itens.length === 0
  ) {
    return {
      ok:
        false,

      motivo:
        'os-sem-itens-validos',

      clienteId:
        cliente?.clienteId || '',

      osId:
        ordem?.osId || '',
    };
  }

  const ordemServico =
    limparTexto(
      ordem?.osNome ||
        ordem?.osId,
      '-'
    );

  const detalhesResultado =
    escolherDetalhes(
      itens,
      ordemServico
    );

  if (
    detalhesResultado
      .formatoUsado ===
    'blocos'
  ) {
    validarEstruturaDetalhesEmBlocos(
      detalhesResultado.texto,
      itens.length
    );
  }

  if (
    !detalhesResultado
      .cabeNoLimiteDetalhes ||
    !detalhesResultado
      .cabeNoLimiteCorpo
  ) {
    return {
      ok:
        false,

      motivo:
        'detalhes-excedem-limite',

      limite:
        CONFIG.detailsMaxChars,

      limiteCorpo:
        detalhesResultado
          .limiteCorpo,

      tamanho:
        detalhesResultado
          .tamanhoDetalhes,

      tamanhoCorpoEstimado:
        detalhesResultado
          .tamanhoCorpoEstimado,

      formatoTentado:
        detalhesResultado
          .formatoUsado,

      quantidadeItens:
        itens.length,

      clienteId:
        cliente?.clienteId || '',

      osId:
        ordem?.osId || '',

      ordemServico,
    };
  }

  const clienteNome =
    limparTexto(
      cliente?.clienteNome,
      '-'
    );

  const contexto =
    Object.freeze({
      ordem_servico:
        ordemServico,

      os:
        ordemServico,

      os_id:
        limparTexto(
          ordem?.osId
        ),

      detalhes:
        detalhesResultado
          .texto,

      itens_compactos:
        normalizarParametroMetaMultilinha(
          detalhesCompactos(
            itens
          )
        ),

      amostras:
        itens
          .map(
            item =>
              item.amostra
          )
          .join('\n'),

      ensaios:
        itens
          .map(
            item =>
              item.ensaio
          )
          .join('\n'),

      status:
        itens
          .map(
            item =>
              item.status
          )
          .join('\n'),

      cliente:
        clienteNome,

      cliente_nome:
        clienteNome,

      cliente_id:
        limparTexto(
          cliente?.clienteId
        ),

      quantidade_itens:
        String(
          itens.length
        ),

      portal_url:
        textoEnv(
          'PORTAL_CLIENTE_URL',
          'https://portal.itr.eng.br/login.html'
        ),
    });

  return {
    ok:
      true,

    contexto,

    itens,

    formatoDetalhes:
      detalhesResultado
        .formatoUsado,

    quantidadeItens:
      itens.length,

    tamanhoDetalhes:
      detalhesResultado
        .tamanhoDetalhes,

    tamanhoCorpoEstimado:
      detalhesResultado
        .tamanhoCorpoEstimado,

    limiteCorpo:
      detalhesResultado
        .limiteCorpo,
  };
}

function resolverValor(
  origem,
  contexto,
  {
    preservarQuebras = false,
  } = {}
) {
  const referencia =
    limparTexto(
      origem
    );

  if (!referencia) {
    throw new Error(
      'Foi configurado um parâmetro sem origem.'
    );
  }

  if (
    referencia.startsWith(
      'literal:'
    )
  ) {
    const literal =
      referencia.slice(
        'literal:'.length
      );

    return preservarQuebras
      ? normalizarParametroMetaMultilinha(
          literal
        )
      : limparTexto(
          literal
        );
  }

  if (
    !Object.prototype
      .hasOwnProperty
      .call(
        contexto,
        referencia
      )
  ) {
    throw new Error(
      `A origem "${referencia}" não existe no contexto da OS.`
    );
  }

  const valor =
    preservarQuebras
      ? normalizarParametroMetaMultilinha(
          contexto[referencia]
        )
      : limparTexto(
          contexto[referencia]
        );

  if (!valor) {
    throw new Error(
      `A origem "${referencia}" está vazia.`
    );
  }

  return valor;
}

function origemPermiteMultilinha(
  origem
) {
  return new Set([
    'detalhes',
    'itens_compactos',
    'amostras',
    'ensaios',
    'status',
  ]).has(
    limparTexto(
      origem
    )
  );
}

function analisarMapeamentoCorpo() {
  const itens =
    CONFIG.bodyParameters
      .split(',')
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean);

  if (
    itens.length === 0
  ) {
    throw new Error(
      'WHATSAPP_TEMPLATE_BODY_PARAMETERS não possui parâmetros.'
    );
  }

  return itens.map(
    item => {
      const separador =
        item.indexOf('=');

      if (
        separador === -1
      ) {
        return {
          parameterName:
            item,

          source:
            item,
        };
      }

      const parameterName =
        item
          .slice(
            0,
            separador
          )
          .trim();

      const source =
        item
          .slice(
            separador + 1
          )
          .trim();

      if (
        !parameterName ||
        !source
      ) {
        throw new Error(
          `Mapeamento inválido em WHATSAPP_TEMPLATE_BODY_PARAMETERS: ${item}`
        );
      }

      return {
        parameterName,
        source,
      };
    }
  );
}

function montarParametrosDoCorpo(
  contexto
) {
  const modo =
    garantirModoParametros(
      CONFIG.parameterMode
    );

  return analisarMapeamentoCorpo()
    .map(
      mapeamento => {
        const valorResolvido =
          resolverValor(
            mapeamento.source,
            contexto,
            {
              preservarQuebras:
                origemPermiteMultilinha(
                  mapeamento.source
                ),
            }
          );

        const textoNormalizado =
          normalizarParametroMeta(
            valorResolvido
          );

        validarTextoParametroMeta(
          textoNormalizado,
          `Parâmetro "${mapeamento.parameterName}"`
        );

        const parametro = {
          type:
            'text',

          text:
            textoNormalizado,
        };

        if (
          modo === 'named'
        ) {
          parametro.parameter_name =
            mapeamento.parameterName;
        }

        return parametro;
      }
    );
}

function montarComponenteCabecalho(
  contexto
) {
  const tipo =
    garantirTipoCabecalho(
      CONFIG.headerType
    );

  if (
    tipo === 'none'
  ) {
    return null;
  }

  if (
    tipo === 'text'
  ) {
    if (
      !CONFIG.headerTextSource
    ) {
      throw new Error(
        'Defina WHATSAPP_TEMPLATE_HEADER_TEXT_SOURCE para o cabeçalho de texto.'
      );
    }

    const texto =
      normalizarParametroMeta(
        resolverValor(
          CONFIG.headerTextSource,
          contexto
        )
      );

    validarTextoParametroMeta(
      texto,
      'Parâmetro do cabeçalho'
    );

    const parametro = {
      type:
        'text',

      text:
        texto,
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
      type:
        'header',

      parameters: [
        parametro,
      ],
    };
  }

  const midia = {};

  if (
    CONFIG.headerMediaId
  ) {
    midia.id =
      CONFIG.headerMediaId;
  } else if (
    CONFIG.headerMediaUrl
  ) {
    if (
      !urlHttpsValida(
        CONFIG.headerMediaUrl
      )
    ) {
      throw new Error(
        'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL deve usar HTTPS e ser válida.'
      );
    }

    midia.link =
      CONFIG.headerMediaUrl;
  } else {
    throw new Error(
      `O cabeçalho ${tipo} exige ` +
      'WHATSAPP_TEMPLATE_HEADER_MEDIA_ID ' +
      'ou WHATSAPP_TEMPLATE_HEADER_MEDIA_URL.'
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
    type:
      'header',

    parameters: [
      {
        type:
          tipo,

        [tipo]:
          midia,
      },
    ],
  };
}

function montarComponentesBotoes(
  contexto
) {
  if (
    !CONFIG.buttons
  ) {
    return [];
  }

  return CONFIG.buttons
    .split('|')
    .map(
      item =>
        item.trim()
    )
    .filter(Boolean)
    .map(
      definicao => {
        const correspondencia =
          /^(url|quick_reply):(\d+)=(.+)$/.exec(
            definicao
          );

        if (
          !correspondencia
        ) {
          throw new Error(
            `Botão inválido em WHATSAPP_TEMPLATE_BUTTONS: ${definicao}`
          );
        }

        const [
          ,
          subtipo,
          indice,
          origem,
        ] = correspondencia;

        const valor =
          normalizarParametroMeta(
            resolverValor(
              origem,
              contexto
            )
          );

        validarTextoParametroMeta(
          valor,
          `Parâmetro do botão ${indice}`
        );

        const parametro =
          subtipo ===
          'quick_reply'
            ? {
                type:
                  'payload',

                payload:
                  valor,
              }
            : {
                type:
                  'text',

                text:
                  valor,
              };

        return {
          type:
            'button',

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

function montarPayloadTemplateWhatsApp({
  cliente,
  ordem,
  telefone,
}) {
  const templateName =
    limparTexto(
      CONFIG.templateName
    );

  const templateLanguage =
    limparTexto(
      CONFIG.templateLanguage
    );

  if (!templateName) {
    return {
      ok:
        false,

      motivo:
        'template-nao-configurado',

      mensagem:
        'Preencha WHATSAPP_TEMPLATE_NAME.',
    };
  }

  if (!templateLanguage) {
    return {
      ok:
        false,

      motivo:
        'idioma-template-nao-configurado',

      mensagem:
        'Preencha WHATSAPP_TEMPLATE_LANGUAGE.',
    };
  }

  const telefoneFinal =
    limparTexto(
      telefone ||
        cliente?.whatsapp
    );

  if (!telefoneFinal) {
    return {
      ok:
        false,

      motivo:
        'telefone-ausente',

      clienteId:
        cliente?.clienteId || '',

      osId:
        ordem?.osId || '',
    };
  }

  try {
    const variaveis =
      montarVariaveisDaOS(
        cliente,
        ordem
      );

    if (
      !variaveis.ok
    ) {
      return variaveis;
    }

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
      type:
        'body',

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

    const payload = {
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
    };

    validarPayloadTemplateMeta(
      payload
    );

    return {
      ok:
        true,

      payload,

      contexto:
        variaveis.contexto,

      itens:
        variaveis.itens,

      quantidadeItens:
        variaveis
          .quantidadeItens,

      formatoDetalhes:
        variaveis
          .formatoDetalhes,

      tamanhoDetalhes:
        variaveis
          .tamanhoDetalhes,

      tamanhoCorpoEstimado:
        variaveis
          .tamanhoCorpoEstimado,

      limiteCorpo:
        variaveis
          .limiteCorpo,

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
      ok:
        false,

      motivo:
        'configuracao-template-invalida',

      mensagem:
        erro?.message ||
        String(erro),

      clienteId:
        cliente?.clienteId || '',

      osId:
        ordem?.osId || '',
    };
  }
}

module.exports = {
  montarPayloadTemplateWhatsApp,
  montarVariaveisDaOS,

  itensDaOS,
  detalhesEmBlocos,
  detalhesCompactos,
  validarEstruturaDetalhesEmBlocos,

  normalizarParametroMeta,
  normalizarParametroMetaMultilinha,

  parametroMetaPossuiCaracterProibido,
  parametroMetaPossuiEspacosExcessivos,

  validarTextoParametroMeta,
  validarPayloadTemplateMeta,

  contarCaracteres,
  estimarTamanhoCorpoFinal,

  CONFIG,
};