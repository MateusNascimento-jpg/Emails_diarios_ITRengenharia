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

// ------------------------------------------------------------
// enviar({ para, assunto, html, texto })
//   Respeita o MODO_TESTE: se ligado, redireciona.
// ------------------------------------------------------------
async function enviar({ para, assunto, html, texto }) {
  const transporte = criarTransporte();

  // destino real vs modo teste
  const destino = MODO_TESTE || para;
  const assuntoFinal = MODO_TESTE
    ? `[TESTE -> ${para}] ${assunto}`
    : assunto;

  if (!destino) {
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

  const info = await transporte.sendMail({
    from: REMETENTE,
    to: destino,
    subject: assuntoFinal,
    text: texto,
    html,
    attachments,
  });

  return { ok: true, id: info.messageId, destino };
}

module.exports = { enviar, verificarConexao, MODO_TESTE };