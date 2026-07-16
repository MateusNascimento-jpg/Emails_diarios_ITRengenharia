// ============================================================
//  enviar_email.js  -  ENVIO VIA SMTP (nodemailer)
// ------------------------------------------------------------
//  - configura o transporte SMTP a partir do .env
//  - SEGURANCA: se EMAIL_MODO_TESTE estiver preenchido, TODOS
//    os emails vao para esse endereco (nao para os clientes).
// ============================================================

require('dotenv').config();
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const MODO_TESTE = (process.env.EMAIL_MODO_TESTE || '').trim();
const REMETENTE = process.env.EMAIL_REMETENTE || 'ITR Engenharia <naoresponda@itr.eng.br>';

// caminho do logo embutido no email (inline via cid:logoITR)
const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');
const LOGO_EXISTE = fs.existsSync(LOGO_PATH);

if (!LOGO_EXISTE) {
  console.warn(`[AVISO] Logo NAO encontrado em: ${LOGO_PATH}`);
  console.warn('        Os emails serao enviados SEM o logo.');
  console.warn('        Crie a pasta "assets" e coloque o arquivo "logo.png" dentro dela.');
}

// cria o transporte SMTP uma vez
function criarTransporte() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Faltam SMTP_HOST, SMTP_USER ou SMTP_PASS no .env');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = SSL; 587 = STARTTLS
    auth: { user, pass },
  });
}

// testa a conexao SMTP sem enviar nada
async function verificarConexao() {
  const t = criarTransporte();
  await t.verify();
  return true;
}

// helper: normaliza "para" (array OU string) num ARRAY de e-mails limpos.
// aceita array vindo do airtable.js (cliente.emails) ou string antiga.
function normalizarPara(para) {
  if (Array.isArray(para)) {
    return para.map(e => String(e).trim()).filter(Boolean);
  }
  if (typeof para === 'string') {
    return para.split(/[;,]/).map(e => e.trim()).filter(Boolean);
  }
  return [];
}

// ------------------------------------------------------------
// enviar({ para, assunto, html, texto })
//   'para' pode ser array de e-mails OU string (compat).
//   Respeita o MODO_TESTE: se ligado, redireciona tudo.
// ------------------------------------------------------------
async function enviar({ para, assunto, html, texto }) {
  const transporte = criarTransporte();

  // lista real de destinatarios (array)
  const listaReal = normalizarPara(para);

  // rotulo legivel dos destinatarios reais (p/ assunto no modo teste)
  const rotuloReal = listaReal.join(', ');

  // destino final: no modo teste, tudo vai pro e-mail de teste
  const destino = MODO_TESTE ? MODO_TESTE : listaReal;

  const assuntoFinal = MODO_TESTE
    ? `[TESTE -> ${rotuloReal || 'sem-destino'}] ${assunto}`
    : assunto;

  // sem destinatario real (e sem modo teste) => nao envia
  if (!MODO_TESTE && listaReal.length === 0) {
    return { ok: false, motivo: 'sem-destino' };
  }

  // anexa o logo inline (referenciado no HTML por cid:logoITR)
  const attachments = [];
  if (LOGO_EXISTE) {
    attachments.push({
      filename: 'logo.png',
      path: LOGO_PATH,
      cid: 'logoITR', // deve bater com o src="cid:logoITR" do template
    });
  }
// envia o email automaticamente via SMTP (nodemailer) 
  const info = await transporte.sendMail({
    from: REMETENTE,
    to: destino,        // array (varios destinatarios) ou string (modo teste)
    subject: assuntoFinal,
    text: texto,
    html,
    attachments,
  });

  return { ok: true, id: info.messageId, destino };
}

module.exports = { enviar, verificarConexao, MODO_TESTE };