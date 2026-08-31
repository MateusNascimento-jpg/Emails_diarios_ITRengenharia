'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const { validarConfiguracao } = require('../config_validation.js');
const { validarAssinaturaPortal } = require('../portal_hmac.js');
const { actionUrlValida } = require('../security_validation.js');
const { montarEmailSeguranca } = require('../security_email_template.js');

const ROOT = path.resolve(__dirname, '..');

function assinatura({ secret, timestamp, nonce, body }) {
  return crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${timestamp}.${nonce}.`, 'utf8')
    .update(body)
    .digest('hex');
}

function envBase() {
  return {
    CRON_ATIVO: 'false',
    EMAIL_ATIVO: 'false',
    PORTAL_ORIGIN: 'https://portal.itr.eng.br',
    PORTAL_INTERNAL_MAX_SKEW_SECONDS: '300',
    PERMITIR_DISPARO_MANUAL_GET: 'false',
    IDEMPOTENCIA_ATIVA: 'false',
  };
}

test('EMAIL_MODO_TESTE rejeita false/true/texto e aceita vazio ou e-mail', () => {
  for (const invalido of ['false', 'true', '0', '1', 'teste']) {
    const r = validarConfiguracao({ ...envBase(), EMAIL_MODO_TESTE: invalido });
    assert.equal(r.ok, false, invalido);
    assert.match(r.erros.join(' '), /EMAIL_MODO_TESTE/);
  }

  assert.equal(validarConfiguracao({ ...envBase(), EMAIL_MODO_TESTE: '' }).ok, true);
  assert.equal(validarConfiguracao({ ...envBase(), EMAIL_MODO_TESTE: 'qa@itr.eng.br' }).ok, true);
});





test('preflight bloqueia GET manual e exige marco temporal quando cron está ativo', () => {
  const getInseguro = validarConfiguracao({ ...envBase(), PERMITIR_DISPARO_MANUAL_GET: 'true' });
  assert.equal(getInseguro.ok, false);
  assert.match(getInseguro.erros.join(' '), /PERMITIR_DISPARO_MANUAL_GET/);

  const cronSemMarco = validarConfiguracao({
    ...envBase(),
    CRON_ATIVO: 'true',
    AIRTABLE_TOKEN: 'pat_test',
    AIRTABLE_BASE_ID: 'app_test',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    EMAIL_ATIVO: 'true',
  });
  assert.equal(cronSemMarco.ok, false);
  assert.match(cronSemMarco.erros.join(' '), /AUTOMACAO_INICIO_EM/);
});

test('módulo SMTP falha cedo quando EMAIL_MODO_TESTE=false', () => {
  const anterior = process.env.EMAIL_MODO_TESTE;
  const loadOriginal = Module._load;
  try {
    process.env.EMAIL_MODO_TESTE = 'false';
    Module._load = function patched(request, parent, isMain) {
      if (request === 'dotenv') return { config: () => ({ parsed: {} }) };
      if (request === 'nodemailer') return { createTransport: () => ({}) };
      return loadOriginal.call(this, request, parent, isMain);
    };
    try { delete require.cache[require.resolve('../enviar_email.js')]; } catch (_) {}
    assert.throws(
      () => require('../enviar_email.js'),
      /EMAIL_MODO_TESTE deve ficar vazio ou conter um e-mail válido/
    );
  } finally {
    Module._load = loadOriginal;
    try { delete require.cache[require.resolve('../enviar_email.js')]; } catch (_) {}
    if (anterior === undefined) delete process.env.EMAIL_MODO_TESTE;
    else process.env.EMAIL_MODO_TESTE = anterior;
  }
});



test('SMTP em modo teste redireciona para e-mail controlado e mascara destinatário', async () => {
  const anterior = { ...process.env };
  const loadOriginal = Module._load;
  let mail = null;
  try {
    Object.assign(process.env, {
      EMAIL_MODO_TESTE: 'qa@itr.eng.br',
      EMAIL_REMETENTE: 'ITR <naoresponda@itr.eng.br>',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
    });
    Module._load = function patched(request, parent, isMain) {
      if (request === 'dotenv') return { config: () => ({ parsed: {} }) };
      if (request === 'nodemailer') {
        return {
          createTransport: () => ({
            async sendMail(options) { mail = options; return { messageId: 'test-id' }; },
            async verify() { return true; },
          }),
        };
      }
      return loadOriginal.call(this, request, parent, isMain);
    };
    try { delete require.cache[require.resolve('../enviar_email.js')]; } catch (_) {}
    const { enviar, mascararEmail } = require('../enviar_email.js');
    const r = await enviar({ para: ['cliente.real@example.com'], assunto: 'Teste', html: '<p>x</p>', texto: 'x' });
    assert.equal(r.ok, true);
    assert.ok(mail);
    assert.equal(mail.to, 'qa@itr.eng.br');
    assert.notEqual(mail.to, 'cliente.real@example.com');
    assert.doesNotMatch(mascararEmail('cliente.real@example.com'), /^cliente\.real@/);
  } finally {
    Module._load = loadOriginal;
    try { delete require.cache[require.resolve('../enviar_email.js')]; } catch (_) {}
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, anterior);
  }
});

test('HMAC aceita assinatura correta e bloqueia replay, corpo alterado e timestamp vencido', () => {
  const secret = crypto.randomBytes(32).toString('base64');
  const now = 1788200000;
  const body = Buffer.from(JSON.stringify({ type: 'FIRST_ACCESS' }));
  const nonce = crypto.randomBytes(18).toString('base64url');
  const timestamp = String(now);
  const sig = assinatura({ secret, timestamp, nonce, body });
  const store = new Map();

  const ok = validarAssinaturaPortal({
    secretBase64: secret,
    timestamp,
    nonce,
    signature: sig,
    rawBody: body,
    maxSkewSeconds: 300,
    nowSeconds: now,
    nonceStore: store,
  });
  assert.deepEqual(ok, { ok: true });

  const replay = validarAssinaturaPortal({
    secretBase64: secret,
    timestamp,
    nonce,
    signature: sig,
    rawBody: body,
    maxSkewSeconds: 300,
    nowSeconds: now,
    nonceStore: store,
  });
  assert.equal(replay.status, 409);
  assert.equal(replay.motivo, 'nonce-repetido');

  const nonce2 = crypto.randomBytes(18).toString('base64url');
  const sig2 = assinatura({ secret, timestamp, nonce: nonce2, body });
  const adulterado = validarAssinaturaPortal({
    secretBase64: secret,
    timestamp,
    nonce: nonce2,
    signature: sig2,
    rawBody: Buffer.from('{"type":"PASSWORD_CHANGED"}'),
    maxSkewSeconds: 300,
    nowSeconds: now,
    nonceStore: store,
  });
  assert.equal(adulterado.status, 401);

  const nonce3 = crypto.randomBytes(18).toString('base64url');
  const antigo = String(now - 301);
  const sig3 = assinatura({ secret, timestamp: antigo, nonce: nonce3, body });
  const expirado = validarAssinaturaPortal({
    secretBase64: secret,
    timestamp: antigo,
    nonce: nonce3,
    signature: sig3,
    rawBody: body,
    maxSkewSeconds: 300,
    nowSeconds: now,
    nonceStore: store,
  });
  assert.equal(expirado.status, 401);
  assert.equal(expirado.motivo, 'timestamp-invalido');
});

test('links de segurança bloqueiam phishing, HTTP, path errado e ausência de fragmento', () => {
  const origin = 'https://portal.itr.eng.br';
  assert.equal(actionUrlValida('FIRST_ACCESS', `${origin}/criar-senha.html#token=abc`, origin), true);
  assert.equal(actionUrlValida('PASSWORD_RESET', `${origin}/redefinir-senha.html#abc`, origin), true);

  const invalidos = [
    'http://portal.itr.eng.br/criar-senha.html#abc',
    'https://portal.itr.eng.br.evil.example/criar-senha.html#abc',
    'https://portal.itr.eng.br@evil.example/criar-senha.html#abc',
    'https://portal.itr.eng.br/login.html#abc',
    'https://portal.itr.eng.br/criar-senha.html',
    'javascript:alert(1)',
  ];

  for (const url of invalidos) {
    assert.equal(actionUrlValida('FIRST_ACCESS', url, origin), false, url);
  }

  assert.equal(actionUrlValida('PASSWORD_CREATED', '', origin), true);
  assert.equal(actionUrlValida('PASSWORD_CREATED', `${origin}/login.html`, origin), false);
});



test('template de segurança escapa dados controlados pelo cliente', () => {
  const r = montarEmailSeguranca({
    type: 'FIRST_ACCESS',
    client: {
      name: '<img src=x onerror=alert(1)>',
      cnpj: '<script>alert(1)</script>',
    },
    actionUrl: 'https://portal.itr.eng.br/criar-senha.html#token=abc',
    portalOrigin: 'https://portal.itr.eng.br',
  });

  assert.doesNotMatch(r.html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(r.html, /<script>alert\(1\)<\/script>/);
  assert.match(r.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('WhatsApp de segurança respeita WHATSAPP_MODO_TESTE e não usa telefone real', async () => {
  const envAnterior = { ...process.env };
  const loadOriginal = Module._load;
  const fetchOriginal = global.fetch;
  let payloadCapturado = null;

  try {
    Object.assign(process.env, {
      WHATSAPP_ATIVO: 'true',
      WHATSAPP_SIMULAR: 'false',
      WHATSAPP_MODO_TESTE: 'true',
      WHATSAPP_TEST_NUMBER: '5511999999999',
      WHATSAPP_ACCESS_TOKEN: 'token-de-teste',
      WHATSAPP_PHONE_NUMBER_ID: '123456',
      WHATSAPP_API_VERSION: 'v25.0',
      WHATSAPP_GRAPH_BASE_URL: 'https://graph.facebook.com',
      PORTAL_SECURITY_WHATSAPP_ENABLED: 'true',
      WHATSAPP_SECURITY_TEMPLATE_NAME: 'security_test',
      WHATSAPP_SECURITY_TEMPLATE_LANGUAGE: 'pt_BR',
      PORTAL_ORIGIN: 'https://portal.itr.eng.br',
    });

    Module._load = function patched(request, parent, isMain) {
      if (request === 'dotenv') return { config: () => ({ parsed: {} }) };
      return loadOriginal.call(this, request, parent, isMain);
    };

    for (const rel of ['../security_whatsapp.js', '../enviar_whatsapp.js', '../whatsapp_template.js', '../email_template.js']) {
      try { delete require.cache[require.resolve(rel)]; } catch (_) {}
    }

    global.fetch = async (_url, options) => {
      payloadCapturado = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async json() { return { messages: [{ id: 'wamid.test' }] }; },
      };
    };

    const { enviarAvisoSegurancaWhatsApp } = require('../security_whatsapp.js');
    const resultado = await enviarAvisoSegurancaWhatsApp({
      type: 'PASSWORD_CHANGED',
      client: {
        name: 'Cliente Teste',
        whatsapp: '5561991111111',
      },
    });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.modoTeste, true);
    assert.ok(payloadCapturado);
    assert.equal(payloadCapturado.to, '5511999999999');
    assert.notEqual(payloadCapturado.to, '5561991111111');
    assert.doesNotMatch(JSON.stringify(payloadCapturado), /token|actionUrl|redefinir-senha/i);
  } finally {
    Module._load = loadOriginal;
    global.fetch = fetchOriginal;
    for (const chave of Object.keys(process.env)) delete process.env[chave];
    Object.assign(process.env, envAnterior);
  }
});

test('logs de e-mail usam máscara e rotas administrativas não aceitam segredo na query', () => {
  const envios = fs.readFileSync(path.join(ROOT, 'enviar_todos.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  assert.match(envios, /mascararDestinos/);
  assert.doesNotMatch(server, /req\.query\?\.chave|req\.query\.chave/);
  assert.match(server, /statusAutorizado/);
  assert.match(server, /Autenticação obrigatória/);
});
