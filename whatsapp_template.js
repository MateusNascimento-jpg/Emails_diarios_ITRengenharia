'use strict';

process.env.DOTENV_CONFIG_QUIET = 'true';
require('dotenv').config({ quiet: true });

const { statusExibido } = require('./email_template.js');

const MARCADOR_ITEM = '◆';
const SEPARADOR_VISUAL_ITENS = '  ';

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
  templateName: textoEnv(
    'WHATSAPP_TEMPLATE_NAME'
  ),

  templateLanguage: textoEnv(
    'WHATSAPP_TEMPLATE_LANGUAGE',
    'pt_BR'
  ),

  parameterMode: textoEnv(
    'WHATSAPP_TEMPLATE_PARAMETER_MODE',
    'named'
  ).toLowerCase(),

  bodyParameters: textoEnv(
    'WHATSAPP_TEMPLATE_BODY_PARAMETERS',
    'ordem_servico,detalhes'
  ),

  detailsFormat: textoEnv(
    'WHATSAPP_FORMATO_DETALHES',
    'auto'
  ).toLowerCase(),

  detailsMaxChars: inteiroPositivo(
    process.env.WHATSAPP_DETALHES_MAX_CHARS,
    800
  ),

  templateBodyMaxChars: inteiroPositivo(
    process.env.WHATSAPP_TEMPLATE_BODY_MAX_CHARS,
    1024
  ),

  templateBodyFixedChars: inteiroNaoNegativo(
    process.env.WHATSAPP_TEMPLATE_BODY_FIXED_CHARS,
    306
  ),

  templateBodySafetyMargin: inteiroNaoNegativo(
    process.env.WHATSAPP_TEMPLATE_BODY_SAFETY_MARGIN,
    20
  ),

  headerType: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_TYPE',
    'none'
  ).toLowerCase(),

  headerTextSource: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_TEXT_SOURCE'
  ),

  headerTextParameterName: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_TEXT_PARAMETER_NAME'
  ),

  headerMediaId: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_MEDIA_ID'
  ),

  headerMediaUrl: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL'
  ),

  headerDocumentFilename: textoEnv(
    'WHATSAPP_TEMPLATE_HEADER_DOCUMENT_FILENAME'
  ),

  buttons: textoEnv(
    'WHATSAPP_TEMPLATE_BUTTONS'
  ),
});

function limparTexto(valor, fallback = '') {
  const resultado = String(valor ?? '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return resultado || fallback;
}

function normalizarParametroMeta(valor) {
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
    .replace(/ {3,}/g, '  ')
    .replace(
      /^(?:\s*•\s*)+|(?:\s*•\s*)+$/g,
      ''
    )
    .trim();
}

// Mantida por compatibilidade.
// A Meta não permite quebras dentro dos parâmetros.
function normalizarParametroMetaMultilinha(valor) {
  return normalizarParametroMeta(valor);
}

function parametroMetaPossuiCaracterProibido(valor) {
  return /[\r\n\t\u2028\u2029]/.test(
    String(valor ?? '')
  );
}

function parametroMetaPossuiEspacosExcessivos(valor) {
  return / {5,}/.test(
    String(valor ?? '')
  );
}

function validarTextoParametroMeta(
  valor,
  identificacao = 'parâmetro'
) {
  const resultado = String(valor ?? '');

  if (!resultado.trim()) {
    throw new Error(
      `${identificacao} ficou vazio.`
    );
  }

  if (
    parametroMetaPossuiCaracterProibido(
      resultado
    )
  ) {
    throw new Error(
      `${identificacao} contém quebra de linha ou tabulação.`
    );
  }

  if (
    parametroMetaPossuiEspacosExcessivos(
      resultado
    )
  ) {
    throw new Error(
      `${identificacao} contém mais de quatro espaços consecutivos.`
    );
  }

  return resultado;
}

function validarPayloadTemplateMeta(payload) {
  const componentes =
    payload?.template?.components;

  if (!Array.isArray(componentes)) {
    throw new Error(
      'O payload não possui componentes de template válidos.'
    );
  }

  for (const componente of componentes) {
    const parametros = Array.isArray(
      componente?.parameters
    )
      ? componente.parameters
      : [];

    parametros.forEach(
      (parametro, indice) => {
        const identificacao =
          `Componente ${componente?.type || 'desconhecido'}, ` +
          `parâmetro ${indice + 1}`;

        if (parametro?.type === 'text') {
          validarTextoParametroMeta(
            parametro.text,
            identificacao
          );
        }

        if (parametro?.type === 'payload') {
          validarTextoParametroMeta(
            parametro.payload,
            identificacao
          );
        }
      }
    );
  }

  return true;
}

function contarCaracteres(valor) {
  return Array.from(
    String(valor ?? '')
  ).length;
}

function urlHttpsValida(valor) {
  try {
    return new URL(
      String(valor ?? '').trim()
    ).protocol === 'https:';
  } catch {
    return false;
  }
}

function garantirModoParametros(modo) {
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

function garantirFormatoDetalhes(formato) {
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

function garantirTipoCabecalho(tipo) {
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

    const ensaioNome = limparTexto(
      linha?.ensaioNome
    );

    const ensaioSigla = limparTexto(
      linha?.ensaioSigla
    );

    const ensaio = limparTexto(
      ensaioNome || ensaioSigla,
      '-'
    );

    const ensaioCurto = limparTexto(
      ensaioNome ||
        ensaioSigla ||
        ensaio,
      '-'
    );

    const status = limparTexto(
      statusExibido(
        linha?.status
      ),
      '-'
    );

    const chave = [
      amostra,
      ensaio,
      status,
    ]
      .map(
        item =>
          item.toLowerCase()
      )
      .join('|');

    if (vistos.has(chave)) {
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

function statusDaOSParaWhatsApp(itens) {
  const vistos = new Set();
  const status = [];

  for (
    const item
    of Array.isArray(itens)
      ? itens
      : []
  ) {
    const valor = limparTexto(
      item?.status
    );

    if (!valor) {
      continue;
    }

    const chave = valor
      .normalize('NFKC')
      .toLocaleLowerCase('pt-BR');

    if (vistos.has(chave)) {
      continue;
    }

    vistos.add(chave);
    status.push(valor);
  }

  const prioridade = new Map([
    ['amostra recebida', 0],
    ['relatório pronto', 1],
    ['relatorio pronto', 1],
  ]);

  status.sort((a, b) => {
    const chaveA = a
      .normalize('NFKC')
      .toLocaleLowerCase('pt-BR');

    const chaveB = b
      .normalize('NFKC')
      .toLocaleLowerCase('pt-BR');

    const prioridadeA =
      prioridade.get(chaveA) ?? 100;

    const prioridadeB =
      prioridade.get(chaveB) ?? 100;

    if (prioridadeA !== prioridadeB) {
      return prioridadeA - prioridadeB;
    }

    return a.localeCompare(
      b,
      'pt-BR',
      {
        sensitivity: 'base',
      }
    );
  });

  if (status.length === 0) {
    return '-';
  }

  if (status.length === 1) {
    return status[0];
  }

  if (status.length === 2) {
    return `${status[0]} e ${status[1]}`;
  }

  return (
    `${status.slice(0, -1).join(', ')} e ` +
    `${status[status.length - 1]}`
  );
}

function templateUsaDetalhes() {
  return analisarMapeamentoCorpo()
    .some(
      item =>
        item.source === 'detalhes'
    );
}
function detalhesEmBlocos(itens) {
  return itens
    .map(
      (item, indice) =>
        [
          `${MARCADOR_ITEM} *${indice + 1}) Amostra:* ${item.amostra}`,
          `*Ensaio:* ${item.ensaioCurto}`,
          `*Status:* ${item.status}`,
        ].join(' • ')
    )
    .join(
      SEPARADOR_VISUAL_ITENS
    );
}

function validarEstruturaDetalhesEmBlocos(
  valor,
  quantidadeItens
) {
  const detalhes =
    String(valor ?? '');

  if (
    parametroMetaPossuiCaracterProibido(
      detalhes
    )
  ) {
    throw new Error(
      'Os detalhes em blocos contêm quebra de linha ou tabulação.'
    );
  }

  if (
    parametroMetaPossuiEspacosExcessivos(
      detalhes
    )
  ) {
    throw new Error(
      'Os detalhes em blocos contêm espaços excessivos.'
    );
  }

  for (
    let indice = 1;
    indice <= quantidadeItens;
    indice += 1
  ) {
    const marcador =
      `${MARCADOR_ITEM} *${indice}) Amostra:*`;

    if (!detalhes.includes(marcador)) {
      throw new Error(
        `O marcador do item ${indice} está ausente.`
      );
    }
  }

  return true;
}

function compactarPrefixoComum(valores) {
  const lista = [...valores].map(
    valor =>
      limparTexto(
        valor,
        '-'
      )
  );

  if (lista.length < 2) {
    return lista.join('; ');
  }

  let prefixo = lista[0];

  for (const valor of lista.slice(1)) {
    while (
      prefixo &&
      !valor.startsWith(prefixo)
    ) {
      prefixo =
        prefixo.slice(0, -1);
    }
  }

  const ultimoEspaco =
    prefixo.lastIndexOf(' ');

  if (ultimoEspaco < 3) {
    return lista.join('; ');
  }

  prefixo = prefixo.slice(
    0,
    ultimoEspaco + 1
  );

  const rotulo =
    prefixo.trim();

  const sufixos = lista.map(
    valor =>
      valor
        .slice(prefixo.length)
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

function detalhesCompactos(itens) {
  const porAmostra = new Map();
  const porEnsaio = new Map();

  for (const item of itens) {
    const ensaioCurto = limparTexto(
      item.ensaioCurto ||
        item.ensaioSigla ||
        item.ensaioNome ||
        item.ensaio,
      '-'
    );

    const chaveAmostra = [
      item.amostra,
      item.status,
    ].join('\u0000');

    const chaveEnsaio = [
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
          amostra: item.amostra,
          status: item.status,
          ensaios: new Set(),
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
          ensaio: ensaioCurto,
          status: item.status,
          amostras: new Set(),
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
      .join(
        SEPARADOR_VISUAL_ITENS
      );

  const secoesPorStatus =
    new Map();

  for (const grupo of porEnsaio.values()) {
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
          `Status: ${status} • ` +
          `${linhas.join(' • ')}`
      )
      .join(
        SEPARADOR_VISUAL_ITENS
      );

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

  if (formato === 'blocos') {
    return blocos;
  }

  if (formato === 'compacto') {
    return compacto;
  }

  return (
    blocos.cabeNoLimiteDetalhes &&
    blocos.cabeNoLimiteCorpo
  )
    ? blocos
    : compacto;
}

function ordemServicoDaParte(
  ordemServico,
  parteAtual,
  totalPartes
) {
  const base = limparTexto(
    ordemServico,
    '-'
  );

  if (
    !Number.isInteger(totalPartes) ||
    totalPartes <= 1
  ) {
    return base;
  }

  return (
    `${base} ` +
    `(parte ${parteAtual}/${totalPartes})`
  );
}

function detalhesCabem(resultado) {
  return Boolean(
    resultado?.cabeNoLimiteDetalhes &&
    resultado?.cabeNoLimiteCorpo
  );
}

function maximoDetalhesParaOrdem(
  ordemServico
) {
  const disponivelNoCorpo =
    limiteEfetivoCorpo() -
    CONFIG.templateBodyFixedChars -
    contarCaracteres(
      normalizarParametroMeta(
        ordemServico
      )
    );

  return Math.max(
    1,
    Math.min(
      CONFIG.detailsMaxChars,
      disponivelNoCorpo
    )
  );
}

function quebrarTextoSeguro(
  valor,
  limite
) {
  const texto =
    normalizarParametroMeta(
      valor
    );

  const maximo = Math.max(
    1,
    Number.parseInt(
      String(limite || 1),
      10
    ) || 1
  );

  if (
    contarCaracteres(texto) <=
    maximo
  ) {
    return [texto];
  }

  const partes = [];
  let restante = texto;

  while (
    contarCaracteres(restante) >
    maximo
  ) {
    const caracteres =
      Array.from(restante);

    const janela = caracteres
      .slice(0, maximo + 1)
      .join('');

    let corte = -1;

    // Prioriza separadores sem quebrar palavras/identificadores.
    for (const separador of [
      ' • ',
      '; ',
      ', ',
      ' ',
    ]) {
      const indice =
        janela.lastIndexOf(
          separador,
          maximo
        );

      if (
        indice >= Math.floor(
          maximo * 0.55
        )
      ) {
        corte =
          indice +
          separador.length;
        break;
      }
    }

    if (corte <= 0) {
      corte = maximo;
    }

    const parte =
      Array.from(restante)
        .slice(0, corte)
        .join('')
        .trim();

    if (!parte) {
      break;
    }

    partes.push(parte);

    restante =
      Array.from(restante)
        .slice(corte)
        .join('')
        .trim();
  }

  if (restante) {
    partes.push(restante);
  }

  return partes.filter(Boolean);
}

function montarVariaveisDaOS(
  cliente,
  ordem,
  opcoes = {}
) {
  const itens =
    Array.isArray(opcoes.itens)
      ? opcoes.itens
      : itensDaOS(
          ordem
        );

  if (itens.length === 0) {
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

  const ordemServicoBase =
    limparTexto(
      ordem?.osNome ||
        ordem?.osId,
      '-'
    );

  const ordemServico =
    limparTexto(
      opcoes.ordemServico ||
        ordemServicoBase,
      '-'
    );

  const usaDetalhesNoTemplate =
    templateUsaDetalhes();

  const statusOrdem =
    statusDaOSParaWhatsApp(
      itens
    );

  const detalhesResultado =
    usaDetalhesNoTemplate
      ? (
          opcoes.detalhesResultado ||
          escolherDetalhes(
            itens,
            ordemServico
          )
        )
      : {
          formatoUsado:
            'nao-utilizado',
          texto:
            '-',
          tamanhoDetalhes:
            0,
          tamanhoCorpoEstimado:
            0,
          limiteCorpo:
            CONFIG.templateBodyMaxChars,
        };

  if (
    usaDetalhesNoTemplate &&
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
    usaDetalhesNoTemplate &&
    !detalhesCabem(
      detalhesResultado
    )
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

  const emailsCliente =
    Array.isArray(cliente?.emails)
      ? cliente.emails
      : [];

  const emailAcesso =
    limparTexto(
      cliente?.emailPrincipal ||
        emailsCliente[0] ||
        cliente?.email,
      '-'
    );

  const quantidadeItensTotal =
    Number.isInteger(
      opcoes.quantidadeItensTotal
    )
      ? opcoes.quantidadeItensTotal
      : itens.length;

  const parteAtual =
    Number.isInteger(
      opcoes.parteAtual
    )
      ? opcoes.parteAtual
      : 1;

  const totalPartes =
    Number.isInteger(
      opcoes.totalPartes
    )
      ? opcoes.totalPartes
      : 1;

  const contexto =
    Object.freeze({
      ordem_servico:
        ordemServico,

      order_service:
        ordemServico,

      order_status:
        statusOrdem,

      os:
        ordemServico,

      os_original:
        ordemServicoBase,

      os_id:
        limparTexto(
          ordem?.osId
        ),

      detalhes:
        detalhesResultado.texto,

      itens_compactos:
        normalizarParametroMeta(
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
          .join(
            SEPARADOR_VISUAL_ITENS
          ),

      ensaios:
        itens
          .map(
            item =>
              item.ensaio
          )
          .join(
            SEPARADOR_VISUAL_ITENS
          ),

      status:
        itens
          .map(
            item =>
              item.status
          )
          .join(
            SEPARADOR_VISUAL_ITENS
          ),

      cliente:
        clienteNome,

      cliente_nome:
        clienteNome,

      cliente_id:
        limparTexto(
          cliente?.clienteId
        ),

      cnpj:
        limparTexto(
          cliente?.cnpj,
          '-'
        ),

      senha_inicial:
        emailAcesso,

      email_acesso:
        emailAcesso,

      quantidade_itens:
        String(
          itens.length
        ),

      quantidade_itens_total:
        String(
          quantidadeItensTotal
        ),

      parte_atual:
        String(parteAtual),

      total_partes:
        String(totalPartes),

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

    quantidadeItensTotal,

    parteAtual,

    totalPartes,

    ordemServico,

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

function montarVariaveisDaOSPartes(
  cliente,
  ordem
) {
  const itens =
    itensDaOS(
      ordem
    );

  if (itens.length === 0) {
    return {
      ok: false,
      motivo: 'os-sem-itens-validos',
      clienteId:
        cliente?.clienteId || '',
      osId:
        ordem?.osId || '',
    };
  }

  const ordemServicoBase =
    limparTexto(
      ordem?.osNome ||
        ordem?.osId,
      '-'
    );

  // O V3 usa apenas order_service + order_status. Como não transporta
  // a lista de ensaios no parâmetro dinâmico, uma OS gera exatamente
  // uma mensagem por destino, independentemente da quantidade de linhas.
  if (!templateUsaDetalhes()) {
    const variaveis =
      montarVariaveisDaOS(
        cliente,
        ordem,
        {
          itens,
          ordemServico:
            ordemServicoBase,
          parteAtual: 1,
          totalPartes: 1,
          quantidadeItensTotal:
            itens.length,
        }
      );

    return {
      ok: variaveis.ok,
      motivo:
        variaveis.motivo || '',
      partes:
        variaveis.ok
          ? [variaveis]
          : [],
      quantidadePartes:
        variaveis.ok ? 1 : 0,
      quantidadeItens:
        itens.length,
      ordemServico:
        ordemServicoBase,
    };
  }

  const completo =
    escolherDetalhes(
      itens,
      ordemServicoBase
    );

  if (detalhesCabem(completo)) {
    const variaveis =
      montarVariaveisDaOS(
        cliente,
        ordem,
        {
          itens,
          ordemServico:
            ordemServicoBase,
          detalhesResultado:
            completo,
          parteAtual: 1,
          totalPartes: 1,
          quantidadeItensTotal:
            itens.length,
        }
      );

    return {
      ok: variaveis.ok,
      motivo: variaveis.motivo || '',
      partes:
        variaveis.ok
          ? [variaveis]
          : [],
      quantidadePartes:
        variaveis.ok ? 1 : 0,
      quantidadeItens:
        itens.length,
    };
  }

  // Usa um sufixo conservador para reservar espaço para "parte X/Y"
  // antes de sabermos quantas partes existirão de fato.
  const ordemParaCalculo =
    ordemServicoDaParte(
      ordemServicoBase,
      9999,
      9999
    );

  const grupos = [];
  let atual = [];

  const adicionarItemIsolado = item => {
    const teste =
      escolherDetalhes(
        [item],
        ordemParaCalculo
      );

    if (detalhesCabem(teste)) {
      atual = [item];
      return;
    }

    // Caso extremo: um único item excede o parâmetro. Em vez de
    // descartar a OS, divide o texto desse item sem perder conteúdo.
    const textoItem =
      normalizarParametroMeta(
        detalhesEmBlocos(
          [item]
        )
      );

    const limiteFragmento =
      maximoDetalhesParaOrdem(
        ordemParaCalculo
      );

    const fragmentos =
      quebrarTextoSeguro(
        textoItem,
        limiteFragmento
      );

    for (const fragmento of fragmentos) {
      grupos.push({
        itens: [item],
        textoForcado:
          fragmento,
        formatoForcado:
          'fragmento',
      });
    }
  };

  for (const item of itens) {
    const candidato = [
      ...atual,
      item,
    ];

    const teste =
      escolherDetalhes(
        candidato,
        ordemParaCalculo
      );

    if (detalhesCabem(teste)) {
      atual = candidato;
      continue;
    }

    if (atual.length > 0) {
      grupos.push({
        itens: atual,
      });
      atual = [];
    }

    adicionarItemIsolado(item);
  }

  if (atual.length > 0) {
    grupos.push({
      itens: atual,
    });
  }

  const totalPartes =
    grupos.length;

  const partes = [];

  for (
    let indice = 0;
    indice < grupos.length;
    indice += 1
  ) {
    const grupo =
      grupos[indice];

    const parteAtual =
      indice + 1;

    const ordemServico =
      ordemServicoDaParte(
        ordemServicoBase,
        parteAtual,
        totalPartes
      );

    const detalhesResultado =
      grupo.textoForcado
        ? candidatoDetalhes({
            formato:
              grupo.formatoForcado ||
              'fragmento',
            texto:
              grupo.textoForcado,
            ordemServico,
          })
        : escolherDetalhes(
            grupo.itens,
            ordemServico
          );

    if (!detalhesCabem(detalhesResultado)) {
      return {
        ok: false,
        motivo:
          'detalhes-excedem-limite-apos-divisao',
        mensagem:
          `A parte ${parteAtual}/${totalPartes} ainda excede o limite do template.`,
        quantidadeItens:
          itens.length,
        quantidadePartes:
          totalPartes,
        clienteId:
          cliente?.clienteId || '',
        osId:
          ordem?.osId || '',
      };
    }

    const variaveis =
      montarVariaveisDaOS(
        cliente,
        ordem,
        {
          itens:
            grupo.itens,
          ordemServico,
          detalhesResultado,
          parteAtual,
          totalPartes,
          quantidadeItensTotal:
            itens.length,
        }
      );

    if (!variaveis.ok) {
      return variaveis;
    }

    partes.push(
      variaveis
    );
  }

  return {
    ok: true,
    motivo: '',
    partes,
    quantidadePartes:
      partes.length,
    quantidadeItens:
      itens.length,
    ordemServico:
      ordemServicoBase,
  };
}

function resolverValor(
  origem,
  contexto
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

    const valor =
      normalizarParametroMeta(
        literal
      );

    if (!valor) {
      throw new Error(
        'O valor literal do parâmetro está vazio.'
      );
    }

    return valor;
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
    normalizarParametroMeta(
      contexto[referencia]
    );

  if (!valor) {
    throw new Error(
      `A origem "${referencia}" está vazia.`
    );
  }

  return valor;
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

  if (itens.length === 0) {
    throw new Error(
      'WHATSAPP_TEMPLATE_BODY_PARAMETERS não possui parâmetros.'
    );
  }

  return itens.map(
    item => {
      const separador =
        item.indexOf('=');

      if (separador === -1) {
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
        const texto =
          resolverValor(
            mapeamento.source,
            contexto
          );

        validarTextoParametroMeta(
          texto,
          `Parâmetro "${mapeamento.parameterName}"`
        );

        const parametro = {
          type:
            'text',

          text:
            texto,
        };

        if (modo === 'named') {
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

  if (tipo === 'none') {
    return null;
  }

  if (tipo === 'text') {
    if (!CONFIG.headerTextSource) {
      throw new Error(
        'Defina WHATSAPP_TEMPLATE_HEADER_TEXT_SOURCE para o cabeçalho de texto.'
      );
    }

    const texto =
      resolverValor(
        CONFIG.headerTextSource,
        contexto
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

  if (CONFIG.headerMediaId) {
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
  if (!CONFIG.buttons) {
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

        if (!correspondencia) {
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
          resolverValor(
            origem,
            contexto
          );

        validarTextoParametroMeta(
          valor,
          `Parâmetro do botão ${indice}`
        );

        const parametro =
          subtipo === 'quick_reply'
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

function validarConfiguracaoTemplateBasica() {
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

  return {
    ok: true,
    templateName,
    templateLanguage,
  };
}

function montarPayloadComVariaveis({
  cliente,
  ordem,
  telefone,
  variaveis,
  templateName,
  templateLanguage,
}) {
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
      telefone,

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
    ok: true,
    payload,

    contexto:
      variaveis.contexto,

    itens:
      variaveis.itens,

    quantidadeItens:
      variaveis.quantidadeItens,

    quantidadeItensTotal:
      variaveis.quantidadeItensTotal ||
      variaveis.quantidadeItens,

    parteAtual:
      variaveis.parteAtual || 1,

    totalPartes:
      variaveis.totalPartes || 1,

    ordemServico:
      variaveis.ordemServico ||
      ordem?.osNome ||
      ordem?.osId ||
      '',

    formatoDetalhes:
      variaveis.formatoDetalhes,

    tamanhoDetalhes:
      variaveis.tamanhoDetalhes,

    tamanhoCorpoEstimado:
      variaveis.tamanhoCorpoEstimado,

    limiteCorpo:
      variaveis.limiteCorpo,

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

function montarPayloadsTemplateWhatsApp({
  cliente,
  ordem,
  telefone,
}) {
  const configuracao =
    validarConfiguracaoTemplateBasica();

  if (!configuracao.ok) {
    return configuracao;
  }

  const telefoneFinal =
    limparTexto(
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

  try {
    const variaveisPartes =
      montarVariaveisDaOSPartes(
        cliente,
        ordem
      );

    if (!variaveisPartes.ok) {
      return variaveisPartes;
    }

    const partes =
      variaveisPartes.partes.map(
        variaveis =>
          montarPayloadComVariaveis({
            cliente,
            ordem,
            telefone:
              telefoneFinal,
            variaveis,
            templateName:
              configuracao.templateName,
            templateLanguage:
              configuracao.templateLanguage,
          })
      );

    return {
      ok: true,
      multipart:
        partes.length > 1,
      partes,
      quantidadePartes:
        partes.length,
      quantidadeItens:
        variaveisPartes.quantidadeItens,
      telefone:
        telefoneFinal,
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
        erro?.message ||
        String(erro),
      clienteId:
        cliente?.clienteId || '',
      osId:
        ordem?.osId || '',
    };
  }
}

function montarPayloadTemplateWhatsApp({
  cliente,
  ordem,
  telefone,
}) {
  const multipart =
    montarPayloadsTemplateWhatsApp({
      cliente,
      ordem,
      telefone,
    });

  if (!multipart.ok) {
    return multipart;
  }

  const primeira =
    multipart.partes[0];

  // Compatibilidade com integrações que historicamente esperam um
  // único payload. Para OS grande, o chamador moderno deve usar
  // montarPayloadsTemplateWhatsApp/prepararEnvioWhatsAppDaOS.
  return {
    ...primeira,
    multipart:
      multipart.multipart,
    quantidadePartes:
      multipart.quantidadePartes,
    partes:
      multipart.partes,
  };
}

module.exports = {
  montarPayloadTemplateWhatsApp,
  montarPayloadsTemplateWhatsApp,
  montarVariaveisDaOS,
  montarVariaveisDaOSPartes,

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
  limiteEfetivoCorpo,
  maximoDetalhesParaOrdem,
  quebrarTextoSeguro,
  ordemServicoDaParte,

  MARCADOR_ITEM,
  SEPARADOR_VISUAL_ITENS,

  CONFIG,
};
