'use strict';

// ============================================================
// server.js — SERVIDOR, CRON, DISPARO MANUAL E WEBHOOK WHATSAPP
// ============================================================

require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const express = require('express');
const cron = require('node-cron');

const {
  executarEnvioDiario,
  existeExecucaoEmAndamento,
} = require('./enviar_todos.js');

const { processarNotificacaoSeguranca } = require('./security_notifications.js');
const { validarAssinaturaPortal } = require('./portal_hmac.js');
const { exigirConfiguracaoValida } = require('./config_validation.js');

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

  return ['1', 'true', 'sim', 'yes', 'on'].includes(
    valor.toLowerCase()
  );
}

function numeroInteiroPositivo(valor, padrao) {
  const numero = Number.parseInt(String(valor ?? ''), 10);

  return Number.isInteger(numero) && numero > 0
    ? numero
    : padrao;
}

const CONFIG = Object.freeze({
  porta: numeroInteiroPositivo(process.env.PORT, 3000),

  timezone: textoEnv(
    'APP_TIMEZONE',
    'America/Sao_Paulo'
  ),

  cronAtivo: booleanoEnv('CRON_ATIVO', true),

  cronHorario: textoEnv(
    'CRON_HORARIO',
    '0 8 * * *'
  ),

  chaveDisparoManual: textoEnv(
    'CHAVE_DISPARO_MANUAL'
  ),

  permitirDisparoManualGet: booleanoEnv(
    'PERMITIR_DISPARO_MANUAL_GET',
    false
  ),

  jsonLimite: textoEnv(
    'SERVIDOR_JSON_LIMITE',
    '32kb'
  ),

  webhookRota: '/webhook/whatsapp',

  webhookVerifyToken: textoEnv(
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN'
  ),

  metaAppSecret: textoEnv('META_APP_SECRET'),

  webhookValidarAssinatura: booleanoEnv(
    'WHATSAPP_WEBHOOK_VALIDAR_ASSINATURA',
    true
  ),

  webhookJsonLimite: textoEnv(
    'WHATSAPP_WEBHOOK_JSON_LIMITE',
    '3mb'
  ),

  // Ajustes HTTP para reduzir falsos Down/ECONNRESET em
  // verificadores externos e proxies reversos.
  keepAliveTimeoutMs: numeroInteiroPositivo(
    process.env.SERVIDOR_KEEP_ALIVE_TIMEOUT_MS,
    65000
  ),

  keepAliveBufferMs: numeroInteiroPositivo(
    process.env.SERVIDOR_KEEP_ALIVE_BUFFER_MS,
    5000
  ),

  headersTimeoutMs: numeroInteiroPositivo(
    process.env.SERVIDOR_HEADERS_TIMEOUT_MS,
    75000
  ),

  requestTimeoutMs: numeroInteiroPositivo(
    process.env.SERVIDOR_REQUEST_TIMEOUT_MS,
    900000
  ),

  shutdownTimeoutMs: numeroInteiroPositivo(
    process.env.SERVIDOR_SHUTDOWN_TIMEOUT_MS,
    25000
  ),

  portalInternalHmacSecret: textoEnv(
    'PORTAL_INTERNAL_HMAC_SECRET'
  ),

  portalInternalMaxSkewSeconds: numeroInteiroPositivo(
    process.env.PORTAL_INTERNAL_MAX_SKEW_SECONDS,
    300
  ),
});

// ============================================================
// ESTADO EM MEMÓRIA
// ============================================================

const estado = {
  iniciadoEm: new Date().toISOString(),
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
    falhasRecentes: [],
  },
};

let servidorHttp = null;
let tarefaCron = null;
let encerramentoIniciado = false;

// ============================================================
// EXPRESS
// ============================================================

const app = express();

app.disable('x-powered-by');
app.disable('etag');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, max-age=0'
  );

  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  next();
});

// ============================================================
// ENDPOINT DE SAÚDE LEVE
// ============================================================
//
// Não consulta Airtable, SMTP ou Meta.
//
// Use esta rota no UptimeRobot:
//
// https://emails-diarios-itrengenharia.onrender.com/health

app.head('/health', (req, res) => {
  return res.status(200).end();
});

app.get('/health', (req, res) => {
  res.type('text/plain; charset=utf-8');

  return res
    .status(200)
    .send('OK');
});

// O webhook precisa guardar os bytes originais para validar
// X-Hub-Signature-256 com HMAC-SHA256 (enviar dados de forma eficiente).

const webhookJsonParser = express.json({
  limit: CONFIG.webhookJsonLimite,
  strict: true,

  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  },
});


const portalInternalJsonParser = express.json({
  limit: '16kb',
  strict: true,
  verify: (req, res, buffer) => {
    req.portalRawBody = Buffer.from(buffer);
  },
});

const noncesPortal = new Map();

function assinaturaPortalValida(req) {
  return validarAssinaturaPortal({
    secretBase64: CONFIG.portalInternalHmacSecret,
    timestamp: req.get('x-itr-timestamp'),
    nonce: req.get('x-itr-nonce'),
    signature: req.get('x-itr-signature'),
    rawBody: Buffer.isBuffer(req.portalRawBody) ? req.portalRawBody : Buffer.from(''),
    maxSkewSeconds: CONFIG.portalInternalMaxSkewSeconds,
    nonceStore: noncesPortal,
  });
}

// ============================================================
// AUXILIARES
// ============================================================

function agoraEmBrasilia() {
  return new Date().toLocaleString(
    'pt-BR',
    {
      timeZone: CONFIG.timezone,
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

function compararSegredos(recebido, esperado) {
  const valorRecebido = String(recebido || '');
  const valorEsperado = String(esperado || '');

  if (!valorRecebido || !valorEsperado) {
    return false;
  }

  const bufferRecebido = Buffer.from(valorRecebido);
  const bufferEsperado = Buffer.from(valorEsperado);

  if (
    bufferRecebido.length !==
    bufferEsperado.length
  ) {
    return false;
  }
// Use timingSafeEqual para evitar ataques de tempo
  return crypto.timingSafeEqual(
    bufferRecebido,
    bufferEsperado
  );
}

function somenteDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}
//Mascarando telefone para garantir que é um número válido
function mascararTelefone(valor) {
  const digitos = somenteDigitos(valor);

  if (!digitos) {
    return null;
  }

  if (digitos.length <= 4) {
    return '*'.repeat(digitos.length);
  }

  const prefixo = digitos.slice(
    0,
    Math.min(4, digitos.length - 4)
  );

  return (
    `${prefixo}` +
    `*****` +
    `${digitos.slice(-4)}`
  );
}

function mascararIdentificador(valor) {
  const texto = String(valor || '').trim();

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
  const segundos = Number(valor);

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
  const xApiKey = req.get('x-api-key');

  if (xApiKey) {
    return String(xApiKey).trim();
  }

  const authorization = req.get('authorization');

  if (
    authorization &&
    /^Bearer\s+/i.test(authorization)
  ) {
    return authorization
      .replace(/^Bearer\s+/i, '')
      .trim();
  }

  // Segredos nunca são aceitos por query string ou corpo.
  // Isso evita vazamento em histórico, proxy, observabilidade e logs.
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
    ok: resultado.ok,
    executado: resultado.executado,
    motivo: resultado.motivo,
    inicio: resultado.inicio,
    fim: resultado.fim,
    duracaoMs: resultado.duracaoMs,
    clientesEncontrados:
      resultado.clientesEncontrados,
    ordensEncontradas:
      resultado.ordensEncontradas,
    ordensProcessadas:
      resultado.ordensProcessadas,
    ordensSemLinhas:
      resultado.ordensSemLinhas,
    email: resultado.email,
    whatsapp: resultado.whatsapp,
  };
}

function resumoSeguroWebhook() {
  return {
    configurado:
      Boolean(CONFIG.webhookVerifyToken),

    validarAssinatura:
      CONFIG.webhookValidarAssinatura,

    appSecretConfigurado:
      Boolean(CONFIG.metaAppSecret),

    rota:
      CONFIG.webhookRota,

    totalRecebidos:
      estado.webhook.totalRecebidos,

    totalMensagensRecebidas:
      estado.webhook.totalMensagensRecebidas,

    totalStatusRecebidos:
      estado.webhook.totalStatusRecebidos,

    totalTemplatesRecebidos:
      estado.webhook.totalTemplatesRecebidos,

    totalOutrosEventos:
      estado.webhook.totalOutrosEventos,

    ultimoRecebidoEm:
      estado.webhook.ultimoRecebidoEm,

    ultimoEvento:
      estado.webhook.ultimoEvento,

    ultimoErro:
      estado.webhook.ultimoErro,

    falhasRecentes:
      estado.webhook.falhasRecentes,
  };
}
//Validar assinatura do webhook do WhatsApp utilizando máscara HMAC-SHA256
function assinaturaWebhookValida(req) {
  if (!CONFIG.webhookValidarAssinatura) {
    return true;
  }

  if (!CONFIG.metaAppSecret) {
    return false;
  }

  const assinaturaRecebida =
    req.get('x-hub-signature-256') || '';

  if (
    !/^sha256=[a-f0-9]{64}$/i.test(
      assinaturaRecebida
    )
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
    assinaturaRecebida.toLowerCase(),
    assinaturaEsperada.toLowerCase()
  );
}

function registrarEventoWebhook(tipo, dados) {
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

  estado.webhook.ultimoErro = resumo;

  console.error(
    `[Webhook WhatsApp] Erro: ` +
    `${resumo.mensagem}`
  );
}

// ============================================================
// PROCESSAMENTO DOS EVENTOS DO WHATSAPP
// ============================================================

function tratarStatusMensagem(status) {
  estado.webhook.totalStatusRecebidos += 1;

  const erros =
    Array.isArray(status?.errors)
      ? status.errors.map(item => ({
          codigo:
            item?.code ?? null,

          subcodigo:
            item?.error_subcode ??
            item?.error_data
              ?.error_subcode ??
            null,

          titulo:
            item?.title ?? null,

          mensagem:
            item?.message ?? null,

          detalhes:
            item?.error_data
              ?.details ?? null,
        }))
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

  if (
    resumo.status === 'failed' ||
    erros.length > 0
  ) {
    const falha = {
      recebidoEm:
        new Date().toISOString(),
      ...resumo,
    };

    estado.webhook.falhasRecentes.push(
      falha
    );

    if (
      estado.webhook.falhasRecentes.length > 20
    ) {
      estado.webhook.falhasRecentes.splice(
        0,
        estado.webhook.falhasRecentes.length - 20
      );
    }

    if (erros.length === 0) {
      console.error(
        `[Webhook WhatsApp/Meta] ` +
        `falha sem detalhes retornados pela Meta; ` +
        `mensagem=${resumo.messageId || '-'}; ` +
        `destino=${resumo.destinatario || '-'}.`
      );
    }

    for (const erro of erros) {
      console.error(
        `[Webhook WhatsApp/Meta] ` +
        `code=${erro.codigo ?? '-'}; ` +
        `subcode=${erro.subcodigo ?? '-'}; ` +
        `title=${erro.titulo || '-'}; ` +
        `message=${erro.mensagem || '-'}; ` +
        `details=${erro.detalhes || '-'}; ` +
        `mensagem=${resumo.messageId || '-'}; ` +
        `destino=${resumo.destinatario || '-'}.`
      );
    }
  }
}

function tratarMensagemRecebida(mensagem) {
  estado.webhook.totalMensagensRecebidas += 1;

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
    `id: ${resumo.messageId || 'não informado'}.`
  );
}

function tratarAtualizacaoTemplate(valor) {
  estado.webhook.totalTemplatesRecebidos += 1;

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
    `idioma: ${resumo.idioma || 'não informado'}; ` +
    `evento: ${resumo.evento}; ` +
    `motivo: ${resumo.motivo || 'não informado'}.`
  );
}

async function processarWebhookWhatsApp(payload) {
  const entradas =
    Array.isArray(payload?.entry)
      ? payload.entry
      : [];

  for (const entrada of entradas) {
    const alteracoes =
      Array.isArray(entrada?.changes)
        ? entrada.changes
        : [];

    for (const alteracao of alteracoes) {
      const campo = String(
        alteracao?.field ||
        'desconhecido'
      );

      const valor =
        alteracao?.value || {};

      if (campo === 'messages') {
        const mensagens =
          Array.isArray(valor?.messages)
            ? valor.messages
            : [];

        const statuses =
          Array.isArray(valor?.statuses)
            ? valor.statuses
            : [];

        for (const mensagem of mensagens) {
          tratarMensagemRecebida(
            mensagem
          );
        }

        for (const status of statuses) {
          tratarStatusMensagem(
            status
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

      estado.webhook.totalOutrosEventos += 1;

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

app.get(
  CONFIG.webhookRota,

  (req, res) => {
    const modo = String(
      req.query?.['hub.mode'] || ''
    );

    const tokenRecebido = String(
      req.query?.['hub.verify_token'] || ''
    );

    const desafio =
      req.query?.['hub.challenge'];

    if (!CONFIG.webhookVerifyToken) {
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
      .send(String(desafio ?? ''));
  }
);

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

    if (!assinaturaWebhookValida(req)) {
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

    estado.webhook.totalRecebidos += 1;

    estado.webhook.ultimoRecebidoEm =
      new Date().toISOString();

    // Responde imediatamente para evitar
    // reentregas da Meta.

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

// Endpoint interno usado exclusivamente pelo Portal ITR para mensagens de segurança.
// O corpo é autenticado com HMAC, timestamp curto e nonce de uso único.
app.post(
  '/internal/portal/security-notification',
  portalInternalJsonParser,
  async (req, res) => {
    const auth = assinaturaPortalValida(req);
    if (!auth.ok) {
      if (auth.status === 503) console.error('[Portal Segurança] PORTAL_INTERNAL_HMAC_SECRET ausente ou inválido.');
      else console.warn(`[Portal Segurança] Requisição interna recusada: ${auth.motivo}.`);
      return res.status(auth.status).json({ ok:false, motivo:auth.motivo });
    }
    try {
      const resultado = await processarNotificacaoSeguranca(req.body);
      return res.status(200).json(resultado);
    } catch (erro) {
      console.error(`[Portal Segurança] Falha na notificação: ${erro.message}`);

      if (erro?.status === 422) {
        return res
          .status(422)
          .json({
            ok: false,
            motivo: 'payload-invalido',
          });
      }

      return res
        .status(503)
        .json({
          ok: false,
          motivo: erro?.code === 'SECURITY_EMAIL_TEST_MODE_ACTIVE'
            ? 'modo-teste-email-ativo'
            : 'notification-unavailable',
        });
    }
  }
);

// Parsers das demais rotas.
//
// Permanecem depois do webhook e do endpoint interno porque ambos dependem
// dos bytes originais para validar HMAC.

app.use(
  express.json({
    limit: CONFIG.jsonLimite,
    strict: true,
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
// SAÚDE, STATUS E ARQUIVOS PÚBLICOS
// ============================================================

app.get(
  '/assets/logo-whatsapp.jpeg',

  (req, res, next) => {
    res.setHeader(
      'Cache-Control',
      'public, max-age=86400'
    );

    res.sendFile(
      'assets/logo-whatsapp.jpeg',

      {
        root: __dirname,
      },

      erro => {
        if (erro) {
          next(erro);
        }
      }
    );
  }
);

app.get('/', (req, res) => {
  return res
    .status(200)
    .json({
      ok: true,
      servico: 'ITR Engenharia — E-mails e WhatsApp',
      health: '/health',
    });
});

function statusAutorizado(req) {
  return Boolean(CONFIG.chaveDisparoManual) && requisicaoAutorizada(req);
}

app.head('/status', (req, res) => {
  if (!statusAutorizado(req)) return res.status(401).end();
  return res.status(200).end();
});

app.get('/status', (req, res) => {
  if (!statusAutorizado(req)) {
    return res.status(401).json({
      ok: false,
      motivo: 'nao-autorizado',
      mensagem: 'Autenticação obrigatória.',
    });
  }

  return res
    .status(200)
    .json({
      ok: true,
      execucaoEmAndamento: existeExecucaoEmAndamento(),
      ultimaExecucaoIniciadaEm: estado.ultimaExecucaoIniciadaEm,
      ultimaExecucaoFinalizadaEm: estado.ultimaExecucaoFinalizadaEm,
      ultimaOrigem: estado.ultimaOrigem,
      ultimoResultado: estado.ultimoResultado,
      ultimoErro: estado.ultimoErro,
      webhook: resumoSeguroWebhook(),
    });
});

// ============================================================
// DISPARO MANUAL
// ============================================================

async function rotaDisparoManual(req, res) {
  if (!CONFIG.chaveDisparoManual) {
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

  if (!requisicaoAutorizada(req)) {
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

  if (existeExecucaoEmAndamento()) {
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

  const origem =
    req.method === 'POST'
      ? 'manual-post'
      : 'manual-get';

  // Inicia o processamento e responde imediatamente. O andamento e o
  // resultado final ficam disponíveis em /status. Isso evita manter uma
  // conexão HTTP aberta durante todo o lote.
  const execucao =
    executarControlado({
      origem,
      ignorarData,
    });

  execucao.catch(erro => {
    console.error(
      `[Servidor] Falha no disparo manual em segundo plano: ` +
      `${erro?.message || erro}`
    );
  });

  return res
    .status(202)
    .json({
      ok: true,
      executado: true,
      iniciado: true,
      ignorarData,
      status: '/status',
      mensagem:
        'Processamento iniciado. Consulte /status para acompanhar.',
    });
}

app.post(
  '/disparar-agora',
  rotaDisparoManual
);

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
  return res
    .status(404)
    .json({
      ok: false,
      motivo:
        'rota-nao-encontrada',
      mensagem:
        'Rota não encontrada.',
    });
});

app.use((erro, req, res, next) => {
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
});

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

  if (!cron.validate(CONFIG.cronHorario)) {
    throw new Error(
      `CRON_HORARIO inválido: ` +
      `"${CONFIG.cronHorario}".`
    );
  }

  const tarefa = cron.schedule(
    CONFIG.cronHorario,

    async () => {
      if (existeExecucaoEmAndamento()) {
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
    `no fuso ` +
    `"${CONFIG.timezone}".`
  );

  return tarefa;
}

// ============================================================
// INICIALIZAÇÃO E AJUSTES HTTP
// ============================================================

function configurarServidorHttp(servidor) {
  servidor.keepAliveTimeout =
    CONFIG.keepAliveTimeoutMs;

  servidor.headersTimeout =
    Math.max(
      CONFIG.headersTimeoutMs,

      CONFIG.keepAliveTimeoutMs +
      CONFIG.keepAliveBufferMs +
      1000
    );

  servidor.requestTimeout =
    CONFIG.requestTimeoutMs;

  // Node recente:
  //
  // Mantém o socket interno aberto alguns segundos além do
  // valor anunciado no Keep-Alive.

  if (
    'keepAliveTimeoutBuffer' in
    servidor
  ) {
    servidor.keepAliveTimeoutBuffer =
      CONFIG.keepAliveBufferMs;
  }

  servidor.on(
    'connection',

    socket => {
      socket.setNoDelay(true);

      socket.setKeepAlive(
        true,
        30000
      );
    }
  );

  servidor.on(
    'clientError',

    (erro, socket) => {
      console.warn(
        `[Servidor] Requisição HTTP inválida: ` +
        `${erro?.code || erro?.message || erro}`
      );

      if (
        socket?.writable &&
        !socket.destroyed
      ) {
        socket.end(
          'HTTP/1.1 400 Bad Request\r\n' +
          'Connection: close\r\n' +
          'Content-Length: 0\r\n' +
          '\r\n'
        );
      }
    }
  );
}

function iniciarServidor() {
  if (servidorHttp) {
    return servidorHttp;
  }

  const validacao = exigirConfiguracaoValida(process.env);
  for (const aviso of validacao.avisos) {
    console.warn(`[Configuração] ${aviso}`);
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
          'Health check: /health'
        );

        console.log(
          `Keep-alive HTTP: ` +
          `${CONFIG.keepAliveTimeoutMs} ms`
        );

        console.log(
          '========================================'
        );

        console.log('');
      }
    );

  configurarServidorHttp(
    servidorHttp
  );

  return servidorHttp;
}

// ============================================================
// ENCERRAMENTO CONTROLADO
// ============================================================

function dormirEncerramento(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function encerrarServidor(sinal) {
  if (encerramentoIniciado) {
    return;
  }

  encerramentoIniciado = true;

  const iniciadoEm = Date.now();
  const limiteEm =
    iniciadoEm + CONFIG.shutdownTimeoutMs;

  console.log(
    `[Servidor] Recebido ${sinal}. Encerramento gracioso iniciado...`
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

  let servidorFechado = !servidorHttp;
  let erroFechamento = null;
  let resolverFechamento;

  const fechamentoHttp = new Promise(resolve => {
    resolverFechamento = resolve;
  });

  if (servidorHttp) {
    servidorHttp.close(erro => {
      erroFechamento = erro || null;
      servidorFechado = !erro;
      resolverFechamento();
    });

    // Fecha somente conexões ociosas; requisições ativas podem terminar.
    if (
      typeof servidorHttp.closeIdleConnections ===
      'function'
    ) {
      servidorHttp.closeIdleConnections();
    }
  } else {
    resolverFechamento();
  }

  // O cron não mantém uma conexão HTTP aberta. Por isso o encerramento
  // aguarda explicitamente o lote em andamento, sem ultrapassar um único
  // orçamento total de shutdown.
  while (
    Date.now() < limiteEm &&
    (
      existeExecucaoEmAndamento() ||
      !servidorFechado
    )
  ) {
    await dormirEncerramento(250);
  }

  const execucaoConcluida =
    !existeExecucaoEmAndamento();

  if (!execucaoConcluida) {
    console.error(
      `[Servidor] A execução em andamento não terminou em ` +
      `${CONFIG.shutdownTimeoutMs} ms.`
    );
  }

  if (!servidorFechado && servidorHttp) {
    console.error(
      '[Servidor] O HTTP não encerrou dentro do limite; fechando conexões restantes.'
    );

    if (
      typeof servidorHttp.closeAllConnections ===
      'function'
    ) {
      servidorHttp.closeAllConnections();
    }

    await Promise.race([
      fechamentoHttp,
      dormirEncerramento(250),
    ]);
  }

  if (erroFechamento) {
    console.error(
      `[Servidor] Erro no encerramento HTTP: ` +
      `${erroFechamento.message}`
    );
  }

  if (
    execucaoConcluida &&
    !erroFechamento
  ) {
    console.log(
      '[Servidor] Encerrado corretamente.'
    );

    process.exit(0);
    return;
  }

  console.error(
    '[Servidor] Encerramento terminou de forma forçada/incompleta.'
  );

  process.exit(1);
}

process.once('SIGTERM', () => {
  void encerrarServidor('SIGTERM');
});

process.once('SIGINT', () => {
  void encerrarServidor('SIGINT');
});

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
  configurarServidorHttp,
  processarWebhookWhatsApp,
  assinaturaWebhookValida,
  CONFIG,
};