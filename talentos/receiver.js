'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { headers, verify, keyFromBase64 } = require('./protocol');
const { build } = require('./template');
const { gravarAtomico, falhaAntesDaEntrega } = require('../integridade_notifications');

const ROUTE = '/internal/talentos/events';
const MAX_PDF = 5 * 1024 * 1024;

function configuration(env = process.env) {
  const enabled = String(env.TALENTOS_NOTIFICACOES_ATIVAS || 'false');
  if (!['true', 'false'].includes(enabled)) throw new Error('TALENTOS_NOTIFICACOES_ATIVAS deve ser true ou false.');
  if (enabled !== 'true') return { enabled: false };
  const directory = String(env.TALENTOS_NOTIFICACOES_DIRETORIO || '').trim();
  if (!path.isAbsolute(directory)) throw new Error('Configure diretório absoluto e persistente para recibos de Talentos.');
  const base = path.resolve(__dirname, '..');
  const resolved = path.resolve(directory);
  if (resolved === base || !path.relative(base, resolved).startsWith('..') ||
      resolved.split(path.sep).some(part => ['hbuilds', 'public_html'].includes(part))) {
    throw new Error('Diretório de Talentos precisa ficar fora do código da aplicação.');
  }
  const secret = String(env.TALENTOS_NOTIFICACOES_HMAC_SECRET || '').trim();
  if (!keyFromBase64(secret)) throw new Error('HMAC de Talentos exige Base64 canônico de pelo menos 32 bytes.');
  const shared = ['PORTAL_INTERNAL_HMAC_SECRET', 'INTEGRIDADE_NOTIFICACOES_HMAC_SECRET'];
  if (shared.some(name => env[name] && env[name] === secret)) throw new Error('Use um HMAC exclusivo para o Banco de Talentos.');
  const recipient = String(env.TALENTOS_NOTIFICACOES_EMAIL || '').trim().toLowerCase();
  if (recipient !== 'comercial@itr.eng.br') throw new Error('O destinatário de Talentos deve ser comercial@itr.eng.br.');
  if (env.EMAIL_ATIVO !== 'true' || String(env.EMAIL_MODO_TESTE || '').trim()) {
    throw new Error('Talentos exige SMTP ativo e EMAIL_MODO_TESTE vazio.');
  }
  for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    if (!String(env[name] || '').trim()) throw new Error(`Talentos exige ${name}.`);
  }
  let restBase;
  try {
    const url = new URL(String(env.TALENTOS_WORDPRESS_REST_BASE || ''));
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash ||
        !/\/wp-json\/?$/.test(url.pathname)) throw new Error('invalid');
    restBase = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    throw new Error('TALENTOS_WORDPRESS_REST_BASE deve terminar em /wp-json e usar HTTPS.');
  }
  return { enabled: true, directory: resolved, secret, recipient, restBase };
}

function valid(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).sort().join(',') !== 'candidate,createdAt,eventId,pdf,protocol,type') return false;
  if (payload.type !== 'APPLICATION_CREATED' ||
      typeof payload.protocol !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.protocol)) return false;
  const expectedId = crypto.createHash('sha256').update(`itr-talentos-event-v1:${payload.protocol}`).digest('hex');
  if (payload.eventId !== expectedId || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(payload.createdAt) ||
      !Number.isFinite(Date.parse(payload.createdAt))) return false;
  const c = payload.candidate;
  const fields = { name: 150, email: 200, phone: 25, city: 100, state: 2,
    area: 120, level: 90, education: 200, portfolio: 500, summary: 1500 };
  if (!c || typeof c !== 'object' || Array.isArray(c) ||
      Object.keys(c).sort().join(',') !== Object.keys(fields).sort().join(',')) return false;
  if (Object.entries(fields).some(([name, limit]) => typeof c[name] !== 'string' || c[name].length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(c[name]))) return false;
  if (!c.name.trim() || /[\r\n]/.test(c.name) || !/^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(c.email) ||
      !/^[+0-9() .-]{8,25}$/.test(c.phone) || !c.city.trim() || !/^[A-Z]{2}$/.test(c.state) || !c.area || !c.level) return false;
  if (c.portfolio) {
    try { const url = new URL(c.portfolio); if (!['https:', 'http:'].includes(url.protocol)) return false; }
    catch { return false; }
  }
  const p = payload.pdf;
  return Boolean(p && typeof p === 'object' && !Array.isArray(p) &&
    Object.keys(p).sort().join(',') === 'bytes,filename,sha256' &&
    typeof p.filename === 'string' && p.filename.length > 0 && p.filename.length <= 255 &&
    !/[\x00-\x1f\x7f/\\]/.test(p.filename) &&
    Number.isInteger(p.bytes) && p.bytes >= 5 && p.bytes <= MAX_PDF &&
    typeof p.sha256 === 'string' && /^[a-f0-9]{64}$/.test(p.sha256));
}

async function downloadPdf(payload, config, fetcher = fetch) {
  const route = `/itr-talentos/v1/arquivo/${payload.protocol}`;
  const url = `${config.restBase}${route}`;
  const response = await fetcher(url, {
    method: 'GET', redirect: 'error',
    headers: headers(config.secret, 'GET', route),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/pdf') {
    throw new Error('PDF_UNAVAILABLE');
  }
  const headerBytes = response.headers.get('content-length');
  if (headerBytes && (!/^\d+$/.test(headerBytes) || Number(headerBytes) > MAX_PDF)) throw new Error('PDF_TOO_LARGE');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_PDF) {
      if (typeof response.body.cancel === 'function') await response.body.cancel().catch(() => {});
      throw new Error('PDF_TOO_LARGE');
    }
    chunks.push(Buffer.from(chunk));
  }
  const content = Buffer.concat(chunks);
  if (size !== payload.pdf.bytes || content.subarray(0, 5).toString() !== '%PDF-' ||
      crypto.createHash('sha256').update(content).digest('hex') !== payload.pdf.sha256) {
    throw new Error('PDF_INTEGRITY');
  }
  return { filename: payload.pdf.filename, content };
}

function createReceiver({ config, send, fetcher = fetch, logger = console }) {
  function prepare() {
    fs.mkdirSync(config.directory, { recursive: true, mode: 0o700 });
    const root = fs.realpathSync(config.directory);
    const base = fs.realpathSync(path.resolve(__dirname, '..'));
    if (root === base || !path.relative(base, root).startsWith('..') ||
        root.split(path.sep).some(part => ['hbuilds', 'public_html'].includes(part))) {
      throw new Error('UNSAFE_RECEIPT_DIRECTORY');
    }
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
    return root;
  }
  function authenticate(req, raw) {
    if (!verify(config.secret, req.method, req.path, req.headers, raw)) return false;
    const directory = prepare();
    const nonce = req.headers['x-itr-talentos-nonce'];
    const noncePath = path.join(directory, `nonce-${nonce}`);
    try {
      const fd = fs.openSync(noncePath, 'wx', 0o600);
      fs.writeFileSync(fd, String(Date.now())); fs.closeSync(fd);
    } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    for (const name of fs.readdirSync(directory)) {
      if (!/^nonce-[a-f0-9]{48}$/.test(name)) continue;
      const file = path.join(directory, name);
      try { if (fs.statSync(file).mtimeMs < Date.now() - 610000) fs.unlinkSync(file); } catch (_) {}
    }
    return true;
  }
  async function process(payload) {
    const reply = (status, code, ok = false) => ({ status, body: { ok, eventId: payload?.eventId, code } });
    if (!valid(payload)) return reply(422, 'INVALID_EVENT');
    const directory = prepare();
    const file = path.join(directory, `${payload.eventId}.json`);
    const lock = `${file}.lock`;
    const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    let locked = false;
    try {
      try { const fd = fs.openSync(lock, 'wx', 0o600); fs.closeSync(fd); locked = true; }
      catch (e) { if (e.code === 'EEXIST') return reply(503, 'BUSY'); throw e; }
      const receipt = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { digest, state: 'retryable' };
      if (receipt.digest !== digest) return reply(409, 'EVENT_CONFLICT');
      if (receipt.state === 'sent') return reply(200, 'ALREADY_SENT', true);
      if (receipt.state !== 'retryable') return reply(409, 'DELIVERY_UNCERTAIN');
      let pdf;
      try { pdf = await downloadPdf(payload, config, fetcher); }
      catch (_) { return reply(503, 'PDF_UNAVAILABLE'); }
      receipt.state = 'sending';
      receipt.updatedAt = new Date().toISOString();
      gravarAtomico(file, receipt);
      try {
        const result = await send({ para: config.recipient, ...build(payload), pdf, replyTo: payload.candidate.email, eventId: payload.eventId });
        if (!result?.ok) throw new Error('SMTP_NOT_CONFIRMED');
        receipt.state = 'sent'; receipt.messageId = result.id || null;
        receipt.updatedAt = new Date().toISOString();
        gravarAtomico(file, receipt);
        return reply(200, 'SENT', true);
      } catch (error) {
        receipt.state = falhaAntesDaEntrega(error) ? 'retryable' : 'uncertain';
        receipt.updatedAt = new Date().toISOString();
        gravarAtomico(file, receipt);
        logger.warn(`[TALENTOS] ${receipt.state}; evento ${payload.eventId.slice(0, 12)}; nenhuma informação pessoal em log.`);
        return reply(receipt.state === 'retryable' ? 503 : 409,
          receipt.state === 'retryable' ? 'SMTP_RETRY' : 'DELIVERY_UNCERTAIN');
      }
    } finally {
      if (locked) { try { fs.unlinkSync(lock); } catch (_) {} }
    }
  }
  return { prepare, authenticate, process };
}

function register(app, express, options = {}) {
  const config = options.config || configuration();
  const receiver = config.enabled ? createReceiver({
    config, send: options.send || (args => require('../enviar_email').enviarTalentos(args)),
    fetcher: options.fetcher, logger: options.logger,
  }) : null;
  app.post(ROUTE, express.raw({ type: 'application/json', limit: '32kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!receiver) return res.status(503).json({ ok: false, code: 'DISABLED' });
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ ok: false, code: 'INVALID_BODY' });
    try {
      if (!receiver.authenticate(req, req.body)) return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
      let payload;
      try { payload = JSON.parse(req.body.toString('utf8')); }
      catch { return res.status(400).json({ ok: false, code: 'INVALID_JSON' }); }
      const result = await receiver.process(payload);
      return res.status(result.status).json(result.body);
    } catch (_) { return res.status(503).json({ ok: false, code: 'STORAGE_OR_DELIVERY_UNAVAILABLE' }); }
  });
  app.use('/internal/talentos', (error, req, res, next) => {
    if (!error) return next();
    return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ ok: false, code: 'INVALID_BODY' });
  });
}

module.exports = { ROUTE, MAX_PDF, configuration, valid, downloadPdf, createReceiver, register };
