'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createReceiver, register } = require('../proposals/receiver');
const { headers } = require('../proposals/protocol');
const { render } = require('../proposals/template');

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const secret = Buffer.alloc(32, 3).toString('base64');
function event(type = 'NEW') {
    return {
        eventId: crypto.randomBytes(32).toString('hex'),
        type,
        recipient: 'commercial@example.test',
        snapshot: {
            version: 'a'.repeat(64),
            pdfHash: crypto.createHash('sha256').update(pdf).digest('hex'),
            filename: 'Proposta original.pdf',
            attachmentId: 'attA',
            proposal: {
                id: 'recAAAAAAAAAAAAAA',
                numero: '001/2026',
                nomeCliente: 'Empresa <teste>',
                nomeContato: 'Contato <teste>',
                cnpj: '12345678000190',
                valor: 1234.5,
                formaPagamento: 'Boleto',
                prazoPagamentoDias: 30
            }
        },
        ...(type === 'VERIFY'
            ? {
                  challengeId: crypto.randomUUID(),
                  expiresAt: Date.now() + 2 * 60 * 60 * 1000,
                  code: '94627135'
              }
            : {}),
        ...(type === 'ACCEPTED'
            ? { documentHash: crypto.createHash('sha256').update(pdf).digest('hex') }
            : {})
    };
}
function config(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-commercial-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return { enabled: true, directory, origin: 'https://portal.example.test', secret };
}
const fetcher = async () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } });

test('anexo original real, destinatário individual, recibo sobrevive a reinício', async (t) => {
    const c = config(t);
    const payload = event();
    const sent = [];
    const send = async (message) => {
        sent.push(message);
        return { ok: true, id: 'smtp-id' };
    };
    const receiver = createReceiver({ config: c, send, fetcher, access: async () => 'ITR123456' });
    assert.equal((await receiver.process(payload)).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].pdfs.length, 1);
    assert.deepEqual(sent[0].pdfs[0].content, pdf);
    assert.equal(sent[0].para, payload.recipient);
    const restarted = createReceiver({ config: c, send, fetcher, access: async () => 'ITR123456' });
    assert.equal((await restarted.process(payload)).status, 200);
    assert.equal(sent.length, 1);
    const altered = structuredClone(payload);
    altered.recipient = 'other@example.test';
    assert.equal((await restarted.process(altered)).status, 409);
});

test('nenhum envio sem PDF válido; resultado SMTP incerto nunca é repetido', async (t) => {
    const c = config(t);
    const payload = event();
    let sends = 0;
    const broken = createReceiver({
        config: c,
        send: async () => {
            sends++;
        },
        fetcher: async () =>
            new Response('HTML', { headers: { 'content-type': 'application/pdf' } })
    });
    assert.equal((await broken.process(payload)).status, 503);
    assert.equal(sends, 0);
    const uncertain = createReceiver({
        config: c,
        fetcher,
        access: async () => 'ITR123456',
        send: async () => {
            sends++;
            throw Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'DATA' });
        }
    });
    assert.equal((await uncertain.process(payload)).body.code, 'DELIVERY_UNCERTAIN');
    assert.equal((await uncertain.process(payload)).body.code, 'DELIVERY_UNCERTAIN');
    assert.equal(sends, 1);
});

test('falha SMTP anterior à entrega permite retry do mesmo evento; concorrência não duplica', async (t) => {
    const c = config(t);
    const payload = event('ACCEPTED');
    let count = 0;
    const receiver = createReceiver({
        config: c,
        fetcher,
        access: async () => 'ITR123456',
        send: async (message) => {
            assert.equal(message.pdfs.length, 2);
            assert.deepEqual(message.pdfs[0].content, pdf);
            assert.deepEqual(message.pdfs[1].content, pdf);
            assert.equal(message.pdfs[1].filename, 'Comprovante de Contrato.pdf');
            count++;
            if (count === 1) throw Object.assign(new Error('Authentication'), { code: 'EAUTH' });
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { ok: true };
        }
    });
    assert.equal((await receiver.process(payload)).status, 503);
    const replies = await Promise.all([receiver.process(payload), receiver.process(payload)]);
    assert.ok(replies.some((reply) => reply.status === 200));
    assert.equal(count, 2);
});

test('HTTP comercial exige HMAC, rejeita replay persistente e não aceita URL arbitrária', async (t) => {
    const c = config(t);
    const app = express();
    let sent = 0;
    register(app, express, {
        config: c,
        fetcher,
        send: async () => {
            sent++;
            return { ok: true };
        }
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const route = '/internal/proposals/events';
    const url = `http://127.0.0.1:${server.address().port}${route}`;
    const payload = event('VERIFY');
    const body = JSON.stringify(payload);
    const signed = headers(secret, 'POST', route, body);
    assert.equal(
        (
            await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body
            })
        ).status,
        401
    );
    assert.equal((await fetch(url, { method: 'POST', headers: signed, body })).status, 200);
    assert.equal((await fetch(url, { method: 'POST', headers: signed, body })).status, 401);
    const other = event('VERIFY');
    other.actionUrl = 'https://evil.test/confirmar-proposta.html#' + 'a'.repeat(43); // Proibido no protocolo novo
    const bad = JSON.stringify(other);
    assert.equal(
        (
            await fetch(url, {
                method: 'POST',
                headers: headers(secret, 'POST', route, bad),
                body: bad
            })
        ).status,
        422
    );
    assert.equal(sent, 1);
    const restarted = createReceiver({ config: c, send: async () => {}, fetcher });
    assert.equal(
        restarted.authenticate({ method: 'POST', path: route, headers: signed }, body),
        false
    );
});

test('templates comerciais preservam identidade, escapam texto e isolam código e senha', () => {
    for (const type of ['NEW', 'VERIFY', 'ACCEPTED']) {
        const payload = event(type);
        const email = render(payload, 'https://portal.example.test');
        assert.match(email.html, /bgcolor="#(?:000|000000)"/);
        assert.match(email.html, /cid:logoITR/);
        assert.match(email.html, /#e5e8ed/);
        assert.match(email.html, /Portal do Cliente/);
        // Texto dinâmico sempre escapado. A saudação usa o contato individual;
        // o nome da empresa nunca é tratado como nome de pessoa (handoff 06).
        assert.match(email.html, /Olá, <strong>Contato &lt;teste&gt;<\/strong>!/);
        assert.doesNotMatch(email.html, /<teste>|Olá, <strong>Empresa/);
        assert.doesNotMatch(email.html, /<strong>Senha:/);
        assert.doesNotMatch(email.html, />Confirmar aceite<\/a>/);
        if (type === 'VERIFY') {
            assert.match(email.html, /94627135/);
            assert.match(email.texto, /2 horas/);
            assert.doesNotMatch(email.html, /Senha:<\/strong>/);
        } else {
            assert.doesNotMatch(email.html, /94627135/);
        }
    }
});

test('MIME comercial contém PDF original como attachment e logo CID', async () => {
    const Module = require('node:module');
    const original = Module._load;
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    let mime;
    const before = {
        EMAIL_ATIVO: process.env.EMAIL_ATIVO,
        EMAIL_MODO_TESTE: process.env.EMAIL_MODO_TESTE
    };
    process.env.EMAIL_ATIVO = 'true';
    process.env.EMAIL_MODO_TESTE = '';
    Module._load = function (request, parent, main) {
        if (request === 'nodemailer' && parent.filename.endsWith('enviar_email.js'))
            return {
                createTransport: () => ({
                    sendMail: async (message) => {
                        const result = await transport.sendMail(message);
                        mime = result.message.toString();
                        return {
                            accepted: [message.to],
                            rejected: [],
                            messageId: result.messageId
                        };
                    }
                })
            };
        return original.call(this, request, parent, main);
    };
    delete require.cache[require.resolve('../enviar_email')];
    try {
        process.env.SMTP_HOST = 'smtp.example.test';
        process.env.SMTP_USER = 'user';
        process.env.SMTP_PASS = 'test-only';
        const payload = event();
        const result = await require('../enviar_email').enviarComercial({
            para: payload.recipient,
            ...render(payload, 'https://portal.example.test'),
            pdf: { filename: 'original.pdf', content: pdf },
            eventId: payload.eventId
        });
        assert.equal(result.ok, true);
        assert.match(mime, /Content-Disposition: attachment; filename=original.pdf/);
        assert.match(mime, /Content-ID: <logoITR>/);
        assert.ok(mime.replace(/\r\n/g, '').includes(pdf.toString('base64')));
    } finally {
        Module._load = original;
        for (const [key, value] of Object.entries(before)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        delete require.cache[require.resolve('../enviar_email')];
    }
});
