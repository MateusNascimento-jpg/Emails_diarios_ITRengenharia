'use strict';

require('dotenv').config({ quiet: true });
const { enviar } = require('./enviar_email.js');
const { montarEmailSeguranca, DEFINICOES } = require('./security_email_template.js');
const { enviarAvisoSegurancaWhatsApp } = require('./security_whatsapp.js');
const { emailAcessoValido, actionUrlValida } = require('./security_validation.js');

const portalOrigin = String(process.env.PORTAL_ORIGIN || 'https://portal.itr.eng.br').trim().replace(/\/+$/, '');

function erroPayload(mensagem) {
  return Object.assign(
    new Error(mensagem),
    {
      status: 422,
      code: 'INVALID_SECURITY_NOTIFICATION_PAYLOAD',
    }
  );
}

function emailModoTesteBloqueiaSeguranca() {
  return (
    String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' &&
    Boolean(String(process.env.EMAIL_MODO_TESTE || '').trim())
  );
}

async function processarNotificacaoSeguranca(payload) {
  if (emailModoTesteBloqueiaSeguranca()) {
    throw Object.assign(
      new Error(
        'EMAIL_MODO_TESTE está ativo em produção; notificações de segurança foram bloqueadas.'
      ),
      {
        status: 503,
        code: 'SECURITY_EMAIL_TEST_MODE_ACTIVE',
      }
    );
  }

  const type = String(payload?.type || '');
  if (!DEFINICOES[type]) throw erroPayload('Tipo de notificação não permitido.');

  const email = emailAcessoValido(payload?.client?.email);
  if (!email) throw erroPayload('E-mail de acesso inválido.');

  if (!actionUrlValida(type, payload?.actionUrl, portalOrigin)) {
    throw erroPayload('Link de ação inválido.');
  }

  const client = {
    name: String(payload?.client?.name || 'Cliente').trim().slice(0, 160),
    cnpj: String(payload?.client?.cnpj || '').replace(/\D/g, '').slice(0, 14),
    email,
    whatsapp: String(payload?.client?.whatsapp || '').trim().slice(0, 40) || null,
  };

  const conteudo = montarEmailSeguranca({
    type,
    client,
    actionUrl: payload?.actionUrl || null,
    portalOrigin,
  });

  const emailResultado = await enviar({ para: [email], ...conteudo });
  if (!emailResultado?.ok) {
    throw new Error('SMTP não confirmou o envio da notificação de segurança.');
  }

  let whatsapp = { ok: true, ignorado: true };
  try {
    whatsapp = await enviarAvisoSegurancaWhatsApp({ type, client });
  } catch (error) {
    console.warn(`[Segurança WhatsApp] Aviso não enviado: ${error.message}`);
    whatsapp = { ok: false, ignorado: false };
  }

  return {
    ok: true,
    email: { ok: true },
    whatsapp: {
      ok: Boolean(whatsapp?.ok),
      ignorado: Boolean(whatsapp?.ignorado),
    },
  };
}

module.exports = {
  processarNotificacaoSeguranca,
  actionUrlValida: (type, valor) => actionUrlValida(type, valor, portalOrigin),
  emailValido: emailAcessoValido,
};
