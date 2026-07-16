'use strict';

// ============================================================
// server.js — SERVIDOR, CRON, DISPARO MANUAL E WEBHOOK WHATSAPP
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
// AMBIENTE
// ============================================================

function textoEnv(nome, padrao = '') {
  return String(process.env[nome] ?? padrao).trim();
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

  permitirDisparoManualGet: booleanoEnv(
    'PERMITIR_DISPARO_MANUAL_GET',
    true
  ),

  jsonLimite: textoEnv(
    'SERVIDOR_JSON_LIMITE',
    '32kb'
  ),

  webhookRota: '/webhook/whatsapp',

  webhookVerifyToken: textoEnv(
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN'
  ),

  metaAppSecret: textoEnv(
    'META_APP_SECRET'
  ),

  webhookValidarAssinatura: booleanoEnv(
    'WHATSAPP_WEBHOOK_VALIDAR_ASSINATURA',
    true
  ),

  webhookJsonLimite: textoEnv(
    'WHATSAPP_WEBHOOK_JSON_LIMITE',
    '3mb'
  ),
});

// ============================================================
// ESTADO
// ============================================================

const estado = {
  iniciadoEm:
    new Date().toISOString(),

  ultimaExecucaoIniciadaEm: null,
  ultimaExecucaoFinalizadaEm: null,
  ultimaOrigem: null,
  ultimoResultado: null,
  ultimoErro: null,

  webhook: {
    totalRecebidos: 0,
    totalMensagensRecebidas: 0,
    totalStatusRecebidos: 0,
    totalTemplatesRecebidos: 0,
    totalOutrosEventos: 0,
    ultimoRecebidoEm: null,
    ultimoEvento: null,
    ultimoErro: null,
  },
};

let servidorHttp = null;
let tarefaCron = null;

// ============================================================
// EXPRESS
// ============================================================

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

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

// O webhook precisa guardar os bytes originais para validar
// X-Hub-Signature-256 com HMAC-SHA256.
const webhookJsonParser = express.json({
  limit:
    CONFIG.webhookJsonLimite,

  strict: true,

  verify: (req, res, buffer) => {
    req.rawBody =
      Buffer.from(buffer);
  },
});

// ============================================================
// AUXILIARES
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

function somenteDigitos(valor) {
  return String(valor || '')
    .replace(/\D/g, '');
}

function mascararTelefone(valor) {
  const digitos =
    somenteDigitos(valor);

  if (!digitos) {
    return null;
  }

  if (digitos.length <= 4) {
    return '*'.repeat(
      digitos.length
    );
  }

  const prefixo =
    digitos.slice(
      0,
      Math.min(
        4,
        digitos.length - 4
      )
    );

  const sufixo =
    digitos.slice(-4);

  return `${prefixo}*****${sufixo}`;
}

function mascararIdentificador(valor) {
  const texto =
    String(valor || '').trim();

  if (!texto) {
    return null;
  }

  if (texto.length <= 12) {
    return `${texto.slice(0, 3)}***`;
  }

  return (
    `${texto.slice(0, 8)}` +
    `...` +
    `${texto.slice(-6)}`
  );
}

function dataIsoDeTimestampUnix(valor) {
  const segundos =
    Number(valor);

  if (
    !Number.isFinite(segundos) ||
    segundos <= 0
  ) {
    return null;
  }

  return new Date(
    segundos * 1000
  ).toISOString();
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
    /^Bearer\s+/i.test(
      authorization
    )
  ) {
    return authorization
      .replace(
        /^Bearer\s+/i,
        ''
      )
      .trim();
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
  return compararSegredos(
    extrairChaveManual(req),
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

function resumoSeguroWebhook() {
  return {
    configurado:
      Boolean(
        CONFIG.webhookVerifyToken
      ),

    validarAssinatura:
      CONFIG.webhookValidarAssinatura,

    appSecretConfigurado:
      Boolean(
        CONFIG.metaAppSecret
      ),

    rota:
      CONFIG.webhookRota,

    totalRecebidos:
      estado.webhook.totalRecebidos,

    totalMensagensRecebidas:
      estado.webhook
        .totalMensagensRecebidas,

    totalStatusRecebidos:
      estado.webhook
        .totalStatusRecebidos,

    totalTemplatesRecebidos:
      estado.webhook
        .totalTemplatesRecebidos,

    totalOutrosEventos:
      estado.webhook
        .totalOutrosEventos,

    ultimoRecebidoEm:
      estado.webhook
        .ultimoRecebidoEm,

    ultimoEvento:
      estado.webhook
        .ultimoEvento,

    ultimoErro:
      estado.webhook
        .ultimoErro,
  };
}

function assinaturaWebhookValida(req) {
  if (
    !CONFIG.webhookValidarAssinatura
  ) {
    return true;
  }

  if (!CONFIG.metaAppSecret) {
    return false;
  }

  const assinaturaRecebida =
    req.get(
      'x-hub-signature-256'
    ) || '';

  if (
    !/^sha256=[a-f0-9]{64}$/i
      .test(assinaturaRecebida)
  ) {
    return false;
  }

  const corpoOriginal =
    Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from('');

  const assinaturaEsperada =
    `sha256=${crypto
      .createHmac(
        'sha256',
        CONFIG.metaAppSecret
      )
      .update(corpoOriginal)
      .digest('hex')}`;

  return compararSegredos(
    assinaturaRecebida
      .toLowerCase(),

    assinaturaEsperada
      .toLowerCase()
  );
}

function registrarEventoWebhook(
  tipo,
  dados
) {
  estado.webhook.ultimoEvento = {
    tipo,

    recebidoEm:
      new Date().toISOString(),

    ...dados,
  };
}

function registrarErroWebhook(
  erro,
  contexto = null
) {
  const resumo = {
    mensagem:
      erro?.message ||
      String(erro),

    contexto,

    ocorridoEm:
      new Date().toISOString(),
  };

  estado.webhook.ultimoErro =
    resumo;

  console.error(
    `[Webhook WhatsApp] Erro: ` +
    `${resumo.mensagem}`
  );
}

// ============================================================
// PROCESSAMENTO DOS EVENTOS DO WHATSAPP
// ============================================================

function tratarStatusMensagem(status) {
  estado.webhook
    .totalStatusRecebidos += 1;

  const erros =
    Array.isArray(status?.errors)
      ? status.errors.map(
          item => ({
            codigo:
              item?.code ??
              null,

            titulo:
              item?.title ??
              null,

            mensagem:
              item?.message ??
              null,

            detalhes:
              item?.error_data
                ?.details ??
              null,
          })
        )
      : [];

  const resumo = {
    status:
      status?.status ||
      'desconhecido',

    messageId:
      mascararIdentificador(
        status?.id
      ),

    destinatario:
      mascararTelefone(
        status?.recipient_id
      ),

    ocorridoEm:
      dataIsoDeTimestampUnix(
        status?.timestamp
      ),

    quantidadeErros:
      erros.length,

    erros,
  };

  registrarEventoWebhook(
    'status-mensagem',
    resumo
  );

  console.log(
    `[Webhook WhatsApp] Status: ` +
    `${resumo.status}; ` +
    `mensagem: ` +
    `${resumo.messageId || 'não informada'}; ` +
    `destinatário: ` +
    `${resumo.destinatario || 'não informado'}; ` +
    `erros: ${resumo.quantidadeErros}.`
  );
}

function tratarMensagemRecebida(
  mensagem
) {
  estado.webhook
    .totalMensagensRecebidas += 1;

  const resumo = {
    tipoMensagem:
      mensagem?.type ||
      'desconhecido',

    messageId:
      mascararIdentificador(
        mensagem?.id
      ),

    remetente:
      mascararTelefone(
        mensagem?.from
      ),

    ocorridoEm:
      dataIsoDeTimestampUnix(
        mensagem?.timestamp
      ),
  };

  registrarEventoWebhook(
    'mensagem-recebida',
    resumo
  );

  console.log(
    `[Webhook WhatsApp] ` +
    `Mensagem recebida; ` +
    `tipo: ${resumo.tipoMensagem}; ` +
    `remetente: ` +
    `${resumo.remetente || 'não informado'}; ` +
    `id: ` +
    `${resumo.messageId || 'não informado'}.`
  );
}

function tratarAtualizacaoTemplate(
  valor
) {
  estado.webhook
    .totalTemplatesRecebidos += 1;

  const resumo = {
    evento:
      valor?.event ||
      valor?.status ||
      'desconhecido',

    nome:
      valor?.message_template_name ||
      valor?.name ||
      null,

    idioma:
      valor?.message_template_language ||
      valor?.language ||
      null,

    templateId:
      mascararIdentificador(
        valor?.message_template_id ||
        valor?.id
      ),

    motivo:
      valor?.reason ||
      valor?.rejection_reason ||
      valor?.disable_info
        ?.disable_reason ||
      null,
  };

  registrarEventoWebhook(
    'status-template',
    resumo
  );

  console.log(
    `[Webhook WhatsApp] Template: ` +
    `${resumo.nome || 'não informado'}; ` +
    `idioma: ` +
    `${resumo.idioma || 'não informado'}; ` +
    `evento: ${resumo.evento}; ` +
    `motivo: ` +
    `${resumo.motivo || 'não informado'}.`
  );
}

async function processarWebhookWhatsApp(
  payload
) {
  const entradas =
    Array.isArray(payload?.entry)
      ? payload.entry
      : [];

  for (const entrada of entradas) {
    const alteracoes =
      Array.isArray(
        entrada?.changes
      )
        ? entrada.changes
        : [];

    for (
      const alteracao
      of alteracoes
    ) {
      const campo =
        String(
          alteracao?.field ||
          'desconhecido'
        );

      const valor =
        alteracao?.value ||
        {};

      if (campo === 'messages') {
        const mensagens =
          Array.isArray(
            valor?.messages
          )
            ? valor.messages
            : [];

        const status =
          Array.isArray(
            valor?.statuses
          )
            ? valor.statuses
            : [];

        for (
          const mensagem
          of mensagens
        ) {
          tratarMensagemRecebida(
            mensagem
          );
        }

        for (
          const itemStatus
          of status
        ) {
          tratarStatusMensagem(
            itemStatus
          );
        }

        continue;
      }

      if (
        campo ===
        'message_template_status_update'
      ) {
        tratarAtualizacaoTemplate(
          valor
        );

        continue;
      }

      estado.webhook
        .totalOutrosEventos += 1;

      registrarEventoWebhook(
        'outro-evento',
        {
          campo,

          conta:
            mascararIdentificador(
              entrada?.id
            ),
        }
      );

      console.log(
        `[Webhook WhatsApp] ` +
        `Evento recebido no campo ` +
        `"${campo}".`
      );
    }
  }
}

// ============================================================
// WEBHOOK DO WHATSAPP
// ============================================================

// Verificação inicial da URL de callback pela Meta.
app.get(
  CONFIG.webhookRota,

  (req, res) => {
    const modo =
      String(
        req.query?.['hub.mode'] ||
        ''
      );

    const tokenRecebido =
      String(
        req.query?.[
          'hub.verify_token'
        ] ||
        ''
      );

    const desafio =
      req.query?.[
        'hub.challenge'
      ];

    if (
      !CONFIG.webhookVerifyToken
    ) {
      console.error(
        '[Webhook WhatsApp] ' +
        'WHATSAPP_WEBHOOK_VERIFY_TOKEN ' +
        'não configurado.'
      );

      return res
        .status(503)
        .json({
          ok: false,

          motivo:
            'webhook-nao-configurado',
        });
    }

    const autorizado =
      modo === 'subscribe' &&
      compararSegredos(
        tokenRecebido,
        CONFIG.webhookVerifyToken
      );

    if (!autorizado) {
      console.warn(
        '[Webhook WhatsApp] ' +
        'Tentativa de verificação recusada.'
      );

      return res
        .status(403)
        .json({
          ok: false,

          motivo:
            'verificacao-recusada',
        });
    }

    console.log(
      '[Webhook WhatsApp] ' +
      'Endpoint verificado com sucesso pela Meta.'
    );

    return res
      .status(200)
      .type('text/plain')
      .send(
        String(
          desafio ??
          ''
        )
      );
  }
);

// Eventos enviados pela Meta.
app.post(
  CONFIG.webhookRota,

  webhookJsonParser,

  (req, res) => {
    if (
      CONFIG.webhookValidarAssinatura &&
      !CONFIG.metaAppSecret
    ) {
      registrarErroWebhook(
        new Error(
          'META_APP_SECRET não configurado ' +
          'para validar a assinatura.'
        ),

        'configuracao'
      );

      return res
        .status(503)
        .json({
          ok: false,

          motivo:
            'app-secret-nao-configurado',
        });
    }

    if (
      !assinaturaWebhookValida(req)
    ) {
      console.warn(
        '[Webhook WhatsApp] ' +
        'Assinatura inválida ou ausente.'
      );

      return res
        .status(401)
        .json({
          ok: false,

          motivo:
            'assinatura-invalida',
        });
    }

    if (
      req.body?.object !==
      'whatsapp_business_account'
    ) {
      return res
        .status(404)
        .json({
          ok: false,

          motivo:
            'objeto-nao-suportado',
        });
    }

    estado.webhook
      .totalRecebidos += 1;

    estado.webhook
      .ultimoRecebidoEm =
        new Date().toISOString();

    // Responde imediatamente para evitar
    // reentregas causadas por timeout.
    res.sendStatus(200);

    setImmediate(() => {
      processarWebhookWhatsApp(
        req.body
      ).catch(erro => {
        registrarErroWebhook(
          erro,
          'processamento-assincrono'
        );
      });
    });

    return undefined;
  }
);

// Parsers das demais rotas.
// Devem permanecer depois do parser específico do webhook.
app.use(
  express.json({
    limit:
      CONFIG.jsonLimite,

    strict: true,
  })
);

app.use(
  express.urlencoded({
    extended: false,

    limit:
      CONFIG.jsonLimite,
  })
);

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
    `Ignorar data: ` +
    `${ignorarData ? 'sim' : 'não'}.`
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
// SAÚDE E STATUS
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

    webhook: {
      configurado:
        Boolean(
          CONFIG.webhookVerifyToken
        ),

      validarAssinatura:
        CONFIG.webhookValidarAssinatura,

      rota:
        CONFIG.webhookRota,
    },
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,

    status:
      'healthy',

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

    webhook:
      resumoSeguroWebhook(),
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
    return res
      .status(503)
      .json({
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
    return res
      .status(401)
      .json({
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
    return res
      .status(409)
      .json({
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

    return res
      .status(200)
      .json({
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

    return res
      .status(500)
      .json({
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

// Recomendado:
//
// POST /disparar-agora
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

// Compatibilidade antiga:
//
// GET /disparar-agora?chave=...&ignorarData=1

app.get(
  '/disparar-agora',

  async (req, res) => {
    if (
      !CONFIG.permitirDisparoManualGet
    ) {
      return res
        .status(405)
        .json({
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
// 404 E ERROS
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
      return res
        .status(400)
        .json({
          ok: false,

          motivo:
            'json-invalido',

          mensagem:
            'O corpo JSON enviado é inválido.',
        });
    }

    if (
      erro?.type ===
      'entity.too.large'
    ) {
      return res
        .status(413)
        .json({
          ok: false,

          motivo:
            'corpo-excede-limite',

          mensagem:
            'O corpo da requisição excede o limite permitido.',
        });
    }

    console.error(
      `[Servidor] Erro não tratado: ` +
      `${erro?.message || erro}`
    );

    return res
      .status(500)
      .json({
        ok: false,

        motivo:
          'erro-interno',

        mensagem:
          'Erro interno do servidor.',
      });
  }
);

// ============================================================
// CRON
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

  const tarefa =
    cron.schedule(
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
            origem:
              'cron',

            ignorarData:
              false,
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
    `no fuso ` +
    `"${CONFIG.timezone}".`
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

  servidorHttp =
    app.listen(
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
          `Webhook WhatsApp: ${
            CONFIG.webhookVerifyToken
              ? CONFIG.webhookRota
              : 'não configurado'
          }`
        );

        console.log(
          `Validação da assinatura do webhook: ${
            CONFIG.webhookValidarAssinatura
              ? 'ativada'
              : 'desativada'
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

function encerrarServidor(sinal) {
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

  setTimeout(() => {
    console.error(
      '[Servidor] Encerramento forçado após 10 segundos.'
    );

    process.exit(1);
  }, 10000).unref();
}

process.once(
  'SIGTERM',

  () => encerrarServidor(
    'SIGTERM'
  )
);

process.once(
  'SIGINT',

  () => encerrarServidor(
    'SIGINT'
  )
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
  processarWebhookWhatsApp,
  assinaturaWebhookValida,
  CONFIG,
};