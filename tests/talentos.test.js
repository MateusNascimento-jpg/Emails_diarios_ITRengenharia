'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configuration, valid, downloadPdf, createReceiver, ROUTE } = require('../talentos/receiver');
const { headers, verify } = require('../talentos/protocol');
const { build } = require('../talentos/template');

const secret = crypto.randomBytes(32).toString('base64');
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n');
const logger = { warn() {}, error() {} };

function payload() {
  const protocol = crypto.randomUUID();
  return {
    eventId: crypto.createHash('sha256').update(`itr-talentos-event-v1:${protocol}`).digest('hex'),
    type: 'APPLICATION_CREATED', protocol,
    createdAt: '2026-10-27T15:00:00Z',
    candidate: {
      name: 'Candidato <teste>', email: 'candidato@example.test', phone: '61988887777',
      city: 'Brasília', state: 'DF', area: 'Engenharia e projetos',
      level: 'Profissional com experiência', education: '', portfolio: '', summary: 'Experiência & projetos',
    },
    pdf: { filename: 'curriculo.pdf', bytes: pdfBytes.length,
      sha256: crypto.createHash('sha256').update(pdfBytes).digest('hex') },
  };
}
function config(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-talentos-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { enabled: true, secret, recipient: 'comercial@itr.eng.br',
    restBase: 'https://site.example.test/wp-json', directory };
}
const goodResponse = () => new Response(pdfBytes, { headers: { 'content-type': 'application/pdf', 'content-length': String(pdfBytes.length) } });

test('configuração desativada não exige segredo; ativação exige segredo exclusivo e pasta externa', t => {
  assert.deepEqual(configuration({}), { enabled: false });
  const c = config(t);
  const env = { TALENTOS_NOTIFICACOES_ATIVAS: 'true', TALENTOS_NOTIFICACOES_DIRETORIO: c.directory,
    TALENTOS_NOTIFICACOES_HMAC_SECRET: secret, TALENTOS_NOTIFICACOES_EMAIL: c.recipient,
    TALENTOS_WORDPRESS_REST_BASE: c.restBase, EMAIL_ATIVO: 'true', EMAIL_MODO_TESTE: '',
    SMTP_HOST: 'smtp.example.test', SMTP_USER: 'test@example.test', SMTP_PASS: 'ficticia' };
  assert.equal(configuration(env).recipient, c.recipient);
  assert.throws(() => configuration({ ...env, TALENTOS_NOTIFICACOES_EMAIL: 'atacante@example.test' }));
  assert.throws(() => configuration({ ...env, PORTAL_INTERNAL_HMAC_SECRET: secret }));
  assert.throws(() => configuration({ ...env, EMAIL_MODO_TESTE: 'teste@example.test' }));
  assert.throws(() => configuration({ ...env, TALENTOS_WORDPRESS_REST_BASE: 'http://site.example.test/wp-json' }));
});

test('validação rígida de evento e template escapam conteúdo não confiável', () => {
  const p = payload();
  assert.equal(valid(p), true);
  assert.equal(valid({ ...p, eventId: 'a'.repeat(64) }), false);
  assert.equal(valid({ ...p, recipient: 'atacante@example.test' }), false);
  assert.equal(valid({ ...p, candidate: { ...p.candidate, name: 'Cabecalho\nBcc: adversario' } }), false);
  const template = build(p);
  assert.match(template.html, /&lt;teste&gt;/);
  assert.doesNotMatch(template.html, /Candidato <teste>/);
  assert.match(template.texto, /currículo PDF segue anexado/);
});

test('download do PDF faz GET assinado, valida tamanho e hash sem URL do payload', async t => {
  const c = config(t);
  const p = payload();
  let urlChamado;
  const get = async (url, opts) => {
    urlChamado = url;
    assert.equal(opts.method, 'GET');
    assert.equal(verify(secret, 'GET', `/itr-talentos/v1/arquivo/${p.protocol}`, opts.headers), true);
    return goodResponse();
  };
  assert.deepEqual((await downloadPdf(p, c, get)).content, pdfBytes);
  assert.equal(urlChamado, `https://site.example.test/wp-json/itr-talentos/v1/arquivo/${p.protocol}`);
  await assert.rejects(downloadPdf({ ...p, pdf: { ...p.pdf, sha256: 'a'.repeat(64) } }, c, get), /PDF_INTEGRITY/);
});

test('HMAC exige método, rota, corpo, timestamp e nonce; rejeita replay', t => {
  const c = config(t);
  const p = payload(); const raw = Buffer.from(JSON.stringify(p));
  const h = headers(secret, 'POST', ROUTE, raw);
  assert.equal(verify(secret, 'POST', ROUTE, h, raw), true);
  assert.equal(verify(secret, 'POST', ROUTE, h, Buffer.from('alterado')), false);
  assert.equal(verify(secret, 'GET', ROUTE, h, raw), false);
  assert.equal(verify(secret, 'POST', ROUTE, h, raw, 1000000000), false);
  const receiver = createReceiver({ config: c, send: async () => ({ ok: true }), logger });
  const req = { method: 'POST', path: ROUTE, headers: h };
  assert.equal(receiver.authenticate(req, raw), true);
  assert.equal(receiver.authenticate(req, raw), false);
});

test('recibo persistente impede reenvio após reinício ou payload divergente', async t => {
  const c = config(t); const p = payload();
  let sent = 0;
  const opts = { config: c, fetcher: async () => goodResponse(), logger,
    send: async msg => { sent++; assert.equal(msg.para, c.recipient); assert.deepEqual(msg.pdf.content, pdfBytes); return { ok: true, id: 'smtp-test' }; } };
  assert.equal((await createReceiver(opts).process(p)).body.code, 'SENT');
  assert.equal((await createReceiver(opts).process(p)).body.code, 'ALREADY_SENT');
  assert.equal(sent, 1);
  const edited = structuredClone(p); edited.candidate.city = 'Outra cidade';
  assert.equal((await createReceiver(opts).process(edited)).body.code, 'EVENT_CONFLICT');
  assert.equal(sent, 1);
});

test('falha antes do SMTP permite retry; falha incerta bloqueia reenvio', async t => {
  const c = config(t); const p = payload();
  let sent = 0;
  const receiver = createReceiver({ config: c, fetcher: async () => goodResponse(), logger,
    send: async () => { sent++; if (sent === 1) throw Object.assign(new Error('Auth'), { code: 'EAUTH' }); return { ok: true }; } });
  assert.equal((await receiver.process(p)).body.code, 'SMTP_RETRY');
  assert.equal((await receiver.process(p)).body.code, 'SENT');
  assert.equal(sent, 2);
  const second = payload();
  const uncertain = createReceiver({ config: c, fetcher: async () => goodResponse(), logger,
    send: async () => { sent++; throw Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'DATA' }); } });
  assert.equal((await uncertain.process(second)).body.code, 'DELIVERY_UNCERTAIN');
  assert.equal((await uncertain.process(second)).body.code, 'DELIVERY_UNCERTAIN');
  assert.equal(sent, 3);
});

test('PDF adulterado não chega ao SMTP; interrupção em sending não dispara de novo', async t => {
  const c = config(t); const p = payload(); let attempts = 0;
  const receiver = createReceiver({ config: c, fetcher: async () =>
    new Response(Buffer.from('%PDF-1.4\nconteudo divergente'), { headers: { 'content-type': 'application/pdf' } }),
    logger, send: async () => { attempts++; return { ok: true }; } });
  assert.equal((await receiver.process(p)).body.code, 'PDF_UNAVAILABLE');
  assert.equal(attempts, 0);
  const file = path.join(c.directory, `${p.eventId}.json`);
  fs.writeFileSync(file, JSON.stringify({ digest: crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex'), state: 'sending' }));
  const restarted = createReceiver({ config: c, fetcher: async () => goodResponse(), logger,
    send: async () => { attempts++; return { ok: true }; } });
  assert.equal((await restarted.process(p)).body.code, 'DELIVERY_UNCERTAIN');
  assert.equal(attempts, 0);
});
