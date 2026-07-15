'use strict';

// ============================================================
// server.js — SERVIDOR, CRON E DISPARO MANUAL
// ============================================================
// Responsabilidades:
//
// 1. Manter o serviço ativo no Render.
// 2. Executar o processamento diário no horário configurado.
// 3. Permitir disparo manual protegido por chave.
// 4. Impedir disparos simultâneos.
// 5. Expor rotas de saúde e status.
// 6. Não registrar senhas, tokens ou a chave manual nos logs.
//
// Fluxo executado:
//
// Airtable
//   → agrupamento por cliente
//   → agrupamento por Ordem de Serviço
//   → um e-mail por OS
//   → uma mensagem de WhatsApp por OS
// ============================================================

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cron = require('node-cron');

const {
  executarEnvioDiario,
  existeExecucaoEmAndamento,
} = require('./enviar_todos.js');

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

function numeroInteiroPositivo(valor, padrao) {
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
  porta: numeroInteiroPositivo(
    process.env.PORT,
    3000
  ),

  timezone: textoEnv(
    'APP_TIMEZONE',
    'America/Sao_Paulo'
  ),

  cronAtivo: booleanoEnv(
    'CRON_ATIVO',
    true
  ),

  cronHorario: textoEnv(
    'CRON_HORARIO',
    '0 8 * * *'
  ),

  chaveDisparoManual: textoEnv(
    'CHAVE_DISPARO_MANUAL'
  ),

  // Mantém compatibilidade com o endpoint GET antigo.
  //
  // O método recomendado é POST com:
  // X-API-Key: SUA_CHAVE
  permitirDisparoManualGet: booleanoEnv(
    'PERMITIR_DISPARO_MANUAL_GET',
    true
  ),

  jsonLimite: textoEnv(
    'SERVIDOR_JSON_LIMITE',
    '32kb'
  ),
});

// ============================================================
// ESTADO DO SERVIDOR
// ============================================================

const estado = {
  iniciadoEm:
    new Date().toISOString(),

  ultimaExecucaoIniciadaEm: null,
  ultimaExecucaoFinalizadaEm: null,

  ultimaOrigem: null,
  ultimoResultado: null,
  ultimoErro: null,
};

let servidorHttp = null;
let tarefaCron = null;

// ============================================================
// APLICAÇÃO EXPRESS
// ============================================================

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  express.json({
    limit: CONFIG.jsonLimite,
    strict: true,
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: CONFIG.jsonLimite,
  })
);

// Evita cache de respostas administrativas.
app.use((req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate'
  );

  res.setHeader(
    'Pragma',
    'no-cache'
  );

  next();
});

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function agoraEmBrasilia() {
  return new Date().toLocaleString(
    'pt-BR',
    {
      timeZone:
        CONFIG.timezone,
    }
  );
}

function valorBooleano(valor) {
  if (
    valor === undefined ||
    valor === null ||
    valor === ''
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
    String(valor)
      .trim()
      .toLowerCase()
  );
}

function compararSegredos(
  recebido,
  esperado
) {
  const valorRecebido =
    String(recebido || '');

  const valorEsperado =
    String(esperado || '');

  if (
    !valorRecebido ||
    !valorEsperado
  ) {
    return false;
  }

  const bufferRecebido =
    Buffer.from(valorRecebido);

  const bufferEsperado =
    Buffer.from(valorEsperado);

  if (
    bufferRecebido.length !==
    bufferEsperado.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    bufferRecebido,
    bufferEsperado
  );
}

function extrairChaveManual(req) {
  const xApiKey =
    req.get('x-api-key');

  if (xApiKey) {
    return xApiKey;
  }

  const authorization =
    req.get('authorization');

  if (
    authorization &&
    /^Bearer\s+/i.test(authorization)
  ) {
    return authorization.replace(
      /^Bearer\s+/i,
      ''
    ).trim();
  }

  if (req.body?.chave) {
    return String(
      req.body.chave
    );
  }

  if (req.query?.chave) {
    return String(
      req.query.chave
    );
  }

  return '';
}

function requisicaoAutorizada(req) {
  const recebida =
    extrairChaveManual(req);

  return compararSegredos(
    recebida,
    CONFIG.chaveDisparoManual
  );
}

function extrairIgnorarData(req) {
  return valorBooleano(
    req.body?.ignorarData ??
    req.query?.ignorarData
  );
}

function resumoSeguro(resultado) {
  if (!resultado) {
    return null;
  }

  return {
    ok:
      resultado.ok,

    executado:
      resultado.executado,

    motivo:
      resultado.motivo,

    inicio:
      resultado.inicio,

    fim:
      resultado.fim,

    duracaoMs:
      resultado.duracaoMs,

    clientesEncontrados:
      resultado.clientesEncontrados,

    ordensEncontradas:
      resultado.ordensEncontradas,

    ordensProcessadas:
      resultado.ordensProcessadas,

    ordensSemLinhas:
      resultado.ordensSemLinhas,

    email:
      resultado.email,

    whatsapp:
      resultado.whatsapp,
  };
}

// ============================================================
// EXECUÇÃO CONTROLADA
// ============================================================

async function executarControlado({
  origem,
  ignorarData = false,
}) {
  estado.ultimaExecucaoIniciadaEm =
    new Date().toISOString();

  estado.ultimaExecucaoFinalizadaEm =
    null;

  estado.ultimaOrigem =
    origem;

  estado.ultimoErro =
    null;

  console.log(
    `[${agoraEmBrasilia()}] ` +
    `Disparo iniciado. ` +
    `Origem: ${origem}. ` +
    `Ignorar data: ${ignorarData ? 'sim' : 'não'}.`
  );

  try {
    const resultado =
      await executarEnvioDiario({
        origem,
        ignorarData,
      });

    estado.ultimoResultado =
      resumoSeguro(resultado);

    estado.ultimaExecucaoFinalizadaEm =
      new Date().toISOString();

    return resultado;
  } catch (erro) {
    estado.ultimoErro = {
      mensagem:
        erro?.message ||
        String(erro),

      ocorridoEm:
        new Date().toISOString(),
    };

    estado.ultimaExecucaoFinalizadaEm =
      new Date().toISOString();

    throw erro;
  }
}

// ============================================================
// ROTAS DE SAÚDE
// ============================================================

app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,

    servico:
      'ITR Engenharia — E-mails e WhatsApp',

    mensagem:
      'Servidor funcionando.',

    iniciadoEm:
      estado.iniciadoEm,

    timezone:
      CONFIG.timezone,

    cronAtivo:
      CONFIG.cronAtivo,

    cronHorario:
      CONFIG.cronAtivo
        ? CONFIG.cronHorario
        : null,

    execucaoEmAndamento:
      existeExecucaoEmAndamento(),
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    status: 'healthy',
    timestamp:
      new Date().toISOString(),
  });
});

app.get('/status', (req, res) => {
  res.status(200).json({
    ok: true,

    execucaoEmAndamento:
      existeExecucaoEmAndamento(),

    ultimaExecucaoIniciadaEm:
      estado.ultimaExecucaoIniciadaEm,

    ultimaExecucaoFinalizadaEm:
      estado.ultimaExecucaoFinalizadaEm,

    ultimaOrigem:
      estado.ultimaOrigem,

    ultimoResultado:
      estado.ultimoResultado,

    ultimoErro:
      estado.ultimoErro,
  });
});

// ============================================================
// DISPARO MANUAL
// ============================================================

async function rotaDisparoManual(
  req,
  res
) {
  if (
    !CONFIG.chaveDisparoManual
  ) {
    return res.status(503).json({
      ok: false,

      executado: false,

      motivo:
        'disparo-manual-desativado',

      mensagem:
        'CHAVE_DISPARO_MANUAL não está configurada.',
    });
  }

  if (
    !requisicaoAutorizada(req)
  ) {
    return res.status(401).json({
      ok: false,

      executado: false,

      motivo:
        'nao-autorizado',

      mensagem:
        'Chave de disparo inválida.',
    });
  }

  if (
    existeExecucaoEmAndamento()
  ) {
    return res.status(409).json({
      ok: false,

      executado: false,

      motivo:
        'execucao-ja-em-andamento',

      mensagem:
        'Já existe um processamento em andamento.',
    });
  }

  const ignorarData =
    extrairIgnorarData(req);

  try {
    const resultado =
      await executarControlado({
        origem:
          req.method === 'POST'
            ? 'manual-post'
            : 'manual-get',

        ignorarData,
      });

    return res.status(200).json({
      ok:
        resultado?.ok !== false,

      executado:
        resultado?.executado !== false,

      ignorarData,

      resultado:
        resumoSeguro(resultado),
    });
  } catch (erro) {
    console.error(
      `[Servidor] Falha no disparo manual: ` +
      `${erro?.message || erro}`
    );

    return res.status(500).json({
      ok: false,

      executado: true,

      motivo:
        'erro-no-processamento',

      mensagem:
        erro?.message ||
        'Erro interno durante o processamento.',
    });
  }
}

// Método recomendado:
//
// POST /disparar-agora
//
// Cabeçalho:
// X-API-Key: SUA_CHAVE
//
// Corpo opcional:
// {
//   "ignorarData": true
// }
app.post(
  '/disparar-agora',
  rotaDisparoManual
);

// Compatibilidade com o fluxo antigo:
//
// GET /disparar-agora?chave=...&ignorarData=1
app.get(
  '/disparar-agora',
  async (req, res) => {
    if (
      !CONFIG.permitirDisparoManualGet
    ) {
      return res.status(405).json({
        ok: false,

        executado: false,

        motivo:
          'metodo-get-desativado',

        mensagem:
          'Utilize POST /disparar-agora.',
      });
    }

    return rotaDisparoManual(
      req,
      res
    );
  }
);

// ============================================================
// ROTAS INEXISTENTES
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    ok: false,

    motivo:
      'rota-nao-encontrada',

    mensagem:
      'Rota não encontrada.',
  });
});

// ============================================================
// TRATAMENTO DE ERROS DO EXPRESS
// ============================================================

app.use(
  (
    erro,
    req,
    res,
    next
  ) => {
    if (
      erro instanceof SyntaxError &&
      erro.status === 400 &&
      'body' in erro
    ) {
      return res.status(400).json({
        ok: false,

        motivo:
          'json-invalido',

        mensagem:
          'O corpo JSON enviado é inválido.',
      });
    }

    console.error(
      `[Servidor] Erro não tratado: ` +
      `${erro?.message || erro}`
    );

    return res.status(500).json({
      ok: false,

      motivo:
        'erro-interno',

      mensagem:
        'Erro interno do servidor.',
    });
  }
);

// ============================================================
// CONFIGURAÇÃO DO CRON
// ============================================================

function configurarCron() {
  if (!CONFIG.cronAtivo) {
    console.log(
      '[CRON] Desativado por CRON_ATIVO=false.'
    );

    return null;
  }

  if (
    !cron.validate(
      CONFIG.cronHorario
    )
  ) {
    throw new Error(
      `CRON_HORARIO inválido: ` +
      `"${CONFIG.cronHorario}".`
    );
  }

  const tarefa = cron.schedule(
    CONFIG.cronHorario,

    async () => {
      if (
        existeExecucaoEmAndamento()
      ) {
        console.warn(
          `[${agoraEmBrasilia()}] ` +
          `[CRON] Disparo ignorado: ` +
          `já existe uma execução em andamento.`
        );

        return;
      }

      try {
        await executarControlado({
          origem: 'cron',
          ignorarData: false,
        });
      } catch (erro) {
        console.error(
          `[CRON] Falha no processamento: ` +
          `${erro?.message || erro}`
        );
      }
    },

    {
      timezone:
        CONFIG.timezone,
    }
  );

  console.log(
    `[CRON] Agendado para ` +
    `"${CONFIG.cronHorario}" ` +
    `no fuso "${CONFIG.timezone}".`
  );

  return tarefa;
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================

function iniciarServidor() {
  if (servidorHttp) {
    return servidorHttp;
  }

  tarefaCron =
    configurarCron();

  servidorHttp = app.listen(
    CONFIG.porta,
    () => {
      console.log('');
      console.log(
        '========================================'
      );

      console.log(
        'ITR Engenharia — Serviço iniciado'
      );

      console.log(
        `Porta: ${CONFIG.porta}`
      );

      console.log(
        `Fuso: ${CONFIG.timezone}`
      );

      console.log(
        `Cron: ${
          CONFIG.cronAtivo
            ? CONFIG.cronHorario
            : 'desativado'
        }`
      );

      console.log(
        `Disparo manual: ${
          CONFIG.chaveDisparoManual
            ? 'protegido por chave'
            : 'desativado'
        }`
      );

      console.log(
        '========================================'
      );

      console.log('');
    }
  );

  return servidorHttp;
}

// ============================================================
// ENCERRAMENTO CONTROLADO
// ============================================================

function encerrarServidor(
  sinal
) {
  console.log(
    `[Servidor] Recebido ${sinal}. Encerrando...`
  );

  if (tarefaCron) {
    try {
      tarefaCron.stop();

      if (
        typeof tarefaCron.destroy ===
        'function'
      ) {
        tarefaCron.destroy();
      }
    } catch (erro) {
      console.error(
        `[CRON] Erro ao encerrar tarefa: ` +
        `${erro?.message || erro}`
      );
    }
  }

  if (!servidorHttp) {
    process.exit(0);
    return;
  }

  servidorHttp.close(erro => {
    if (erro) {
      console.error(
        `[Servidor] Erro no encerramento: ` +
        `${erro.message}`
      );

      process.exit(1);
      return;
    }

    console.log(
      '[Servidor] Encerrado corretamente.'
    );

    process.exit(0);
  });

  // Evita que uma conexão presa mantenha o processo
  // indefinidamente durante o encerramento.
  setTimeout(() => {
    console.error(
      '[Servidor] Encerramento forçado após 10 segundos.'
    );

    process.exit(1);
  }, 10000).unref();
}

process.once(
  'SIGTERM',
  () => encerrarServidor('SIGTERM')
);

process.once(
  'SIGINT',
  () => encerrarServidor('SIGINT')
);

// ============================================================
// EXECUÇÃO DIRETA
// ============================================================

if (require.main === module) {
  try {
    iniciarServidor();
  } catch (erro) {
    console.error(
      `[Servidor] Não foi possível iniciar: ` +
      `${erro?.message || erro}`
    );

    process.exit(1);
  }
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  app,
  iniciarServidor,
  configurarCron,
  CONFIG,
};