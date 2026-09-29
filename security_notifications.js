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

  const suppliedType = String(payload?.type || '');
  const type = suppliedType === 'ACCESS_CREDENTIALS' ? 'ACCESS_REQUEST' : suppliedType;
  if (!DEFINICOES[type]) throw erroPayload('Tipo de notificação não permitido.');

  const recipients = require('./lib/portal-access').emails(type === 'ACCESS_REQUEST' ? payload?.client?.emails : payload?.client?.email);
  const email = recipients[0];
  const accessPassword = String(payload?.client?.accessPassword || '');
  if (type === 'ACCESS_REQUEST' && (!accessPassword || accessPassword.length > 128 || /[\r\n]/.test(accessPassword))) throw erroPayload('Credencial de acesso inválida.');
  if (!email) throw erroPayload('E-mail de acesso inválido.');
  if (type === 'ACCESS_REQUEST' && String(payload?.client?.cnpj || '').replace(/\D/g, '').length !== 14) throw erroPayload('CNPJ de acesso inválido.');

  if (!actionUrlValida(type, payload?.actionUrl, portalOrigin)) {
    throw erroPayload('Link de ação inválido.');
  }

  const client = {
    name: String(payload?.client?.name || 'Cliente').trim().slice(0, 160),
    cnpj: String(payload?.client?.cnpj || '').replace(/\D/g, '').slice(0, 14),
    email,
    accessPassword,
    whatsapp: String(payload?.client?.whatsapp || '').trim().slice(0, 4000) || null,
  };

  const conteudo = montarEmailSeguranca({
    type,
    client,
    actionUrl: payload?.actionUrl || null,
    portalOrigin,
  });

  let falhas = 0;
  for (const recipient of recipients) {
    try { const result = await enviar({ para: [recipient], ...conteudo }); if (!result?.ok) falhas++; }
    catch (_) { falhas++; }
  }
  if (falhas) throw new Error(`SMTP não confirmou ${falhas} destinatário(s). Todos foram tentados.`);

  let whatsapp = { ok: true, ignorado: true };
  try {
    whatsapp = type === 'ACCESS_REQUEST' ? { ok: true, ignorado: true } : await enviarAvisoSegurancaWhatsApp({ type, client });
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
