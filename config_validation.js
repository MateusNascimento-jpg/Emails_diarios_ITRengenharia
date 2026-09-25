'use strict';

function texto(env, nome, padrao = '') {
  return String(env?.[nome] ?? padrao).trim();
}

function booleano(env, nome, padrao = false) {
  const valor = texto(env, nome);
  if (!valor) return padrao;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(valor.toLowerCase());
}


function placeholderEnv(valor) {
  const v = String(valor ?? '').trim();
  if (!v) return false;
  return /^<[^>]+>$/.test(v) || /^(preencher|changeme|change_me|todo|tbd)$/i.test(v);
}

function contemMojibake(valor) {
  const v = String(valor ?? '');
  return /(?:Ã.|Â.|â€|ï¿½|�)/.test(v);
}

function segredoTextoForte(valor, minChars = 32) {
  const v = String(valor ?? '').trim();
  if (v.length < minChars) return false;
  if (/^(.)\1+$/.test(v)) return false;
  return true;
}

function emailValido(valor) {
  const v = String(valor || '').trim();
  return v.length > 0 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function segredoBase64Valido(valor, minBytes = 32) {
  const v = String(valor || '').trim();
  if (!v || !/^[A-Za-z0-9+/]+={0,2}$/.test(v) || v.length % 4 !== 0) return false;
  try {
    const buffer = Buffer.from(v, 'base64');
    if (buffer.length < minBytes) return false;
    return buffer.toString('base64').replace(/=+$/, '') === v.replace(/=+$/, '');
  } catch (_) {
    return false;
  }
}

function urlHttpsValida(valor, { permitirPath = true } = {}) {
  try {
    const url = new URL(String(valor || ''));
    if (url.protocol !== 'https:' || !url.hostname) return false;
    if (!permitirPath && url.pathname !== '/') return false;
    return true;
  } catch (_) {
    return false;
  }
}

function dataHoraComFusoValida(valor) {
  const v = String(valor || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) {
    return false;
  }
  return Number.isFinite(Date.parse(v));
}

function inteiroNoIntervalo(valor, minimo, maximo) {
  const numero = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(numero) && numero >= minimo && numero <= maximo;
}

function cronBasicoValido(valor) {
  const partes = String(valor || '').trim().split(/\s+/).filter(Boolean);
  return partes.length === 5 || partes.length === 6;
}

function validarConfiguracao(env = process.env, { estrito = true } = {}) {
  const erros = [];
  const avisos = [];

  const cronAtivo = booleano(env, 'CRON_ATIVO', true);
  const emailAtivo = booleano(env, 'EMAIL_ATIVO', true);
  const whatsappAtivo = booleano(env, 'WHATSAPP_ATIVO', false);
  const whatsappSimular = booleano(env, 'WHATSAPP_SIMULAR', true);
  const whatsappModoTeste = booleano(env, 'WHATSAPP_MODO_TESTE', true);
  const whatsappExigirEmailEnviado =
    booleano(env, 'WHATSAPP_EXIGIR_EMAIL_ENVIADO', true);
  const portalWhatsappAtivo = booleano(env, 'PORTAL_SECURITY_WHATSAPP_ENABLED', false);
  const webhookValidarAssinatura = booleano(env, 'WHATSAPP_WEBHOOK_VALIDAR_ASSINATURA', true);
  const permitirGetManual = booleano(env, 'PERMITIR_DISPARO_MANUAL_GET', false);
  const idempotenciaAtiva = booleano(env, 'IDEMPOTENCIA_ATIVA', false);

  for (const [nome, valor] of Object.entries(env || {})) {
    if (placeholderEnv(valor)) {
      erros.push(`${nome} ainda contém placeholder; deixe vazio ou configure o valor real.`);
    }
  }

  const nomesAirtableTextuais = Object.keys(env || {}).filter(nome =>
    nome.startsWith('AIRTABLE_CAMPO_') || nome === 'AIRTABLE_STATUS_PERMITIDOS'
  );
  for (const nome of nomesAirtableTextuais) {
    if (contemMojibake(env[nome])) {
      erros.push(`${nome} contém texto com encoding corrompido (mojibake). Corrija o nome exatamente como existe no Airtable.`);
    }
  }

  const chaveAdmin = texto(env, 'CHAVE_DISPARO_MANUAL');
  if (!chaveAdmin) {
    avisos.push('CHAVE_DISPARO_MANUAL está vazia; /status e /disparar-agora permanecerão inacessíveis.');
  } else if (!segredoTextoForte(chaveAdmin, 32)) {
    erros.push('CHAVE_DISPARO_MANUAL deve ter pelo menos 32 caracteres e ser aleatória.');
  }

  const modoTesteEmail = texto(env, 'EMAIL_MODO_TESTE');
  if (modoTesteEmail && !emailValido(modoTesteEmail)) {
    erros.push('EMAIL_MODO_TESTE deve ficar vazio ou conter um e-mail válido. Não use false/true/0/1.');
  }

  if (
    texto(env, 'NODE_ENV').toLowerCase() === 'production' &&
    modoTesteEmail &&
    texto(env, 'PORTAL_INTERNAL_HMAC_SECRET')
  ) {
    erros.push(
      'EMAIL_MODO_TESTE não pode ficar ativo em produção enquanto o endpoint de segurança do Portal estiver configurado.'
    );
  }

  const smtpNecessario = emailAtivo || Boolean(texto(env, 'PORTAL_INTERNAL_HMAC_SECRET'));
  if (smtpNecessario) {
    for (const nome of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
      if (!texto(env, nome)) erros.push(`${nome} é obrigatório para o envio de e-mails.`);
    }
    const porta = texto(env, 'SMTP_PORT', '587');
    if (!inteiroNoIntervalo(porta, 1, 65535)) erros.push('SMTP_PORT deve estar entre 1 e 65535.');
  }

  const portalOrigin = texto(env, 'PORTAL_ORIGIN', 'https://portal.itr.eng.br');
  if (!urlHttpsValida(portalOrigin, { permitirPath: false })) {
    erros.push('PORTAL_ORIGIN deve ser uma origem HTTPS sem caminho adicional.');
  }

  const segredoPortal = texto(env, 'PORTAL_INTERNAL_HMAC_SECRET');
  if (segredoPortal && !segredoBase64Valido(segredoPortal, 32)) {
    erros.push('PORTAL_INTERNAL_HMAC_SECRET deve ser Base64 válido com pelo menos 32 bytes.');
  }
  if (!segredoPortal) {
    avisos.push('PORTAL_INTERNAL_HMAC_SECRET está vazio; notificações de segurança do Portal retornarão 503.');
  }

  const skew = texto(env, 'PORTAL_INTERNAL_MAX_SKEW_SECONDS', '300');
  if (!inteiroNoIntervalo(skew, 30, 900)) {
    erros.push('PORTAL_INTERNAL_MAX_SKEW_SECONDS deve ficar entre 30 e 900 segundos.');
  }

  if (cronAtivo) {
    if (!cronBasicoValido(texto(env, 'CRON_HORARIO', '0 8 * * *'))) {
      erros.push('CRON_HORARIO não parece uma expressão cron válida de 5 ou 6 campos.');
    }

    const inicio = texto(env, 'AUTOMACAO_INICIO_EM');
    if (!inicio) {
      erros.push('AUTOMACAO_INICIO_EM é obrigatório quando CRON_ATIVO=true.');
    } else if (!dataHoraComFusoValida(inicio)) {
      erros.push('AUTOMACAO_INICIO_EM deve ser ISO-8601 com fuso explícito, por exemplo 2026-08-01T00:00:00-03:00.');
    }

    for (const nome of ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_ID']) {
      if (!texto(env, nome)) erros.push(`${nome} é obrigatório quando CRON_ATIVO=true.`);
    }
  }

  if (!texto(env, 'AIRTABLE_TABLE_ID')) {
    avisos.push('AIRTABLE_TABLE_ID não foi definido; o fluxo diário não poderá consultar a tabela de trabalhos.');
  }
  if (!texto(env, 'AIRTABLE_OS_TABLE_ID')) {
    avisos.push('AIRTABLE_OS_TABLE_ID não foi definido; a idempotência persistente não poderá operar.');
  }

  if (whatsappAtivo && whatsappSimular) {
    avisos.push('WHATSAPP_ATIVO=true com WHATSAPP_SIMULAR=true: o fluxo é exercitado, mas nenhuma mensagem real é enviada pela Meta.');
  }

  if (whatsappAtivo && !whatsappSimular) {
    for (const nome of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE_NAME']) {
      if (!texto(env, nome)) erros.push(`${nome} é obrigatório quando WHATSAPP_ATIVO=true e WHATSAPP_SIMULAR=false.`);
    }
    if (whatsappModoTeste && !texto(env, 'WHATSAPP_TEST_NUMBER')) {
      erros.push('WHATSAPP_TEST_NUMBER é obrigatório quando WHATSAPP_MODO_TESTE=true.');
    }

    if (!idempotenciaAtiva) {
      const mensagem =
        'WhatsApp real está habilitado sem IDEMPOTENCIA_ATIVA=true.';
      if (estrito) erros.push(mensagem); else avisos.push(mensagem);
    }

    const headerType =
      texto(env, 'WHATSAPP_TEMPLATE_HEADER_TYPE', 'none').toLowerCase();

    if (
      ['image', 'video', 'document'].includes(headerType) &&
      !texto(env, 'WHATSAPP_TEMPLATE_HEADER_MEDIA_ID') &&
      !texto(env, 'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL')
    ) {
      erros.push(
        `WHATSAPP_TEMPLATE_HEADER_TYPE=${headerType} exige WHATSAPP_TEMPLATE_HEADER_MEDIA_ID ou WHATSAPP_TEMPLATE_HEADER_MEDIA_URL.`
      );
    }

    const mediaUrl =
      texto(env, 'WHATSAPP_TEMPLATE_HEADER_MEDIA_URL');

    if (
      mediaUrl &&
      !urlHttpsValida(mediaUrl)
    ) {
      erros.push('WHATSAPP_TEMPLATE_HEADER_MEDIA_URL deve ser uma URL HTTPS válida.');
    }
  }

  if (
    whatsappAtivo &&
    whatsappExigirEmailEnviado &&
    !emailAtivo
  ) {
    const mensagem =
      'WHATSAPP_EXIGIR_EMAIL_ENVIADO=true com EMAIL_ATIVO=false impede todos os WhatsApps do fluxo diário.';
    if (estrito) erros.push(mensagem); else avisos.push(mensagem);
  }

  if (portalWhatsappAtivo) {
    if (!whatsappAtivo) erros.push('PORTAL_SECURITY_WHATSAPP_ENABLED=true exige WHATSAPP_ATIVO=true.');
    if (whatsappSimular) avisos.push('WhatsApp de segurança está habilitado, mas WHATSAPP_SIMULAR=true; nenhum alerta real será enviado.');
    if (!texto(env, 'WHATSAPP_SECURITY_TEMPLATE_NAME')) {
      erros.push('WHATSAPP_SECURITY_TEMPLATE_NAME é obrigatório para alertas de segurança por WhatsApp.');
    }
    if (whatsappModoTeste && !texto(env, 'WHATSAPP_TEST_NUMBER')) {
      erros.push('WhatsApp de segurança em modo teste exige WHATSAPP_TEST_NUMBER.');
    }
  }

  if (webhookValidarAssinatura && texto(env, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN') && !texto(env, 'META_APP_SECRET')) {
    erros.push('META_APP_SECRET é obrigatório quando o webhook está configurado para validar assinatura.');
  }

  if (permitirGetManual) {
    const mensagem = 'PERMITIR_DISPARO_MANUAL_GET=true expõe uma superfície legada; mantenha false em produção.';
    if (estrito) erros.push(mensagem); else avisos.push(mensagem);
  }

  if (idempotenciaAtiva && !texto(env, 'AIRTABLE_OS_TABLE_ID')) {
    erros.push('IDEMPOTENCIA_ATIVA=true exige AIRTABLE_OS_TABLE_ID explícito.');
  }
  if (!idempotenciaAtiva) {
    avisos.push('IDEMPOTENCIA_ATIVA=false: a proteção persistente contra reenvio está desativada.');
  }

  try { require('./integridade_notifications').carregarConfig(env); }
  catch (e) { erros.push(e.message); }

  return {
    ok: erros.length === 0,
    erros,
    avisos,
    resumo: {
      cronAtivo,
      emailAtivo,
      emailModoTeste: modoTesteEmail ? 'ATIVO' : 'DESATIVADO',
      whatsappAtivo,
      whatsappSimular,
      whatsappModoTeste,
      whatsappExigirEmailEnviado,
      portalHmacConfigurado: Boolean(segredoPortal),
      portalWhatsappAtivo,
      idempotenciaAtiva,
    },
  };
}

function exigirConfiguracaoValida(env = process.env) {
  const resultado = validarConfiguracao(env, { estrito: true });
  if (!resultado.ok) {
    const erro = new Error(`Configuração inválida: ${resultado.erros.join(' | ')}`);
    erro.code = 'INVALID_CONFIGURATION';
    erro.detalhes = resultado.erros.slice();
    throw erro;
  }
  return resultado;
}

module.exports = {
  validarConfiguracao,
  exigirConfiguracaoValida,
  emailValido,
  segredoBase64Valido,
  urlHttpsValida,
  dataHoraComFusoValida,
  placeholderEnv,
  contemMojibake,
  segredoTextoForte,
};
