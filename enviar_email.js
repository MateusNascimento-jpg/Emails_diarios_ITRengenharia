'use strict';

// ============================================================
// enviar_email.js — ENVIO SMTP
// ============================================================
// - Configuração validada antes do primeiro envio.
// - EMAIL_MODO_TESTE aceita somente vazio ou um e-mail válido.
// - Um único transporter é reutilizado durante a vida do processo.
// - Destinatários são normalizados, validados e deduplicados.
// ============================================================

require('dotenv').config({ quiet: true });
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const { emailValido } = require('./config_validation.js');

const MODO_TESTE = String(process.env.EMAIL_MODO_TESTE || '').trim();
const REMETENTE = String(process.env.EMAIL_REMETENTE || 'ITR Engenharia <naoresponda@itr.eng.br>').trim();

if (MODO_TESTE && !emailValido(MODO_TESTE)) {
  throw new Error('EMAIL_MODO_TESTE deve ficar vazio ou conter um e-mail válido. Não use false/true/0/1.');
}

const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');
const LOGO_EXISTE = fs.existsSync(LOGO_PATH);

if (!LOGO_EXISTE) {
  console.warn(`[AVISO] Logo não encontrado em: ${LOGO_PATH}. Os e-mails serão enviados sem o logo.`);
}

let transporte = null;

function inteiroPositivoEnv(
  nome,
  padrao
) {
  const numero = Number.parseInt(
    String(
      process.env[nome] ?? ''
    ),
    10
  );

  return (
    Number.isInteger(numero) &&
    numero > 0
  )
    ? numero
    : padrao;
}

function criarTransporte() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');

  if (!host || !user || !pass) {
    throw new Error('Faltam SMTP_HOST, SMTP_USER ou SMTP_PASS.');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT inválida.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    pool: true,
    maxConnections:
      inteiroPositivoEnv(
        'SMTP_MAX_CONNECTIONS',
        3
      ),
    maxMessages:
      inteiroPositivoEnv(
        'SMTP_MAX_MESSAGES_POR_CONEXAO',
        100
      ),
    connectionTimeout:
      inteiroPositivoEnv(
        'SMTP_CONNECTION_TIMEOUT_MS',
        15000
      ),
    greetingTimeout:
      inteiroPositivoEnv(
        'SMTP_GREETING_TIMEOUT_MS',
        10000
      ),
    socketTimeout:
      inteiroPositivoEnv(
        'SMTP_SOCKET_TIMEOUT_MS',
        60000
      ),
    auth: { user, pass },
  });
}

function obterTransporte() {
  if (!transporte) transporte = criarTransporte();
  return transporte;
}

async function verificarConexao() {
  await obterTransporte().verify();
  return true;
}

function normalizarPara(para) {
  const itens = Array.isArray(para)
    ? para
    : (typeof para === 'string' ? para.split(/[;,]/) : []);

  const vistos = new Set();
  const validos = [];

  for (const item of itens) {
    const email = String(item || '').trim().toLowerCase();
    if (!emailValido(email) || vistos.has(email)) continue;
    vistos.add(email);
    validos.push(email);
  }

  return validos;
}

function mascararEmail(valor) {
  const email = String(valor || '').trim();
  const indice = email.lastIndexOf('@');
  if (indice <= 0) return '(e-mail oculto)';

  const local = email.slice(0, indice);
  const dominio = email.slice(indice + 1);
  if (!dominio) return '(e-mail oculto)';

  const visivel = local.slice(0, Math.min(2, local.length));
  return `${visivel}${'*'.repeat(Math.max(3, local.length - visivel.length))}@${dominio}`;
}

function mascararDestinos(destino) {
  const itens = Array.isArray(destino) ? destino : [destino];
  return itens.filter(Boolean).map(mascararEmail);
}

async function enviar({ para, assunto, html, texto }) {
  const listaReal = normalizarPara(para);

  if (!MODO_TESTE && listaReal.length === 0) {
    return { ok: false, motivo: 'sem-destino' };
  }

  const destino = MODO_TESTE ? MODO_TESTE : listaReal;
  const rotuloReal = listaReal.map(mascararEmail).join(', ');
  const assuntoFinal = MODO_TESTE
    ? `[TESTE -> ${rotuloReal || 'sem-destino'}] ${assunto}`
    : assunto;

  const attachments = [];
  if (LOGO_EXISTE) {
    attachments.push({ filename: 'logo.png', path: LOGO_PATH, cid: 'logoITR' });
  }

  const info = await obterTransporte().sendMail({
    from: REMETENTE,
    to: destino,
    subject: assuntoFinal,
    text: texto,
    html,
    attachments,
  });

  return {
    ok: true,
    id: info.messageId,
    destino: Array.isArray(destino) ? destino : [destino],
  };
}

module.exports = {
  enviar,
  verificarConexao,
  normalizarPara,
  mascararEmail,
  mascararDestinos,
  MODO_TESTE,
};
