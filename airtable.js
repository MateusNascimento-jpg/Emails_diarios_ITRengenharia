'use strict';

// ============================================================
// airtable.js — LEITURA, FILTRO E AGRUPAMENTO DO AIRTABLE
// ============================================================
//
// REGRAS DE NEGÓCIO:
//
// 1. Todos os dados utilizados vêm do Airtable.
// 2. No funcionamento normal, somente registros atualizados
//    ontem são processados.
// 3. Somente os status permitidos entram no envio.
// 4. Os registros são agrupados desta maneira:
//
//    Cliente
//      └── Ordem de Serviço
//            ├── Amostra / Ensaio / Status
//            ├── Amostra / Ensaio / Status
//            └── Amostra / Ensaio / Status
//
// 5. Uma mesma OS mantém todas as suas linhas associadas.
// 6. Registros sem cliente ou sem OS são ignorados.
// 7. Linhas realmente duplicadas são removidas.
// 8. O telefone do WhatsApp também vem do Airtable.
// 9. Este módulo atende tanto o e-mail quanto o WhatsApp.
// ============================================================

require('dotenv').config({
  quiet: true,
});

// ============================================================
// FUNÇÕES DE CONFIGURAÇÃO
// ============================================================

function campoEnv(nome, padrao) {
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
 * Preserva espaços no começo ou no final do nome do campo.
 *
 * Isso é necessário porque o campo atual:
 *
 * Nome_Completo_Ensaios
 *
 * possui um espaço real no final no Airtable.
 */
function campoEnvExato(nome, padrao) {
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

// ============================================================
// CONFIGURAÇÕES GERAIS
// ============================================================

const TIMEZONE = campoEnv(
  'APP_TIMEZONE',
  'America/Sao_Paulo'
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

// ============================================================
// NOMES DOS CAMPOS DO AIRTABLE
// ============================================================
//
// Todos os nomes podem ser substituídos pelo .env.
//
// O código não precisará ser alterado se um campo mudar de
// nome futuramente.
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

  // Existe um espaço real depois de "Ensaios".
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

/**
 * Busca um campo preservando compatibilidade com o nome antigo
 * que possui espaço no final.
 */
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

// ============================================================
// TRATAMENTO DE E-MAILS
// ============================================================

function separarEmails(
  valor,
  contexto = ''
) {
  const formatoBasico =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const vistos = new Set();
  const validos = [];
  const descartados = [];

  for (
    const item of listaSeparada(valor)
  ) {
    const chave =
      item.toLowerCase();

    if (!formatoBasico.test(item)) {
      descartados.push(item);
      continue;
    }

    if (vistos.has(chave)) {
      continue;
    }

    vistos.add(chave);
    validos.push(item);
  }

  if (descartados.length > 0) {
    console.warn(
      `[Airtable/e-mail] ` +
      `${contexto ? `(${contexto}) ` : ''}` +
      `valor(es) inválido(s) ignorado(s): ` +
      `${descartados.join(' | ')}`
    );
  }

  return validos;
}

// ============================================================
// TRATAMENTO DE TELEFONES
// ============================================================

function separarTelefones(valor) {
  const vistos = new Set();
  const telefones = [];

  for (
    const item of listaSeparada(valor)
  ) {
    const somenteDigitos =
      item.replace(/\D/g, '');

    if (
      !somenteDigitos ||
      vistos.has(somenteDigitos)
    ) {
      continue;
    }

    vistos.add(somenteDigitos);
    telefones.push(item);
  }

  return telefones;
}

// ============================================================
// TRATAMENTO DE DATAS
// ============================================================

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
    dataUtc.getUTCDate() -
      quantidade
  );

  return dataUtc
    .toISOString()
    .slice(0, 10);
}

function dataCalendarioDoValor(valor) {
  const bruto = Array.isArray(valor)
    ? String(valor[0] ?? '').trim()
    : String(valor ?? '').trim();

  if (!bruto) {
    return '';
  }

  // Quando o Airtable entrega apenas YYYY-MM-DD,
  // o valor é preservado diretamente.
  //
  // Isso evita que meia-noite UTC seja convertida
  // para o dia anterior no fuso de Brasília.
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(bruto)
  ) {
    return bruto;
  }

  const data = new Date(bruto);

  if (
    Number.isNaN(data.getTime())
  ) {
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

// ============================================================
// CONSULTA AO AIRTABLE
// ============================================================

function erroPodeSerTemporario(
  statusHttp
) {
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

    const temporizador =
      setTimeout(
        () => controlador.abort(),
        AIRTABLE_TIMEOUT_MS
      );

    try {
      const resposta = await fetch(
        url,
        {
          method: 'GET',
          headers,
          signal:
            controlador.signal,
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
          Number.isFinite(
            retryAfter
          ) &&
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
      clearTimeout(
        temporizador
      );
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

  if (
    typeof fetch !== 'function'
  ) {
    throw new Error(
      'Este projeto exige Node.js 20 ou superior.'
    );
  }

  const headers = {
    Authorization:
      `Bearer ${AIRTABLE_TOKEN}`,

    Accept:
      'application/json',
  };

  const registros = [];
  let offset = '';

  do {
    const parametros =
      new URLSearchParams({
        pageSize: '100',
      });

    if (AIRTABLE_VIEW_ID) {
      parametros.set(
        'view',
        AIRTABLE_VIEW_ID
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

    const dados =
      await resposta.json();

    if (
      Array.isArray(dados.records)
    ) {
      registros.push(
        ...dados.records
      );
    }

    offset = String(
      dados.offset || ''
    );
  } while (offset);

  return registros;
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
    String(item || '')
      .trim()
      .toLowerCase()
  );

  const chave =
    partes.join('|');

  if (
    chave.replace(/\|/g, '')
  ) {
    return chave;
  }

  return (
    `record:` +
    String(
      linha.recordId || ''
    )
  );
}

// ============================================================
// AGRUPAMENTO
// CLIENTE → ORDEM DE SERVIÇO → LINHAS
// ============================================================

function agruparPorClienteEOS(
  registros,
  opcoes = {}
) {
  const ignorarData =
    opcoes.ignorarData === true;

  const agora =
    opcoes.agora instanceof Date
      ? opcoes.agora
      : new Date();

  const clientes = new Map();

  const listaRegistros =
    Array.isArray(registros)
      ? registros
      : [];

  for (
    const registro of listaRegistros
  ) {
    const campos =
      registro.fields || {};

    const status =
      texto(
        lerCampo(
          campos,
          CAMPOS.status
        )
      );

    // Somente os status configurados
    // entram no processamento.
    if (
      !STATUS_PERMITIDOS.includes(
        status
      )
    ) {
      continue;
    }

    // Normalmente, somente atualizações
    // ocorridas ontem são processadas.
    if (
      !ignorarData &&
      !ehDeOntem(
        lerCampo(
          campos,
          CAMPOS.dataAtualizacao
        ),
        agora
      )
    ) {
      continue;
    }

    const clienteId =
      primeiroId(
        lerCampo(
          campos,
          CAMPOS.clienteLink
        )
      );

    const osId =
      primeiroId(
        lerCampo(
          campos,
          CAMPOS.osLink
        )
      );

    // Não cria agrupamentos genéricos como
    // "(sem cliente)" ou "(sem OS)".
    //
    // Isso evita misturar registros diferentes.
    if (
      !clienteId ||
      !osId
    ) {
      const ausentes = [
        !clienteId
          ? 'Cliente'
          : '',

        !osId
          ? 'Ordem de Serviço'
          : '',
      ].filter(Boolean);

      console.warn(
        `[Airtable] Registro ` +
        `${registro.id || '(sem ID)'} ` +
        `ignorado: ` +
        `${ausentes.join(' e ')} ` +
        `ausente(s).`
      );

      continue;
    }

    const clienteNome =
      texto(
        lerCampo(
          campos,
          CAMPOS.clienteTexto
        )
      ) || clienteId;

    // --------------------------------------------------------
    // CLIENTE
    // --------------------------------------------------------

    if (
      !clientes.has(clienteId)
    ) {
      clientes.set(
        clienteId,
        {
          clienteId,
          clienteNome,

          emails:
            new Map(),

          cnpjs:
            new Map(),

          telefones:
            new Map(),

          ordens:
            new Map(),
        }
      );
    }

    const cliente =
      clientes.get(clienteId);

    if (
      (
        !cliente.clienteNome ||
        cliente.clienteNome ===
          cliente.clienteId
      ) &&
      clienteNome
    ) {
      cliente.clienteNome =
        clienteNome;
    }

    // --------------------------------------------------------
    // E-MAILS
    // --------------------------------------------------------

    const emailsRegistro =
      separarEmails(
        lerCampo(
          campos,
          CAMPOS.emailCliente
        ),
        cliente.clienteNome
      );

    for (
      const email of emailsRegistro
    ) {
      cliente.emails.set(
        email.toLowerCase(),
        email
      );
    }

    // --------------------------------------------------------
    // CNPJ
    // --------------------------------------------------------

    const cnpj =
      texto(
        lerCampo(
          campos,
          CAMPOS.cnpjCliente
        )
      );

    if (cnpj) {
      const chaveCnpj =
        cnpj.replace(/\D/g, '') ||
        cnpj;

      cliente.cnpjs.set(
        chaveCnpj,
        cnpj
      );
    }

    // --------------------------------------------------------
    // WHATSAPP
    // --------------------------------------------------------

    const telefonesRegistro =
      separarTelefones(
        lerCampo(
          campos,
          CAMPOS.whatsappCliente
        )
      );

    for (
      const telefone of
      telefonesRegistro
    ) {
      cliente.telefones.set(
        telefone.replace(/\D/g, ''),
        telefone
      );
    }

    // --------------------------------------------------------
    // ORDEM DE SERVIÇO
    // --------------------------------------------------------

    if (
      !cliente.ordens.has(osId)
    ) {
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

          linhas:
            new Map(),
        }
      );
    }

    const ordem =
      cliente.ordens.get(osId);

    const osNomeAtual =
      texto(
        lerCampo(
          campos,
          CAMPOS.osTexto
        )
      );

    if (
      (
        !ordem.osNome ||
        ordem.osNome ===
          ordem.osId
      ) &&
      osNomeAtual
    ) {
      ordem.osNome =
        osNomeAtual;
    }

    // --------------------------------------------------------
    // LINHA DA OS
    // --------------------------------------------------------

    const linha = {
      recordId:
        String(
          registro.id || ''
        ),

      idTrabalho:
        texto(
          lerCampo(
            campos,
            CAMPOS.idTrabalho
          )
        ),

      nomeTrabalho:
        texto(
          lerCampo(
            campos,
            CAMPOS.nomeTrabalho
          )
        ),

      amostra:
        texto(
          lerCampo(
            campos,
            CAMPOS.amostra
          )
        ),

      ensaioSigla:
        texto(
          lerCampo(
            campos,
            CAMPOS.ensaioSigla
          )
        ),

      ensaioNome:
        texto(
          lerCampo(
            campos,
            CAMPOS.ensaioNome,
            [
              'Nome_Completo_Ensaios ',
              'Nome_Completo_Ensaios',
            ]
          )
        ),

      statusCliente:
        texto(
          lerCampo(
            campos,
            CAMPOS.statusCliente
          )
        ),

      status,

      dataConclusao:
        texto(
          lerCampo(
            campos,
            CAMPOS.dataConclusao
          )
        ),

      dataEnvio:
        texto(
          lerCampo(
            campos,
            CAMPOS
              .dataEnvioRelatorio
          )
        ),

      dataAtualizacao:
        texto(
          lerCampo(
            campos,
            CAMPOS.dataAtualizacao
          )
        ),
    };

    const chaveLinha =
      chaveDaLinha(linha);

    // Uma linha somente é removida quando o conjunto:
    //
    // ID do trabalho
    // + amostra
    // + ensaio
    // + status
    //
    // for realmente igual.
    if (
      !ordem.linhas.has(
        chaveLinha
      )
    ) {
      ordem.linhas.set(
        chaveLinha,
        linha
      );
    }
  }

  // ==========================================================
  // CONVERSÃO DOS MAPS PARA OBJETOS E ARRAYS
  // ==========================================================

  return [
    ...clientes.values(),
  ].map(cliente => {
    const emails = [
      ...cliente.emails.values(),
    ];

    const cnpjs = [
      ...cliente.cnpjs.values(),
    ];

    const telefones = [
      ...cliente.telefones.values(),
    ];

    if (cnpjs.length > 1) {
      console.warn(
        `[Airtable] ` +
        `${cliente.clienteNome}: ` +
        `mais de um CNPJ encontrado ` +
        `(${cnpjs.join(' | ')}). ` +
        `O primeiro será utilizado.`
      );
    }

    if (telefones.length > 1) {
      console.warn(
        `[Airtable/WhatsApp] ` +
        `${cliente.clienteNome}: ` +
        `mais de um telefone encontrado ` +
        `(${telefones.join(' | ')}). ` +
        `O envio será bloqueado até existir ` +
        `apenas um número para o cliente.`
      );
    }

    return {
      clienteId:
        cliente.clienteId,

      clienteNome:
        cliente.clienteNome,

      emails,

      // Compatibilidade com o fluxo atual de e-mail.
      email:
        emails.join(', '),

      cnpj:
        cnpjs[0] || '',

      cnpjsEncontrados:
        cnpjs,

      // Um telefone único permite o envio.
      whatsapp:
        telefones.length === 1
          ? telefones[0]
          : '',

      whatsappAmbiguo:
        telefones.length > 1,

      whatsappsEncontrados:
        telefones,

      ordens: [
        ...cliente.ordens.values(),
      ].map(ordem => ({
        osId:
          ordem.osId,

        osNome:
          ordem.osNome,

        linhas: [
          ...ordem.linhas.values(),
        ],
      })),
    };
  });
}

// ============================================================
// FUNÇÃO PRINCIPAL
// ============================================================

async function buscarResumoDiario(
  opcoes = {}
) {
  const registros =
    await buscarRegistrosDaView();

  return agruparPorClienteEOS(
    registros,
    opcoes
  );
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  buscarResumoDiario,
  buscarRegistrosDaView,
  agruparPorClienteEOS,

  separarEmails,
  separarTelefones,

  dataCalendarioDoValor,
  ehDeOntem,

  CAMPOS,
  STATUS_PERMITIDOS,
  TIMEZONE,
};