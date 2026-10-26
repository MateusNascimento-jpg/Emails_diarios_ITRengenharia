'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verify, headers } = require('./protocol');
const { gravarAtomico, falhaAntesDaEntrega } = require('../integridade_notifications');
const { render } = require('./template');
const { accessForEmail } = require('./access');

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function configuration(env = process.env) {
    const flag = env.PROPOSTAS_NOTIFICACOES_ATIVAS || 'false';
    if (!['true', 'false'].includes(flag))
        throw new Error('PROPOSTAS_NOTIFICACOES_ATIVAS inválido.');
    if (flag !== 'true') return { enabled: false };
    const directory = env.PROPOSTAS_NOTIFICACOES_DIRETORIO || '/dados/propostas-notificacoes';
    if (
        !path.isAbsolute(directory) ||
        !path.relative(path.resolve(__dirname, '..'), path.resolve(directory)).startsWith('..')
    )
        throw new Error('Diretório comercial deve ser absoluto, externo ao código e persistente.');
    const origin = new URL(env.PORTAL_ORIGIN);
    if (
        origin.protocol !== 'https:' ||
        origin.pathname !== '/' ||
        origin.username ||
        origin.password ||
        origin.search ||
        origin.hash
    )
        throw new Error('PORTAL_ORIGIN inválido.');
    const secret = env.PORTAL_INTERNAL_HMAC_SECRET || '';
    if (Buffer.from(secret, 'base64').length < 32)
        throw new Error('HMAC comercial não configurado.');
    if (env.EMAIL_ATIVO !== 'true' || String(env.EMAIL_MODO_TESTE || '').trim())
        throw new Error(
            'Ativação comercial exige EMAIL_ATIVO=true e nenhum redirecionamento de teste.',
        );
    return { enabled: true, directory, origin: origin.origin, secret };
}

function valid(payload, origin) {
    if (
        !payload ||
        !/^[a-f0-9]{64}$/.test(payload.eventId || '') ||
        !['NEW', 'VERIFY', 'ACCEPTED', 'INVOICE'].includes(payload.type)
    )
        return false;
    const allowed = new Set([
        'eventId',
        'type',
        'recipient',
        'snapshot',
        'challengeId',
        'expiresAt',
        'actionUrl',
        'code',
        'documentHash',
        'invoice',
    ]);
    if (Object.keys(payload).some((key) => !allowed.has(key))) return false;
    if (
        typeof payload.recipient !== 'string' ||
        payload.recipient.length > 254 ||
        !/^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/u.test(payload.recipient)
    )
        return false;
    const snap = payload.snapshot;
    if (
        !snap ||
        !/^[a-f0-9]{64}$/.test(snap.version || '') ||
        !/^[a-f0-9]{64}$/.test(snap.pdfHash || '') ||
        typeof snap.filename !== 'string'
    )
        return false;
    const proposal = snap.proposal;
    if (
        !proposal ||
        !/^rec[a-zA-Z0-9]{14}$/.test(proposal.id || '') ||
        !/^\d{14}$/.test(proposal.cnpj || '') ||
        !Number.isFinite(proposal.valor) ||
        proposal.valor < 0
    )
        return false;
    if (typeof proposal.numero !== 'string' && typeof proposal.numero !== 'number') return false;
    if (String(proposal.numero).length > 100 || /[\r\n]/.test(String(proposal.numero)))
        return false;
    if (payload.type === 'VERIFY') {
        if (!/^[a-f0-9-]{36}$/.test(payload.challengeId || '') ||
            !Number.isFinite(payload.expiresAt) ||
            !/^\d{8}$/.test(payload.code || '') || payload.actionUrl) return false;
    } else if (payload.code || payload.actionUrl || payload.challengeId || payload.expiresAt) return false;
    if (payload.type === 'ACCEPTED' && !/^[a-f0-9]{64}$/.test(payload.documentHash || '')) return false;
    if (payload.type !== 'ACCEPTED' && payload.documentHash !== undefined) return false;
    if (payload.type === 'INVOICE') {
        const inv = payload.invoice;
        if(!inv || !/^rec[A-Za-z0-9]{14}$/.test(inv.id||'') ||
            !/^rec[A-Za-z0-9]{14}$/.test(inv.contractId||'') ||
            !/^[a-f0-9]{64}$/.test(inv.documentVersion||'') ||
            !Array.isArray(inv.attachments) || inv.attachments.length < 1 ||
            inv.attachments.length > 3 || !inv.attachments.some(a=>a.tipo==='nfse') ||
            inv.attachments.some(a=>!/^att[A-Za-z0-9]{14}$/.test(a.id||'') ||
                !['nfse','boleto'].includes(a.tipo) || !/^[a-f0-9]{64}$/.test(a.sha256||'') ||
                typeof a.filename!=='string' || a.filename.length>160 || /[\r\n]/.test(a.filename))) return false;
    } else if (payload.invoice !== undefined) return false;
    return true;
}

async function attachment(payload, config, fetcher) {
    const route = '/internal/proposals/pdf/' + payload.eventId;
    const response = await fetcher(config.origin + route, {
        method: 'GET',
        redirect: 'error',
        headers: headers(config.secret, 'GET', route),
        signal: AbortSignal.timeout(65000),
    });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/pdf')
        throw new Error('PDF_UNAVAILABLE');
    if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES)
        throw new Error('PDF_TOO_LARGE');
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_PDF_BYTES) throw new Error('PDF_TOO_LARGE');
        chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks);
    if (
        content.subarray(0, 5).toString() !== '%PDF-' ||
        crypto.createHash('sha256').update(content).digest('hex') !== payload.snapshot.pdfHash
    )
        throw new Error('PDF_HASH_INVALID');
    return {
        filename: payload.snapshot.filename.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 160),
        content,
        contentType: 'application/pdf',
        contentDisposition: 'attachment',
    };
}

async function acceptedAttachment(payload, config, fetcher, kind) {
    const route = `/internal/proposals/accepted-pdf/${payload.eventId}/${kind}`;
    const response = await fetcher(config.origin + route, {
        method:'GET', redirect:'error', headers:headers(config.secret,'GET',route),
        signal:AbortSignal.timeout(65000),
    });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/pdf')
        throw new Error('PDF_UNAVAILABLE');
    if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES) throw new Error('PDF_TOO_LARGE');
    const chunks = []; let size=0;
    for await(const chunk of response.body) {
        size+=chunk.length;
        if(size>MAX_PDF_BYTES) throw new Error('PDF_TOO_LARGE');
        chunks.push(Buffer.from(chunk));
    }
    const content=Buffer.concat(chunks);
    const expected=kind==='comprovante'?payload.documentHash:payload.snapshot.pdfHash;
    if(content.subarray(0,5).toString()!=='%PDF-' ||
        crypto.createHash('sha256').update(content).digest('hex')!==expected)
        throw new Error('PDF_HASH_INVALID');
    return { filename:kind==='comprovante'?'Comprovante de Contrato.pdf':
        payload.snapshot.filename.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,160),
        content,contentType:'application/pdf',contentDisposition:'attachment' };
}

async function invoiceAttachments(payload, config, fetcher) {
    const pdfs=[];
    for(const file of payload.invoice.attachments) {
        const route=`/internal/proposals/invoice-pdf/${payload.eventId}/${file.id}`;
        const response=await fetcher(config.origin+route,{
            method:'GET',redirect:'error',headers:headers(config.secret,'GET',route),
            signal:AbortSignal.timeout(65000),
        });
        if(!response.ok || response.headers.get('content-type')?.split(';')[0]!=='application/pdf')
            throw new Error('PDF_UNAVAILABLE');
        if(Number(response.headers.get('content-length'))>MAX_PDF_BYTES)
            throw new Error('PDF_TOO_LARGE');
        let size=0;const chunks=[];
        for await(const chunk of response.body) {
            size+=chunk.length;
            if(size>MAX_PDF_BYTES)throw new Error('PDF_TOO_LARGE');
            chunks.push(Buffer.from(chunk));
        }
        const bytes=Buffer.concat(chunks);
        if(bytes.subarray(0,5).toString()!=='%PDF-'||
            crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)
            throw new Error('PDF_HASH_INVALID');
        pdfs.push({filename:file.filename.replace(/[\x00-\x1f\x7f/\\]/g,'_'),
            content:bytes,contentType:'application/pdf',contentDisposition:'attachment'});
    }
    return pdfs;
}

function createReceiver({ config, send, fetcher = fetch, access = accessForEmail }) {
    function prepare() {
        fs.mkdirSync(config.directory, { recursive: true, mode: 0o700 });
        fs.accessSync(config.directory, fs.constants.R_OK | fs.constants.W_OK);
    }

    function authenticate(req, raw) {
        if (!verify(config.secret, req.method, req.path, req.headers, raw)) return false;
        prepare();
        const nonceFile = path.join(config.directory, 'nonce-' + req.headers['x-itr-nonce']);
        try {
            const fd = fs.openSync(nonceFile, 'wx', 0o600);
            fs.writeFileSync(fd, String(Date.now() + 610000));
            fs.closeSync(fd);
        } catch (error) {
            if (error.code === 'EEXIST') return false;
            throw error;
        }
        // Bound replay files to the HMAC validity window, including restart recovery.
        for (const filename of fs.readdirSync(config.directory)) {
            if (!/^nonce-[\w-]{32}$/.test(filename)) continue;
            const full = path.join(config.directory, filename);
            try {
                if (fs.statSync(full).mtimeMs < Date.now() - 610000) fs.unlinkSync(full);
            } catch (_) {}
        }
        return true;
    }

    async function process(payload) {
        const reply = (status, code, ok = false) => ({
            status,
            body: { ok, eventId: payload.eventId, code },
        });
        if (!valid(payload, config.origin)) return reply(422, 'INVALID_EVENT');
        prepare();
        const file = path.join(config.directory, payload.eventId + '.json');
        const lock = file + '.lock';
        const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        let locked = false;
        try {
            try {
                const fd = fs.openSync(lock, 'wx', 0o600);
                fs.closeSync(fd);
                locked = true;
            } catch (error) {
                if (error.code === 'EEXIST') return reply(503, 'BUSY');
                throw error;
            }
            const receipt = fs.existsSync(file)
                ? JSON.parse(fs.readFileSync(file, 'utf8'))
                : { digest, state: 'retryable' };
            if (receipt.digest !== digest) return reply(409, 'EVENT_CONFLICT');
            if (receipt.state === 'sent') return reply(200, 'ALREADY_SENT', true);
            if (receipt.state !== 'retryable') return reply(409, 'DELIVERY_UNCERTAIN');
            if (payload.type === 'VERIFY' && payload.expiresAt <= Date.now())
                return reply(422, 'CHALLENGE_EXPIRED');
            let pdfs = [];
            try {
                if (payload.type === 'NEW') pdfs = [await attachment(payload, config, fetcher)];
                if (payload.type === 'ACCEPTED') pdfs = [
                    await acceptedAttachment(payload, config, fetcher, 'original'),
                    await acceptedAttachment(payload, config, fetcher, 'comprovante'),
                ];
                if (payload.type === 'INVOICE') pdfs = await invoiceAttachments(payload,config,fetcher);
            } catch (_) {
                return reply(503, 'PDF_UNAVAILABLE');
            }
            // Falha fechada: nenhuma senha em e-mail de verificação.
            // Se as bases não confirmarem o vínculo CNPJ + e-mail comercial,
            // a mensagem segue sem senha, sem afetar o envio comercial.
            let password = null;
            if (payload.type !== 'VERIFY') {
                try { password = await access(payload.snapshot.proposal.cnpj, payload.recipient); }
                catch (_) { password = null; }
            }
            const message = render(payload, config.origin, { password });
            receipt.state = 'sending';
            receipt.updatedAt = new Date().toISOString();
            gravarAtomico(file, receipt);
            try {
                const result = await send({
                    para: payload.recipient,
                    ...message,
                    pdfs,
                    eventId: payload.eventId,
                });
                if (!result?.ok) throw new Error('SMTP_NOT_CONFIRMED');
                receipt.state = 'sent';
                receipt.messageId = result.id || null;
                receipt.updatedAt = new Date().toISOString();
                gravarAtomico(file, receipt);
                return reply(200, 'SENT', true);
            } catch (error) {
                receipt.state = falhaAntesDaEntrega(error) ? 'retryable' : 'uncertain';
                gravarAtomico(file, receipt);
                return reply(
                    receipt.state === 'retryable' ? 503 : 409,
                    receipt.state === 'retryable' ? 'SMTP_RETRY' : 'DELIVERY_UNCERTAIN',
                );
            }
        } finally {
            if (locked) {
                try {
                    fs.unlinkSync(lock);
                } catch (_) {}
            }
        }
    }

    return { authenticate, process };
}

function register(app, express, options = {}) {
    const config = options.config || configuration();
    const receiver = config.enabled
        ? createReceiver({
              config,
              send: options.send || ((args) => require('../enviar_email').enviarComercial(args)),
              fetcher: options.fetcher,
              access: options.access,
          })
        : null;
    app.post(
        '/internal/proposals/events',
        express.raw({ type: 'application/json', limit: '16kb' }),
        async (req, res) => {
            res.set('Cache-Control', 'no-store');
            if (!receiver) return res.status(503).json({ ok: false, code: 'DISABLED' });
            try {
                if (!Buffer.isBuffer(req.body))
                    return res.status(422).json({ ok: false, code: 'INVALID_EVENT' });
                if (!receiver.authenticate(req, req.body))
                    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
                let payload;
                try {
                    payload = JSON.parse(req.body.toString('utf8'));
                } catch (_) {
                    return res.status(422).json({ ok: false, code: 'INVALID_EVENT' });
                }
                const result = await receiver.process(payload);
                res.status(result.status).json(result.body);
            } catch (_) {
                res.status(503).json({ ok: false, code: 'STORAGE_OR_DELIVERY_UNAVAILABLE' });
            }
        },
    );
    app.use('/internal/proposals', (error, req, res, next) => {
        if (!error) return next();
        res.status(error.type === 'entity.too.large' ? 413 : 400).json({
            ok: false,
            code: 'INVALID_EVENT',
        });
    });
}

module.exports = { configuration, valid, attachment, acceptedAttachment, invoiceAttachments, createReceiver, register };
