'use strict';

// ============================================================
// airtable.js — LEITURA, SEGURANÇA, FILTRO E AGRUPAMENTO
// ============================================================
//
// Objetivos deste módulo:
//
// 1. Consultar o Airtable com paginação, timeout e retentativas.
// 2. Impedir qualquer envio retroativo anterior ao marco oficial.
// 3. Permitir acesso ao histórico somente em auditoria explícita.
// 4. Consolidar contatos do cliente usando todos os registros.
// 5. Detectar telefones inválidos, múltiplos, bloqueados ou
//    compartilhados entre clientes diferentes.
// 6. Preservar compatibilidade com os fluxos atuais de e-mail e
//    WhatsApp.
// 7. Expor diagnóstico estruturado para futuras auditorias sem
//    exigir alterações neste arquivo.
//
// Regra operacional definitiva:
//
// ignorarData=true NÃO ignora AUTOMACAO_INICIO_EM.
// O histórico só pode ultrapassar o corte quando a chamada usa:
//
// modoAuditoria=true
// ignorarCorteAutomacao=true
//
// ============================================================

require('dotenv').config({
  quiet: true,
});

// ============================================================
// FUNÇÕES DE CONFIGURAÇÃO
// ============================================================

function campoEnv(nome, padrao = '') {
  const valor = process.env[nome];

  if (
    valor === undefined ||
    valor === null ||
    valor === ''
  ) {
    return padrao;
  }

  return String(valor).trim();
}

/**
 * Preserva espaços reais no começo ou no final do valor.
 *
 * Isso é necessário para nomes de campos do Airtable que podem
 * conter espaço final, como "Nome_Completo_Ensaios ".
 */
function campoEnvExato(nome, padrao = '') {
  if (
    Object.prototype.hasOwnProperty.call(
      process.env,
      nome
    )
  ) {
    return String(process.env[nome]);
  }

  return padrao;
}

function booleanoEnv(nome, padrao = false) {
  const valor = campoEnv(nome, '');

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

  return (
    Number.isInteger(numero) &&
    numero > 0
  )
    ? numero
    : padrao;
}

function limitarNumero(
  valor,
  minimo,
  maximo,
  padrao
) {
  const numero = numeroInteiroPositivo(
    valor,
    padrao
  );

  return Math.min(
    maximo,
    Math.max(minimo, numero)
  );
}

// ============================================================
// CONFIGURAÇÕES GERAIS
// ============================================================

const TIMEZONE = campoEnv(
  'APP_TIMEZONE',
  'America/Sao_Paulo'
);

const AUTOMACAO_INICIO_EM = campoEnv(
  'AUTOMACAO_INICIO_EM',
  ''
);

const AIRTABLE_TOKEN = campoEnv(
  'AIRTABLE_TOKEN',
  ''
);

const AIRTABLE_BASE_ID = campoEnv(
  'AIRTABLE_BASE_ID',
  ''
);

const AIRTABLE_TABLE_ID = campoEnv(
  'AIRTABLE_TABLE_ID',
  'tblJAP4Av9sWm8SmL'
);

const AIRTABLE_VIEW_ID = campoEnv(
  'AIRTABLE_VIEW_ID',
  ''
);

// Fórmula opcional para restringir a consulta diretamente no
// Airtable sem mudar o código futuramente.
//
// Exemplo de uso no .env:
// AIRTABLE_FILTER_FORMULA=NOT({Arquivado})
const AIRTABLE_FILTER_FORMULA =
  campoEnvExato(
    'AIRTABLE_FILTER_FORMULA',
    ''
  );

const AIRTABLE_TIMEOUT_MS =
  numeroInteiroPositivo(
    process.env.AIRTABLE_TIMEOUT_MS,
    20000
  );

const AIRTABLE_MAX_TENTATIVAS =
  numeroInteiroPositivo(
    process.env.AIRTABLE_MAX_TENTATIVAS,
    3
  );

const AIRTABLE_PAGE_SIZE = limitarNumero(
  process.env.AIRTABLE_PAGE_SIZE,
  1,
  100,
  100
);

const AIRTABLE_MAX_PAGINAS =
  numeroInteiroPositivo(
    process.env.AIRTABLE_MAX_PAGINAS,
    1000
  );

const CODIGO_PAIS_PADRAO = campoEnv(
  'AIRTABLE_WHATSAPP_COUNTRY_CODE',
  campoEnv(
    'WHATSAPP_COUNTRY_CODE',
    '55'
  )
).replace(/\D/g, '');

// Usa todos os registros da tabela para consolidar contatos do
// cliente. Isso evita perder telefone/e-mail quando o registro
// alterado ontem estiver com o lookup temporariamente vazio.
const CONTATOS_USAR_TODOS_REGISTROS =
  booleanoEnv(
    'AIRTABLE_CONTATOS_USAR_TODOS_REGISTROS',
    true
  );

// Quando o mesmo telefone aparece em clientes diferentes, o
// WhatsApp fica bloqueado automaticamente.
const BLOQUEAR_WHATSAPP_COMPARTILHADO =
  booleanoEnv(
    'AIRTABLE_BLOQUEAR_WHATSAPP_COMPARTILHADO',
    true
  );

const LOG_DADOS_INVALIDOS = booleanoEnv(
  'AIRTABLE_LOG_DADOS_INVALIDOS',
  true
);

const LOG_REGISTROS_IGNORADOS =
  booleanoEnv(
    'AIRTABLE_LOG_REGISTROS_IGNORADOS',
    true
  );

// ============================================================
// STATUS PERMITIDOS
// ============================================================

const STATUS_PADRAO = [
  'Aguardando Preparação',
  'Enviado ao Cliente',
];

const STATUS_PERMITIDOS = (() => {
  const configurados = String(
    process.env
      .AIRTABLE_STATUS_PERMITIDOS || ''
  )
    .split('|')
    .map(item => item.trim())
    .filter(Boolean);

  return configurados.length > 0
    ? configurados
    : STATUS_PADRAO;
})();

function normalizarChave(valor) {
  return String(valor ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

const STATUS_PERMITIDOS_MAP = new Map(
  STATUS_PERMITIDOS.map(status => [
    normalizarChave(status),
    status,
  ])
);

// ============================================================
// NOMES DOS CAMPOS DO AIRTABLE
// ============================================================

const CAMPOS = Object.freeze({
  clienteLink: campoEnv(
    'AIRTABLE_CAMPO_CLIENTE_LINK',
    'Cliente'
  ),

  osLink: campoEnv(
    'AIRTABLE_CAMPO_OS_LINK',
    'Ordem de Serviço'
  ),

  clienteTexto: campoEnv(
    'AIRTABLE_CAMPO_CLIENTE_TEXTO',
    'Cliente Texto'
  ),

  osTexto: campoEnv(
    'AIRTABLE_CAMPO_OS_TEXTO',
    'OS Texto'
  ),

  emailCliente: campoEnv(
    'AIRTABLE_CAMPO_EMAIL_CLIENTE',
    'Email do Cliente'
  ),

  cnpjCliente: campoEnv(
    'AIRTABLE_CAMPO_CNPJ_CLIENTE',
    'CNPJ do Cliente'
  ),

  whatsappCliente: campoEnv(
    'AIRTABLE_CAMPO_WHATSAPP_CLIENTE',
    'WhatsApp do Cliente'
  ),

  idTrabalho: campoEnv(
    'AIRTABLE_CAMPO_ID_TRABALHO',
    'ID Trabalho'
  ),

  nomeTrabalho: campoEnv(
    'AIRTABLE_CAMPO_NOME_TRABALHO',
    'Nome Trabalho'
  ),

  amostra: campoEnv(
    'AIRTABLE_CAMPO_AMOSTRA',
    'Link Amostras'
  ),

  ensaioSigla: campoEnv(
    'AIRTABLE_CAMPO_ENSAIO_SIGLA',
    'Link Ensaios'
  ),

  // Existe um espaço real depois de "Ensaios" no campo
  // atualmente utilizado.
  ensaioNome: campoEnvExato(
    'AIRTABLE_CAMPO_ENSAIO_NOME',
    'Nome_Completo_Ensaios '
  ),

  statusCliente: campoEnv(
    'AIRTABLE_CAMPO_STATUS_CLIENTE',
    'Status Cliente'
  ),

  status: campoEnv(
    'AIRTABLE_CAMPO_STATUS',
    'Status'
  ),

  dataConclusao: campoEnv(
    'AIRTABLE_CAMPO_DATA_CONCLUSAO',
    'Data de Conclusão do Ensaio'
  ),

  dataEnvioRelatorio: campoEnv(
    'AIRTABLE_CAMPO_DATA_ENVIO_RELATORIO',
    'Data de Envio do Relatório'
  ),

  dataAtualizacao: campoEnv(
    'AIRTABLE_CAMPO_DATA_ATUALIZACAO',
    'Data da Última Atualização Update'
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

function texto(valor) {
  if (
    valor === undefined ||
    valor === null
  ) {
    return '';
  }

  if (Array.isArray(valor)) {
    return valor
      .flat(Infinity)
      .map(item =>
        String(item ?? '').trim()
      )
      .filter(Boolean)
      .join(', ');
  }

  return String(valor).trim();
}

function primeiroId(valor) {
  if (Array.isArray(valor)) {
    const encontrado = valor
      .flat(Infinity)
      .map(item =>
        String(item ?? '').trim()
      )
      .find(Boolean);

    return encontrado || null;
  }

  const normalizado = String(
    valor ?? ''
  ).trim();

  return normalizado || null;
}

function listaSeparada(valor) {
  if (
    valor === undefined ||
    valor === null ||
    valor === ''
  ) {
    return [];
  }

  const itens = Array.isArray(valor)
    ? valor.flat(Infinity)
    : [valor];

  return itens
    .flatMap(item =>
      String(item ?? '')
        .split(/[;,|\n]+/)
    )
    .map(item => item.trim())
    .filter(Boolean);
}

function lerCampo(
  campos,
  nomePrincipal,
  alternativas = []
) {
  if (
    Object.prototype.hasOwnProperty.call(
      campos,
      nomePrincipal
    )
  ) {
    return campos[nomePrincipal];
  }

  for (const alternativa of alternativas) {
    if (
      Object.prototype.hasOwnProperty.call(
        campos,
        alternativa
      )
    ) {
      return campos[alternativa];
    }
  }

  return undefined;
}

function mascararTelefone(valor) {
  const digitos = String(valor ?? '')
    .replace(/\D/g, '');

  if (!digitos) {
    return '(não informado)';
  }

  if (digitos.length <= 8) {
    return '*'.repeat(digitos.length);
  }

  return (
    digitos.slice(0, 4) +
    '*'.repeat(
      Math.max(digitos.length - 8, 5)
    ) +
    digitos.slice(-4)
  );
}

function ordenarTextos(valores) {
  return [...valores].sort(
    (a, b) =>
      String(a).localeCompare(
        String(b),
        'pt-BR',
        {
          sensitivity: 'base',
          numeric: true,
        }
      )
  );
}

// ============================================================
// TRATAMENTO DE E-MAILS
// ============================================================

function separarEmailsDetalhado(valor) {
  const formatoBasico =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const vistos = new Set();
  const validos = [];
  const invalidos = [];

  for (
    const item of listaSeparada(valor)
  ) {
    const chave = item.toLowerCase();

    if (!formatoBasico.test(item)) {
      invalidos.push(item);
      continue;
    }

    if (vistos.has(chave)) {
      continue;
    }

    vistos.add(chave);
    validos.push(item);
  }

  return {
    validos,
    invalidos,
  };
}

function separarEmails(
  valor,
  contexto = ''
) {
  const resultado =
    separarEmailsDetalhado(valor);

  if (
    LOG_DADOS_INVALIDOS &&
    resultado.invalidos.length > 0
  ) {
    console.warn(
      `[Airtable/e-mail] ` +
      `${contexto ? `(${contexto}) ` : ''}` +
      `valor(es) inválido(s) ignorado(s): ` +
      `${resultado.invalidos.join(' | ')}`
    );
  }

  return resultado.validos;
}

// ============================================================
// TRATAMENTO DE TELEFONES
// ============================================================

function normalizarTelefoneContato(
  valor,
  codigoPaisPadrao =
    CODIGO_PAIS_PADRAO
) {
  const original = String(
    valor ?? ''
  ).trim();

  if (!original) {
    return {
      ok: false,
      motivo: 'telefone-vazio',
      original,
      numero: '',
    };
  }

  let numero = original.replace(
    /\D/g,
    ''
  );

  if (numero.startsWith('00')) {
    numero = numero.slice(2);
  }

  // DDD + telefone brasileiro.
  if (
    codigoPaisPadrao &&
    (
      numero.length === 10 ||
      numero.length === 11
    )
  ) {
    numero =
      `${codigoPaisPadrao}${numero}`;
  }

  if (!/^[1-9]\d{7,14}$/.test(numero)) {
    return {
      ok: false,
      motivo: 'telefone-invalido',
      original,
      numero,
    };
  }

  return {
    ok: true,
    motivo: '',
    original,
    numero,
  };
}

function separarTelefonesDetalhado(valor) {
  const validos = new Map();
  const invalidos = [];

  for (
    const item of listaSeparada(valor)
  ) {
    const resultado =
      normalizarTelefoneContato(item);

    if (!resultado.ok) {
      invalidos.push({
        original: resultado.original,
        motivo: resultado.motivo,
      });
      continue;
    }

    if (!validos.has(resultado.numero)) {
      validos.set(
        resultado.numero,
        resultado.original
      );
    }
  }

  return {
    validos,
    invalidos,
  };
}

/**
 * Compatibilidade com chamadas antigas.
 *
 * Retorna somente os telefones válidos, um por número
 * normalizado, preservando a primeira forma textual encontrada.
 */
function separarTelefones(valor) {
  return [
    ...separarTelefonesDetalhado(valor)
      .validos.values(),
  ];
}

function criarConjuntoNumerosBloqueados() {
  const resultado = new Set();

  for (
    const item of listaSeparada(
      process.env
        .WHATSAPP_NUMEROS_BLOQUEADOS || ''
    )
  ) {
    const normalizado =
      normalizarTelefoneContato(item);

    if (normalizado.ok) {
      resultado.add(
        normalizado.numero
      );
    }
  }

  return resultado;
}

const NUMEROS_BLOQUEADOS =
  criarConjuntoNumerosBloqueados();

// ============================================================
// TRATAMENTO DE DATAS
// ============================================================

function validarTimezone() {
  try {
    new Intl.DateTimeFormat(
      'pt-BR',
      {
        timeZone: TIMEZONE,
      }
    ).format(new Date());

    return {
      ok: true,
      mensagem: '',
    };
  } catch {
    return {
      ok: false,
      mensagem:
        `APP_TIMEZONE inválido: "${TIMEZONE}".`,
    };
  }
}

function dataCalendarioNoFuso(data) {
  const formatador =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }
    );

  const partes = Object.fromEntries(
    formatador
      .formatToParts(data)
      .filter(
        parte =>
          parte.type !== 'literal'
      )
      .map(parte => [
        parte.type,
        parte.value,
      ])
  );

  return (
    `${partes.year}-` +
    `${partes.month}-` +
    `${partes.day}`
  );
}

function subtrairDiasCalendario(
  dataYmd,
  quantidade
) {
  const correspondencia =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      dataYmd
    );

  if (!correspondencia) {
    return '';
  }

  const [, ano, mes, dia] =
    correspondencia;

  const dataUtc = new Date(
    Date.UTC(
      Number(ano),
      Number(mes) - 1,
      Number(dia)
    )
  );

  dataUtc.setUTCDate(
    dataUtc.getUTCDate() - quantidade
  );

  return dataUtc
    .toISOString()
    .slice(0, 10);
}

function valorBrutoData(valor) {
  if (valor instanceof Date) {
    return valor.toISOString();
  }

  return Array.isArray(valor)
    ? String(valor[0] ?? '').trim()
    : String(valor ?? '').trim();
}

function dataCalendarioDoValor(valor) {
  const bruto = valorBrutoData(valor);

  if (!bruto) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) {
    return bruto;
  }

  const data = new Date(bruto);

  if (Number.isNaN(data.getTime())) {
    return '';
  }

  return dataCalendarioNoFuso(data);
}

function ehDeOntem(
  valorData,
  agora = new Date()
) {
  const hoje =
    dataCalendarioNoFuso(agora);

  const ontem =
    subtrairDiasCalendario(
      hoje,
      1
    );

  const dataRegistro =
    dataCalendarioDoValor(
      valorData
    );

  return Boolean(
    dataRegistro &&
    dataRegistro === ontem
  );
}

/**
 * Converte uma data/hora em instante absoluto.
 *
 * Para o corte operacional, valores apenas com YYYY-MM-DD ou
 * data/hora sem fuso explícito são recusados. Essa regra evita
 * interpretações diferentes entre Windows, Node e Render.
 */
function instanteDoValor(valor) {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime())
      ? null
      : new Date(valor.getTime());
  }

  const bruto = valorBrutoData(valor);

  if (
    !bruto ||
    /^\d{4}-\d{2}-\d{2}$/.test(bruto)
  ) {
    return null;
  }

  const possuiFusoExplicito =
    /(Z|[+-]\d{2}:?\d{2})$/i.test(
      bruto
    );

  if (!possuiFusoExplicito) {
    return null;
  }

  const data = new Date(bruto);

  if (Number.isNaN(data.getTime())) {
    return null;
  }

  return data;
}

function validarInicioAutomacaoConfigurado(
  valor = AUTOMACAO_INICIO_EM
) {
  const bruto = String(
    valor ?? ''
  ).trim();

  if (!bruto) {
    return {
      ok: false,
      motivo: 'inicio-automacao-ausente',
      mensagem:
        'AUTOMACAO_INICIO_EM não está configurada.',
      bruto: '',
      data: null,
    };
  }

  const possuiFusoExplicito =
    /(Z|[+-]\d{2}:?\d{2})$/i.test(
      bruto
    );

  if (!possuiFusoExplicito) {
    return {
      ok: false,
      motivo: 'inicio-automacao-sem-fuso',
      mensagem:
        'AUTOMACAO_INICIO_EM deve incluir um fuso ' +
        'explícito, como -03:00 ou Z.',
      bruto,
      data: null,
    };
  }

  const data = new Date(bruto);

  if (Number.isNaN(data.getTime())) {
    return {
      ok: false,
      motivo: 'inicio-automacao-invalido',
      mensagem:
        'AUTOMACAO_INICIO_EM possui uma data/hora inválida.',
      bruto,
      data: null,
    };
  }

  return {
    ok: true,
    motivo: '',
    mensagem: '',
    bruto,
    data,
  };
}

function validarConfiguracaoOperacional(
  opcoes = {}
) {
  const timezone = validarTimezone();

  if (!timezone.ok) {
    return timezone;
  }

  const inicio =
    validarInicioAutomacaoConfigurado(
      opcoes.inicioAutomacaoEm ??
      AUTOMACAO_INICIO_EM
    );

  if (!inicio.ok) {
    return inicio;
  }

  return {
    ok: true,
    mensagem: '',
    inicioAutomacao: inicio,
  };
}

function ehPosteriorOuIgualAoInicioAutomacao(
  valorData,
  inicioAutomacao
) {
  const dataRegistro =
    instanteDoValor(valorData);

  const dataInicio =
    inicioAutomacao instanceof Date
      ? inicioAutomacao
      : new Date(
          String(
            inicioAutomacao ?? ''
          )
        );

  if (
    !dataRegistro ||
    Number.isNaN(dataInicio.getTime())
  ) {
    return false;
  }

  return (
    dataRegistro.getTime() >=
    dataInicio.getTime()
  );
}

// ============================================================
// CONSULTA AO AIRTABLE
// ============================================================

function erroPodeSerTemporario(statusHttp) {
  return (
    statusHttp === 408 ||
    statusHttp === 429 ||
    statusHttp >= 500
  );
}

async function requisitarAirtable(
  url,
  headers
) {
  let ultimoErro = null;

  for (
    let tentativa = 1;
    tentativa <=
      AIRTABLE_MAX_TENTATIVAS;
    tentativa += 1
  ) {
    const controlador =
      new AbortController();

    const temporizador = setTimeout(
      () => controlador.abort(),
      AIRTABLE_TIMEOUT_MS
    );

    try {
      const resposta = await fetch(
        url,
        {
          method: 'GET',
          headers,
          signal: controlador.signal,
        }
      );

      if (resposta.ok) {
        return resposta;
      }

      const corpo =
        await resposta.text();

      ultimoErro = new Error(
        `Airtable respondeu HTTP ` +
        `${resposta.status}: ` +
        `${corpo.slice(0, 1000)}`
      );

      const podeRepetir =
        erroPodeSerTemporario(
          resposta.status
        );

      if (
        !podeRepetir ||
        tentativa ===
          AIRTABLE_MAX_TENTATIVAS
      ) {
        throw ultimoErro;
      }

      const retryAfter = Number(
        resposta.headers.get(
          'retry-after'
        )
      );

      const espera =
        (
          Number.isFinite(retryAfter) &&
          retryAfter > 0
        )
          ? retryAfter * 1000
          : 800 * tentativa;

      console.warn(
        `[Airtable] HTTP ` +
        `${resposta.status}. ` +
        `Nova tentativa em ` +
        `${espera} ms ` +
        `(${tentativa}/` +
        `${AIRTABLE_MAX_TENTATIVAS}).`
      );

      await dormir(espera);
    } catch (erro) {
      ultimoErro =
        erro?.name === 'AbortError'
          ? new Error(
              `A consulta ao Airtable ` +
              `excedeu ` +
              `${AIRTABLE_TIMEOUT_MS} ms.`
            )
          : erro;

      if (
        tentativa ===
        AIRTABLE_MAX_TENTATIVAS
      ) {
        throw ultimoErro;
      }

      console.warn(
        `[Airtable] Falha na ` +
        `tentativa ${tentativa}: ` +
        `${ultimoErro.message}. ` +
        `Tentando novamente.`
      );

      await dormir(
        800 * tentativa
      );
    } finally {
      clearTimeout(temporizador);
    }
  }

  throw (
    ultimoErro ||
    new Error(
      'Falha desconhecida ao consultar o Airtable.'
    )
  );
}

async function buscarRegistrosDaView() {
  if (
    !AIRTABLE_TOKEN ||
    !AIRTABLE_BASE_ID ||
    !AIRTABLE_TABLE_ID
  ) {
    throw new Error(
      'Preencha AIRTABLE_TOKEN, ' +
      'AIRTABLE_BASE_ID e ' +
      'AIRTABLE_TABLE_ID no ambiente.'
    );
  }

  if (typeof fetch !== 'function') {
    throw new Error(
      'Este projeto exige Node.js 20 ou superior.'
    );
  }

  const headers = {
    Authorization:
      `Bearer ${AIRTABLE_TOKEN}`,
    Accept: 'application/json',
  };

  const registros = [];
  const offsetsVistos = new Set();

  let offset = '';
  let pagina = 0;

  do {
    pagina += 1;

    if (pagina > AIRTABLE_MAX_PAGINAS) {
      throw new Error(
        `A consulta ultrapassou ` +
        `${AIRTABLE_MAX_PAGINAS} páginas. ` +
        `Revise AIRTABLE_MAX_PAGINAS ou a view.`
      );
    }

    const parametros =
      new URLSearchParams({
        pageSize:
          String(AIRTABLE_PAGE_SIZE),
      });

    if (AIRTABLE_VIEW_ID) {
      parametros.set(
        'view',
        AIRTABLE_VIEW_ID
      );
    }

    if (AIRTABLE_FILTER_FORMULA) {
      parametros.set(
        'filterByFormula',
        AIRTABLE_FILTER_FORMULA
      );
    }

    if (offset) {
      parametros.set(
        'offset',
        offset
      );
    }

    const url =
      `https://api.airtable.com/v0/` +
      `${encodeURIComponent(
        AIRTABLE_BASE_ID
      )}/` +
      `${encodeURIComponent(
        AIRTABLE_TABLE_ID
      )}?` +
      parametros.toString();

    const resposta =
      await requisitarAirtable(
        url,
        headers
      );

    let dados;

    try {
      dados = await resposta.json();
    } catch {
      throw new Error(
        'O Airtable retornou uma resposta que não é JSON.'
      );
    }

    if (!Array.isArray(dados.records)) {
      throw new Error(
        'A resposta do Airtable não contém o array records.'
      );
    }

    registros.push(...dados.records);

    const proximoOffset = String(
      dados.offset || ''
    );

    if (
      proximoOffset &&
      offsetsVistos.has(proximoOffset)
    ) {
      throw new Error(
        'O Airtable repetiu um offset de paginação. ' +
        'A consulta foi interrompida para evitar loop infinito.'
      );
    }

    if (proximoOffset) {
      offsetsVistos.add(proximoOffset);
    }

    offset = proximoOffset;
  } while (offset);

  return registros;
}

// ============================================================
// DIAGNÓSTICO
// ============================================================

function criarDiagnostico() {
  return {
    registrosRecebidos: 0,
    registrosComStatusNaoPermitido: 0,
    registrosSemDataAtualizacaoValida: 0,
    registrosAnterioresAoInicio: 0,
    registrosForaDeOntem: 0,
    registrosSemCliente: 0,
    registrosSemOS: 0,
    registrosAceitosAntesDeduplicacao: 0,
    linhasDeduplicadas: 0,
    linhasConsolidadas: 0,

    clientesConsolidados: 0,
    ordensConsolidadas: 0,

    clientesSemEmail: 0,
    clientesSemWhatsapp: 0,
    clientesComTelefoneInvalido: 0,
    clientesComMaisDeUmWhatsapp: 0,
    clientesComWhatsappCompartilhado: 0,
    clientesComWhatsappBloqueado: 0,
    clientesComWhatsappSeguro: 0,

    numerosCompartilhadosEntreClientes: 0,
  };
}

// ============================================================
// PERFIL GLOBAL DE CONTATOS
// ============================================================

function criarPerfilCliente(
  clienteId,
  clienteNome = ''
) {
  return {
    clienteId,
    clienteNome:
      clienteNome || clienteId,

    emails: new Map(),
    emailsInvalidos: new Map(),

    cnpjs: new Map(),

    telefones: new Map(),
    telefonesInvalidos: new Map(),
  };
}

function obterOuCriarPerfil(
  perfis,
  clienteId,
  clienteNome = ''
) {
  if (!perfis.has(clienteId)) {
    perfis.set(
      clienteId,
      criarPerfilCliente(
        clienteId,
        clienteNome
      )
    );
  }

  const perfil = perfis.get(clienteId);

  if (
    (
      !perfil.clienteNome ||
      perfil.clienteNome ===
        perfil.clienteId
    ) &&
    clienteNome
  ) {
    perfil.clienteNome = clienteNome;
  }

  return perfil;
}

function incorporarContatosAoPerfil(
  perfil,
  campos
) {
  const emails =
    separarEmailsDetalhado(
      lerCampo(
        campos,
        CAMPOS.emailCliente
      )
    );

  for (const email of emails.validos) {
    perfil.emails.set(
      email.toLowerCase(),
      email
    );
  }

  for (const email of emails.invalidos) {
    perfil.emailsInvalidos.set(
      email.toLowerCase(),
      email
    );
  }

  const cnpj = texto(
    lerCampo(
      campos,
      CAMPOS.cnpjCliente
    )
  );

  if (cnpj) {
    const chaveCnpj =
      cnpj.replace(/\D/g, '') || cnpj;

    perfil.cnpjs.set(
      chaveCnpj,
      cnpj
    );
  }

  const telefones =
    separarTelefonesDetalhado(
      lerCampo(
        campos,
        CAMPOS.whatsappCliente
      )
    );

  for (
    const [numero, original]
    of telefones.validos
  ) {
    perfil.telefones.set(
      numero,
      original
    );
  }

  for (
    const invalido
    of telefones.invalidos
  ) {
    const chave =
      normalizarChave(
        invalido.original
      ) || invalido.motivo;

    perfil.telefonesInvalidos.set(
      chave,
      invalido
    );
  }
}

function construirPerfisGlobais(registros) {
  const perfis = new Map();

  for (
    const registro
    of Array.isArray(registros)
      ? registros
      : []
  ) {
    const campos = registro.fields || {};

    const clienteId = primeiroId(
      lerCampo(
        campos,
        CAMPOS.clienteLink
      )
    );

    if (!clienteId) {
      continue;
    }

    const clienteNome = texto(
      lerCampo(
        campos,
        CAMPOS.clienteTexto
      )
    ) || clienteId;

    const perfil = obterOuCriarPerfil(
      perfis,
      clienteId,
      clienteNome
    );

    incorporarContatosAoPerfil(
      perfil,
      campos
    );
  }

  const donosPorTelefone = new Map();

  for (const perfil of perfis.values()) {
    for (
      const numero
      of perfil.telefones.keys()
    ) {
      if (!donosPorTelefone.has(numero)) {
        donosPorTelefone.set(
          numero,
          new Map()
        );
      }

      donosPorTelefone
        .get(numero)
        .set(
          perfil.clienteId,
          perfil.clienteNome
        );
    }
  }

  return {
    perfis,
    donosPorTelefone,
  };
}

// ============================================================
// CHAVE DE DEDUPLICAÇÃO
// ============================================================

function chaveDaLinha(linha) {
  const partes = [
    linha.idTrabalho,
    linha.amostra,
    linha.ensaioNome ||
      linha.ensaioSigla,
    linha.status,
  ].map(item =>
    normalizarChave(item)
  );

  const chave = partes.join('|');

  if (chave.replace(/\|/g, '')) {
    return chave;
  }

  return (
    `record:` +
    String(linha.recordId || '')
  );
}

// ============================================================
// FINALIZAÇÃO DO CLIENTE
// ============================================================

function analisarWhatsappDoCliente({
  cliente,
  perfil,
  donosPorTelefone,
}) {
  const telefones = perfil
    ? [...perfil.telefones.entries()]
    : [];

  const numeros = telefones.map(
    ([numero]) => numero
  );

  const originais = telefones.map(
    ([, original]) => original
  );

  const numerosCompartilhados = [];
  const clientesComMesmoWhatsapp =
    new Set();

  for (const numero of numeros) {
    const donos =
      donosPorTelefone.get(numero);

    if (donos && donos.size > 1) {
      numerosCompartilhados.push(
        numero
      );

      for (
        const [clienteId, clienteNome]
        of donos
      ) {
        if (
          clienteId !==
          cliente.clienteId
        ) {
          clientesComMesmoWhatsapp.add(
            clienteNome || clienteId
          );
        }
      }
    }
  }

  const numerosBloqueados =
    numeros.filter(numero =>
      NUMEROS_BLOQUEADOS.has(numero)
    );

  const maisDeUmNumero =
    numeros.length > 1;

  const compartilhado =
    numerosCompartilhados.length > 0;

  const compartilhadoBloqueante =
    compartilhado &&
    BLOQUEAR_WHATSAPP_COMPARTILHADO;

  const whatsappAmbiguo =
    maisDeUmNumero ||
    compartilhadoBloqueante;

  const motivos = [];

  if (numeros.length === 0) {
    motivos.push('telefone-ausente');
  }

  if (maisDeUmNumero) {
    motivos.push(
      'mais-de-um-numero-no-cliente'
    );
  }

  if (compartilhadoBloqueante) {
    motivos.push(
      'numero-compartilhado-entre-clientes'
    );
  }

  if (numerosBloqueados.length > 0) {
    motivos.push('numero-bloqueado');
  }

  if (
    perfil &&
    perfil.telefonesInvalidos.size > 0
  ) {
    motivos.push(
      'telefone-invalido-encontrado'
    );
  }

  const numeroUnico =
    telefones.length === 1
      ? telefones[0]
      : null;

  const whatsappSeguroParaEnvio = Boolean(
    numeroUnico &&
    !whatsappAmbiguo &&
    !NUMEROS_BLOQUEADOS.has(
      numeroUnico[0]
    )
  );

  return {
    // Compatibilidade com enviar_whatsapp.js.
    whatsapp:
      numeroUnico
        ? numeroUnico[1]
        : '',

    whatsappAmbiguo,

    whatsappsEncontrados:
      originais,

    whatsappDuplicadoEntreClientes:
      compartilhado,

    clientesComMesmoWhatsapp:
      ordenarTextos(
        clientesComMesmoWhatsapp
      ),

    whatsappBloqueado:
      numerosBloqueados.length > 0,

    whatsappSeguroParaEnvio,

    whatsappMotivosBloqueio:
      [...new Set(motivos)],

    telefonesInvalidosQuantidade:
      perfil
        ? perfil.telefonesInvalidos.size
        : 0,

    // Somente máscaras; não expõe números completos em
    // relatórios futuros.
    whatsappsCompartilhadosMascarados:
      numerosCompartilhados.map(
        mascararTelefone
      ),

    whatsappsBloqueadosMascarados:
      numerosBloqueados.map(
        mascararTelefone
      ),
  };
}

function registrarAvisosCliente(
  clienteFinal
) {
  if (!LOG_DADOS_INVALIDOS) {
    return;
  }

  if (
    clienteFinal.emailsInvalidosQuantidade > 0
  ) {
    console.warn(
      `[Airtable/e-mail] ` +
      `${clienteFinal.clienteNome}: ` +
      `${clienteFinal.emailsInvalidosQuantidade} ` +
      `valor(es) inválido(s) ignorado(s).`
    );
  }

  if (
    clienteFinal.cnpjsEncontrados.length > 1
  ) {
    console.warn(
      `[Airtable] ` +
      `${clienteFinal.clienteNome}: ` +
      `mais de um CNPJ encontrado. ` +
      `O primeiro será utilizado.`
    );
  }

  if (
    clienteFinal.whatsappsEncontrados.length > 1
  ) {
    console.warn(
      `[Airtable/WhatsApp] ` +
      `${clienteFinal.clienteNome}: ` +
      `mais de um telefone válido encontrado. ` +
      `O envio será bloqueado.`
    );
  }

  if (
    clienteFinal
      .whatsappDuplicadoEntreClientes
  ) {
    console.warn(
      `[Airtable/WhatsApp] ` +
      `${clienteFinal.clienteNome}: ` +
      `telefone compartilhado com ` +
      `${clienteFinal.clientesComMesmoWhatsapp.join(' | ')}. ` +
      `O envio será bloqueado.`
    );
  }

  if (clienteFinal.whatsappBloqueado) {
    console.warn(
      `[Airtable/WhatsApp] ` +
      `${clienteFinal.clienteNome}: ` +
      `o telefone está na lista de bloqueados ` +
      `(${clienteFinal.whatsappsBloqueadosMascarados.join(' | ')}).`
    );
  }

  if (
    clienteFinal.telefonesInvalidosQuantidade > 0
  ) {
    console.warn(
      `[Airtable/WhatsApp] ` +
      `${clienteFinal.clienteNome}: ` +
      `${clienteFinal.telefonesInvalidosQuantidade} ` +
      `telefone(s) inválido(s) ignorado(s).`
    );
  }
}

// ============================================================
// AGRUPAMENTO DETALHADO
// CLIENTE → ORDEM DE SERVIÇO → LINHAS
// ============================================================

function agruparPorClienteEOSDetalhado(
  registros,
  opcoes = {}
) {
  const ignorarData =
    opcoes.ignorarData === true;

  const modoAuditoria =
    opcoes.modoAuditoria === true;

  const ignorarCorteAutomacao =
    modoAuditoria &&
    opcoes.ignorarCorteAutomacao === true;

  const agora =
    opcoes.agora instanceof Date
      ? opcoes.agora
      : new Date();

  const diagnostico = criarDiagnostico();

  const listaRegistros =
    Array.isArray(registros)
      ? registros
      : [];

  diagnostico.registrosRecebidos =
    listaRegistros.length;

  const configuracao =
    ignorarCorteAutomacao
      ? {
          ok: true,
          inicioAutomacao: null,
        }
      : validarConfiguracaoOperacional(
          opcoes
        );

  if (!configuracao.ok) {
    throw new Error(
      `${configuracao.mensagem} ` +
      'O processamento foi interrompido para ' +
      'impedir envios retroativos.'
    );
  }

  const perfisGlobais =
    CONTATOS_USAR_TODOS_REGISTROS
      ? construirPerfisGlobais(
          listaRegistros
        )
      : {
          perfis: new Map(),
          donosPorTelefone: new Map(),
        };

  const clientes = new Map();

  for (const registro of listaRegistros) {
    const campos = registro.fields || {};

    const statusBruto = texto(
      lerCampo(
        campos,
        CAMPOS.status
      )
    );

    const status =
      STATUS_PERMITIDOS_MAP.get(
        normalizarChave(statusBruto)
      );

    if (!status) {
      diagnostico
        .registrosComStatusNaoPermitido += 1;
      continue;
    }

    const valorDataAtualizacao =
      lerCampo(
        campos,
        CAMPOS.dataAtualizacao
      );

    if (!ignorarCorteAutomacao) {
      const instanteAtualizacao =
        instanteDoValor(
          valorDataAtualizacao
        );

      if (!instanteAtualizacao) {
        diagnostico
          .registrosSemDataAtualizacaoValida += 1;
        continue;
      }

      if (
        instanteAtualizacao.getTime() <
        configuracao
          .inicioAutomacao
          .data
          .getTime()
      ) {
        diagnostico
          .registrosAnterioresAoInicio += 1;
        continue;
      }
    }

    if (
      !ignorarData &&
      !ehDeOntem(
        valorDataAtualizacao,
        agora
      )
    ) {
      diagnostico
        .registrosForaDeOntem += 1;
      continue;
    }

    const clienteId = primeiroId(
      lerCampo(
        campos,
        CAMPOS.clienteLink
      )
    );

    const osId = primeiroId(
      lerCampo(
        campos,
        CAMPOS.osLink
      )
    );

    if (!clienteId || !osId) {
      if (!clienteId) {
        diagnostico
          .registrosSemCliente += 1;
      }

      if (!osId) {
        diagnostico
          .registrosSemOS += 1;
      }

      if (LOG_REGISTROS_IGNORADOS) {
        const ausentes = [
          !clienteId ? 'Cliente' : '',
          !osId ? 'Ordem de Serviço' : '',
        ].filter(Boolean);

        console.warn(
          `[Airtable] Registro ` +
          `${registro.id || '(sem ID)'} ` +
          `ignorado: ` +
          `${ausentes.join(' e ')} ` +
          `ausente(s).`
        );
      }

      continue;
    }

    const clienteNomeRegistro = texto(
      lerCampo(
        campos,
        CAMPOS.clienteTexto
      )
    ) || clienteId;

    if (!clientes.has(clienteId)) {
      const perfilGlobal =
        perfisGlobais.perfis.get(
          clienteId
        );

      clientes.set(
        clienteId,
        {
          clienteId,
          clienteNome:
            perfilGlobal?.clienteNome ||
            clienteNomeRegistro,

          perfilContato:
            perfilGlobal ||
            criarPerfilCliente(
              clienteId,
              clienteNomeRegistro
            ),

          ordens: new Map(),
        }
      );
    }

    const cliente =
      clientes.get(clienteId);

    if (
      !CONTATOS_USAR_TODOS_REGISTROS
    ) {
      incorporarContatosAoPerfil(
        cliente.perfilContato,
        campos
      );
    }

    if (
      (
        !cliente.clienteNome ||
        cliente.clienteNome ===
          cliente.clienteId
      ) &&
      clienteNomeRegistro
    ) {
      cliente.clienteNome =
        clienteNomeRegistro;
    }

    if (!cliente.ordens.has(osId)) {
      cliente.ordens.set(
        osId,
        {
          osId,
          osNome:
            texto(
              lerCampo(
                campos,
                CAMPOS.osTexto
              )
            ) || osId,
          linhas: new Map(),
        }
      );
    }

    const ordem =
      cliente.ordens.get(osId);

    const osNomeAtual = texto(
      lerCampo(
        campos,
        CAMPOS.osTexto
      )
    );

    if (
      (
        !ordem.osNome ||
        ordem.osNome === ordem.osId
      ) &&
      osNomeAtual
    ) {
      ordem.osNome = osNomeAtual;
    }

    const linha = {
      recordId: String(
        registro.id || ''
      ),

      idTrabalho: texto(
        lerCampo(
          campos,
          CAMPOS.idTrabalho
        )
      ),

      nomeTrabalho: texto(
        lerCampo(
          campos,
          CAMPOS.nomeTrabalho
        )
      ),

      amostra: texto(
        lerCampo(
          campos,
          CAMPOS.amostra
        )
      ),

      ensaioSigla: texto(
        lerCampo(
          campos,
          CAMPOS.ensaioSigla
        )
      ),

      ensaioNome: texto(
        lerCampo(
          campos,
          CAMPOS.ensaioNome,
          [
            'Nome_Completo_Ensaios ',
            'Nome_Completo_Ensaios',
          ]
        )
      ),

      statusCliente: texto(
        lerCampo(
          campos,
          CAMPOS.statusCliente
        )
      ),

      status,

      dataConclusao: texto(
        lerCampo(
          campos,
          CAMPOS.dataConclusao
        )
      ),

      dataEnvio: texto(
        lerCampo(
          campos,
          CAMPOS.dataEnvioRelatorio
        )
      ),

      dataAtualizacao: texto(
        valorDataAtualizacao
      ),
    };

    diagnostico
      .registrosAceitosAntesDeduplicacao += 1;

    const chaveLinha =
      chaveDaLinha(linha);

    if (
      ordem.linhas.has(chaveLinha)
    ) {
      diagnostico
        .linhasDeduplicadas += 1;
      continue;
    }

    ordem.linhas.set(
      chaveLinha,
      linha
    );
  }

  // Quando os perfis foram montados somente com registros
  // filtrados, o índice de propriedade precisa ser criado agora.
  let donosPorTelefone =
    perfisGlobais.donosPorTelefone;

  if (!CONTATOS_USAR_TODOS_REGISTROS) {
    donosPorTelefone = new Map();

    for (const cliente of clientes.values()) {
      for (
        const numero
        of cliente
          .perfilContato
          .telefones
          .keys()
      ) {
        if (!donosPorTelefone.has(numero)) {
          donosPorTelefone.set(
            numero,
            new Map()
          );
        }

        donosPorTelefone
          .get(numero)
          .set(
            cliente.clienteId,
            cliente.clienteNome
          );
      }
    }
  }

  diagnostico
    .numerosCompartilhadosEntreClientes =
      [...donosPorTelefone.values()]
        .filter(donos => donos.size > 1)
        .length;

  const clientesFinal = [
    ...clientes.values(),
  ].map(cliente => {
    const perfil =
      cliente.perfilContato;

    const emails = [
      ...perfil.emails.values(),
    ];

    const cnpjs = [
      ...perfil.cnpjs.values(),
    ];

    const whatsapp =
      analisarWhatsappDoCliente({
        cliente,
        perfil,
        donosPorTelefone,
      });

    const ordens = [
      ...cliente.ordens.values(),
    ].map(ordem => ({
      osId: ordem.osId,
      osNome: ordem.osNome,
      linhas: [
        ...ordem.linhas.values(),
      ],
    }));

    const clienteFinal = {
      clienteId: cliente.clienteId,
      clienteNome: cliente.clienteNome,

      emails,

      // Compatibilidade com o fluxo atual de e-mail.
      email: emails.join(', '),

      emailsInvalidosQuantidade:
        perfil.emailsInvalidos.size,

      cnpj: cnpjs[0] || '',
      cnpjsEncontrados: cnpjs,

      ...whatsapp,

      ordens,
    };

    registrarAvisosCliente(
      clienteFinal
    );

    return clienteFinal;
  });

  diagnostico.clientesConsolidados =
    clientesFinal.length;

  diagnostico.ordensConsolidadas =
    clientesFinal.reduce(
      (total, cliente) =>
        total + cliente.ordens.length,
      0
    );

  diagnostico.linhasConsolidadas =
    clientesFinal.reduce(
      (totalClientes, cliente) =>
        totalClientes +
        cliente.ordens.reduce(
          (totalOrdens, ordem) =>
            totalOrdens +
            ordem.linhas.length,
          0
        ),
      0
    );

  for (const cliente of clientesFinal) {
    if (cliente.emails.length === 0) {
      diagnostico.clientesSemEmail += 1;
    }

    if (
      cliente.whatsappsEncontrados.length === 0
    ) {
      diagnostico.clientesSemWhatsapp += 1;
    }

    if (
      cliente.telefonesInvalidosQuantidade > 0
    ) {
      diagnostico
        .clientesComTelefoneInvalido += 1;
    }

    if (
      cliente.whatsappsEncontrados.length > 1
    ) {
      diagnostico
        .clientesComMaisDeUmWhatsapp += 1;
    }

    if (
      cliente.whatsappDuplicadoEntreClientes
    ) {
      diagnostico
        .clientesComWhatsappCompartilhado += 1;
    }

    if (cliente.whatsappBloqueado) {
      diagnostico
        .clientesComWhatsappBloqueado += 1;
    }

    if (cliente.whatsappSeguroParaEnvio) {
      diagnostico
        .clientesComWhatsappSeguro += 1;
    }
  }

  return {
    clientes: clientesFinal,

    diagnostico,

    configuracao: {
      timezone: TIMEZONE,
      inicioAutomacaoEm:
        ignorarCorteAutomacao
          ? null
          : configuracao
              .inicioAutomacao
              .bruto,
      ignorarData,
      modoAuditoria,
      ignorarCorteAutomacao,
      contatosUsarTodosRegistros:
        CONTATOS_USAR_TODOS_REGISTROS,
      bloquearWhatsappCompartilhado:
        BLOQUEAR_WHATSAPP_COMPARTILHADO,
      quantidadeNumerosBloqueados:
        NUMEROS_BLOQUEADOS.size,
    },
  };
}

/**
 * Compatibilidade com o restante do projeto.
 *
 * Continua retornando somente o array de clientes.
 */
function agruparPorClienteEOS(
  registros,
  opcoes = {}
) {
  return agruparPorClienteEOSDetalhado(
    registros,
    opcoes
  ).clientes;
}

// ============================================================
// FUNÇÕES PRINCIPAIS
// ============================================================

async function buscarResumoDiarioDetalhado(
  opcoes = {}
) {
  const registros =
    await buscarRegistrosDaView();

  return agruparPorClienteEOSDetalhado(
    registros,
    opcoes
  );
}

async function buscarResumoDiario(
  opcoes = {}
) {
  const resultado =
    await buscarResumoDiarioDetalhado(
      opcoes
    );

  return resultado.clientes;
}

/**
 * Gera uma visão resumida da qualidade dos contatos já
 * consolidados. Pode ser usada por scripts futuros sem acessar
 * detalhes sensíveis.
 */
function analisarQualidadeContatos(
  clientes
) {
  const lista = Array.isArray(clientes)
    ? clientes
    : [];

  return lista.map(cliente => ({
    clienteId:
      cliente.clienteId || '',

    clienteNome:
      cliente.clienteNome || '',

    quantidadeEmails:
      Array.isArray(cliente.emails)
        ? cliente.emails.length
        : 0,

    quantidadeWhatsapps:
      Array.isArray(
        cliente.whatsappsEncontrados
      )
        ? cliente.whatsappsEncontrados.length
        : 0,

    whatsappSeguroParaEnvio:
      cliente
        .whatsappSeguroParaEnvio === true,

    whatsappAmbiguo:
      cliente.whatsappAmbiguo === true,

    whatsappCompartilhado:
      cliente
        .whatsappDuplicadoEntreClientes === true,

    whatsappBloqueado:
      cliente.whatsappBloqueado === true,

    motivos:
      Array.isArray(
        cliente.whatsappMotivosBloqueio
      )
        ? cliente.whatsappMotivosBloqueio
        : [],

    quantidadeOS:
      Array.isArray(cliente.ordens)
        ? cliente.ordens.length
        : 0,
  }));
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  buscarResumoDiario,
  buscarResumoDiarioDetalhado,
  buscarRegistrosDaView,

  agruparPorClienteEOS,
  agruparPorClienteEOSDetalhado,

  analisarQualidadeContatos,

  separarEmails,
  separarEmailsDetalhado,

  separarTelefones,
  separarTelefonesDetalhado,
  normalizarTelefoneContato,
  mascararTelefone,

  dataCalendarioDoValor,
  instanteDoValor,
  ehDeOntem,
  ehPosteriorOuIgualAoInicioAutomacao,
  validarInicioAutomacaoConfigurado,
  validarConfiguracaoOperacional,

  CAMPOS,
  STATUS_PERMITIDOS,
  TIMEZONE,
  AUTOMACAO_INICIO_EM,

  CONFIG: Object.freeze({
    timezone: TIMEZONE,
    automacaoInicioEm:
      AUTOMACAO_INICIO_EM,

    contatosUsarTodosRegistros:
      CONTATOS_USAR_TODOS_REGISTROS,

    bloquearWhatsappCompartilhado:
      BLOQUEAR_WHATSAPP_COMPARTILHADO,

    quantidadeNumerosBloqueados:
      NUMEROS_BLOQUEADOS.size,

    pageSize: AIRTABLE_PAGE_SIZE,
    maxPaginas: AIRTABLE_MAX_PAGINAS,
  }),
};