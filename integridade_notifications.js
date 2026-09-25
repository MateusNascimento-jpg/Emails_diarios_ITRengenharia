'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function carregarConfig(env = process.env) {
  const flag = String(env.INTEGRIDADE_NOTIFICACOES_ATIVAS || 'false').trim();
  if (!['true', 'false'].includes(flag)) throw new Error('INTEGRIDADE_NOTIFICACOES_ATIVAS aceita true ou false.');
  if (flag === 'false') return { ativo: false };
  const secret = String(env.INTEGRIDADE_NOTIFICACOES_HMAC_SECRET || '').trim();
  const key = Buffer.from(secret, 'base64');
  if (key.length < 32 || key.toString('base64') !== secret) throw new Error('INTEGRIDADE_NOTIFICACOES_HMAC_SECRET exige Base64 canônico de pelo menos 32 bytes.');
  if (env.PORTAL_INTERNAL_HMAC_SECRET && key.equals(Buffer.from(env.PORTAL_INTERNAL_HMAC_SECRET, 'base64'))) throw new Error('Use segredo exclusivo para alertas de Integridade.');
  const para = String(env.INTEGRIDADE_NOTIFICACAO_EMAIL || '').trim();
  if (!/^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/u.test(para)) throw new Error('INTEGRIDADE_NOTIFICACAO_EMAIL exige um único endereço válido.');
  const url = String(env.INTEGRIDADE_ADMIN_URL || '').trim();
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('INTEGRIDADE_ADMIN_URL inválida.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/admin.html') throw new Error('INTEGRIDADE_ADMIN_URL exige HTTPS e /admin.html, sem parâmetros.');
  const diretorio = String(env.INTEGRIDADE_NOTIFICACOES_DIRETORIO || '').trim();
  if (!path.isAbsolute(diretorio)) throw new Error('INTEGRIDADE_NOTIFICACOES_DIRETORIO exige caminho absoluto em volume persistente.');
  const relative = path.relative(__dirname, path.resolve(diretorio));
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('O diretório de recibos deve ficar fora do código da aplicação.');
  if (String(env.EMAIL_MODO_TESTE || '').trim()) throw new Error('Para ativar Integridade, EMAIL_MODO_TESTE deve estar vazio; evitar redirecionamento silencioso.');
  for (const nome of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) if (!String(env[nome] || '').trim()) throw new Error(`${nome} é obrigatório para Integridade.`);
  return { ativo: true, key, para, url: parsed.href, diretorio: path.resolve(diretorio), skew: 300 };
}

function validarEvento(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'eventId,occurredAt,recordType,type') return false;
  return body.type === 'INTEGRITY_RECORD_CREATED' &&
    typeof body.eventId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.eventId) &&
    ['report', 'service'].includes(body.recordType) && typeof body.occurredAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.occurredAt) &&
    Number.isFinite(Date.parse(body.occurredAt)) && new Date(body.occurredAt).toISOString() === body.occurredAt;
}

function falhaAntesDaEntrega(error) {
  if (Number.isInteger(error.responseCode) && error.responseCode >= 400 && error.responseCode < 600) return true;
  if (['EAUTH', 'EDNS', 'ECONNECTION', 'ENOTFOUND', 'ECONNREFUSED', 'EENVELOPE'].includes(error.code)) return true;
  return ['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(error.command);
}

function gravarAtomico(arquivo, value) {
  const temp = `${arquivo}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, arquivo);
    // Diretório sincronizado em Linux (ambiente de produção).
    if (process.platform !== 'win32') {
      const dir = fs.openSync(path.dirname(arquivo), 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function criarReceptor({ config, enviar, agora = Date.now, logger = console }) {
  const nonces = new Map();
  const ativos = new Set();
  function preparar() {
    if (!config.ativo) return;
    fs.mkdirSync(config.diretorio, { recursive: true, mode: 0o700 });
    fs.accessSync(config.diretorio, fs.constants.R_OK | fs.constants.W_OK);
  }
  function diagnosticar() {
    preparar();
    const teste = path.join(config.diretorio, `diagnostico.${crypto.randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(teste, 'wx', 0o600);
      fs.writeFileSync(fd, 'integridade');
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(teste)) fs.unlinkSync(teste);
    }
  }
  function autenticar(headers, raw) {
    if (!config.ativo) return { status: 503, code: 'DISABLED' };
    const timestamp = headers['x-itr-timestamp'];
    const nonce = headers['x-itr-nonce'];
    const signature = headers['x-itr-signature'];
    const now = agora();
    if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > config.skew ||
        typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{24,128}$/.test(nonce) || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return { status: 401, code: 'UNAUTHORIZED' };
    const expected = crypto.createHmac('sha256', config.key).update(`${timestamp}.${nonce}.`).update(raw).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return { status: 401, code: 'UNAUTHORIZED' };
    for (const [n, until] of nonces) if (until <= now) nonces.delete(n);
    if (nonces.has(nonce)) return { status: 401, code: 'REPLAY' };
    if (nonces.size >= 10000) return { status: 503, code: 'BUSY' };
    nonces.set(nonce, (Number(timestamp) + config.skew + 1) * 1000);
    return null;
  }
  async function processar(evento) {
    if (!config.ativo) return { status: 503, body: { ok: false, code: 'DISABLED' } };
    if (!validarEvento(evento)) return { status: 400, body: { ok: false, code: 'INVALID_EVENT' } };
    const eventId = evento.eventId;
    const reply = (status, extra) => ({ status, body: { ok: status === 200, eventId, ...extra } });
    const digest = crypto.createHash('sha256').update(JSON.stringify([eventId, evento.type, evento.recordType, evento.occurredAt])).digest('hex');
    const arquivo = path.join(config.diretorio, `${eventId}.json`);
    const lock = path.join(config.diretorio, `${eventId}.lock`);
    let locked = false;
    try {
      preparar();
      let anterior = fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : null;
      if (anterior && anterior.digest !== digest) return reply(409, { code: 'EVENT_CONFLICT' });
      if (anterior?.estado === 'sent') return reply(200, { status: 'already-sent' });
      if (ativos.has(eventId)) return reply(503, { code: 'BUSY' });
      if (anterior && ['sending', 'uncertain'].includes(anterior.estado)) return reply(409, { code: 'DELIVERY_UNCERTAIN' });
      try { const fd = fs.openSync(lock, 'wx', 0o600); locked = true; fs.closeSync(fd); }
      catch (e) { if (e.code === 'EEXIST') return reply(409, { code: 'DELIVERY_UNCERTAIN' }); throw e; }
      // Relê sob lock, pois outra instância pode ter acabado de concluir.
      anterior = fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : null;
      if (anterior && anterior.digest !== digest) return reply(409, { code: 'EVENT_CONFLICT' });
      if (anterior?.estado === 'sent') return reply(200, { status: 'already-sent' });
      if (anterior && !['retryable'].includes(anterior.estado)) return reply(409, { code: 'DELIVERY_UNCERTAIN' });
      ativos.add(eventId);
      const recibo = { eventId, digest, recordType: evento.recordType, occurredAt: evento.occurredAt, estado: 'sending', atualizadoEm: new Date(agora()).toISOString() };
      gravarAtomico(arquivo, recibo);
      const assunto = 'ITR | Novo registro no Portal de Integridade';
      const texto = `Um novo registro foi recebido no Portal de Integridade e Atendimento da ITR.\n\nAcesse o painel administrativo para consultar os detalhes:\n${config.url}\n\nEsta mensagem não contém dados do solicitante nem o conteúdo do registro.`;
      const escape = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      try {
        const resultado = await enviar({ para: config.para, assunto, texto, html: `<p>Um novo registro foi recebido no Portal de Integridade e Atendimento da ITR.</p><p><a href="${escape(config.url)}">Acessar painel administrativo</a></p><p>Esta mensagem não contém dados do solicitante nem o conteúdo do registro.</p>` });
        if (!resultado?.ok) throw Object.assign(new Error('SMTP não confirmou envio'), { code: 'NO_CONFIRMATION' });
      } catch (e) {
        recibo.estado = falhaAntesDaEntrega(e) ? 'retryable' : 'uncertain';
        gravarAtomico(arquivo, recibo);
        logger.warn(`[Integridade alerta] ${recibo.estado}; consulte os recibos operacionais.`);
        return reply(recibo.estado === 'retryable' ? 503 : 409, { code: recibo.estado === 'retryable' ? 'SMTP_RETRY' : 'DELIVERY_UNCERTAIN' });
      }
      recibo.estado = 'sent';
      recibo.atualizadoEm = new Date(agora()).toISOString();
      try { gravarAtomico(arquivo, recibo); }
      catch { return reply(409, { code: 'DELIVERY_UNCERTAIN' }); }
      return reply(200, { status: 'sent' });
    } catch {
      logger.error('[Integridade alerta] Falha de armazenamento; nenhum detalhe do registro foi registrado no log.');
      return reply(503, { code: 'STORAGE_UNAVAILABLE' });
    } finally {
      if (locked) ativos.delete(eventId);
      if (locked) { try { fs.unlinkSync(lock); } catch {} }
    }
  }
  return { preparar, diagnosticar, autenticar, processar };
}

function registrarRotas(app, express, options = {}) {
  const config = options.config || carregarConfig();
  const receptor = criarReceptor({ config, enviar: options.enviar || (args => require('./enviar_email').enviar(args)) });
  const raw = express.raw({ type: 'application/json', limit: '2kb' });
  for (const route of ['record-created', 'diagnostic']) {
    app.post(`/internal/integridade/${route}`, raw, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!Buffer.isBuffer(req.body)) return res.status(400).json({ ok: false, code: 'INVALID_BODY' });
      const erro = receptor.autenticar(req.headers, req.body);
      if (erro) return res.status(erro.status).json({ ok: false, code: erro.code });
      let body;
      try { body = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ ok: false, code: 'INVALID_JSON' }); }
      if (route === 'diagnostic') {
        if (!body || Array.isArray(body) || Object.keys(body).length) return res.status(400).json({ ok: false, code: 'INVALID_BODY' });
        try { receptor.diagnosticar(); return res.json({ ok: true, feature: 'integridade', storage: 'writable', smtp: 'not-tested' }); }
        catch { return res.status(503).json({ ok: false, code: 'STORAGE_UNAVAILABLE' }); }
      }
      const result = await receptor.processar(body);
      return res.status(result.status).json(result.body);
    });
  }
  app.use('/internal/integridade', (err, req, res, next) => {
    if (!err) return next();
    res.status(err.type === 'entity.too.large' ? 413 : 400).json({ ok: false, code: 'INVALID_BODY' });
  });
  return receptor;
}
module.exports = { gravarAtomico, carregarConfig, validarEvento, falhaAntesDaEntrega, criarReceptor, registrarRotas };
