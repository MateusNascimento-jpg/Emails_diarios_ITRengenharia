'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { carregarConfig, criarReceptor, registrarRotas, validarEvento } = require('../integridade_notifications');
const key = Buffer.alloc(32, 7);
const logger = { warn() {}, error() {} };
const evento = () => ({ type: 'INTEGRITY_RECORD_CREATED', eventId: crypto.randomUUID(), recordType: 'report', occurredAt: new Date().toISOString() });
function config(t) { const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-receptor-')); t.after(() => fs.rmSync(diretorio, { recursive: true, force: true })); return { ativo: true, key, para: 'vinícius@example.com', url: 'https://integridade.itr.eng.br/admin.html', diretorio, skew: 300 }; }
function headers(body, timestamp = String(Math.floor(Date.now()/1000)), nonce = crypto.randomBytes(24).toString('base64url')) { return { 'content-type': 'application/json', 'x-itr-timestamp': timestamp, 'x-itr-nonce': nonce, 'x-itr-signature': crypto.createHmac('sha256', key).update(`${timestamp}.${nonce}.`).update(body).digest('hex') }; }
test('inativo não exige configuração nem envia', async () => {
 assert.deepEqual(carregarConfig({}), { ativo: false }); let chamadas=0;
 const r=criarReceptor({config:{ativo:false}, enviar: async()=>{chamadas++;}});
 assert.equal((await r.processar(evento())).status,503); assert.equal(chamadas,0);
});
test('valida configuração, endereço Unicode e segredo exclusivo', t => {
 const c=config(t); const env={INTEGRIDADE_NOTIFICACOES_ATIVAS:'true',INTEGRIDADE_NOTIFICACOES_HMAC_SECRET:key.toString('base64'),INTEGRIDADE_NOTIFICACAO_EMAIL:c.para,INTEGRIDADE_ADMIN_URL:c.url,INTEGRIDADE_NOTIFICACOES_DIRETORIO:c.diretorio,SMTP_HOST:'smtp.example.com',SMTP_USER:'user',SMTP_PASS:'pass'};
 assert.equal(carregarConfig(env).para,c.para);
 for(const extra of [{EMAIL_MODO_TESTE:'teste@example.com'},{INTEGRIDADE_NOTIFICACAO_EMAIL:'a@example.com,b@example.com'},{INTEGRIDADE_ADMIN_URL:'http://example.com/admin.html'},{INTEGRIDADE_NOTIFICACOES_DIRETORIO:'.'},{PORTAL_INTERNAL_HMAC_SECRET:key.toString('base64')}]) assert.throws(()=>carregarConfig({...env,...extra}));
});
test('recibo persistente impede duplicação inclusive após reinício; corpo é genérico', async t => {
 const c=config(t); let count=0;const send=async m=>{count++;assert.equal(m.para,c.para);assert.ok(m.texto.includes(c.url));assert.ok(!m.texto.includes('protocolo'));return {ok:true};};
 const r=criarReceptor({config:c,enviar:send,logger});const e=evento();
 assert.equal((await r.processar(e)).body.status,'sent');
 assert.equal((await criarReceptor({config:c,enviar:send,logger}).processar(e)).body.status,'already-sent');
 assert.equal(count,1); assert.equal((await r.processar({...e,recordType:'service'})).body.code,'EVENT_CONFLICT');
});
test('concorrência no mesmo evento não envia em duplicidade', async t => {
 let release;let count=0;const waiting=new Promise(r=>release=r);const c=config(t); const r=criarReceptor({config:c,logger,enviar:async()=>{count++;await waiting;return {ok:true};}});const e=evento();const first=r.processar(e);
 assert.equal((await r.processar(e)).body.code,'BUSY');assert.equal((await r.processar(e)).body.code,'BUSY');release();assert.equal((await first).status,200);assert.equal(count,1);
});
test('falha anterior ao envio permite retry; timeout DATA exige revisão sem reenvio', async t => {
 const c=config(t);let count=0;const r=criarReceptor({config:c,logger,enviar:async()=>{count++;if(count===1)throw Object.assign(new Error(),{code:'ECONNREFUSED'});return {ok:true};}});const e=evento();
 assert.equal((await r.processar(e)).status,503);assert.equal((await r.processar(e)).status,200);assert.equal(count,2);
 let incertos=0;const r2=criarReceptor({config:c,logger,enviar:async()=>{incertos++;throw Object.assign(new Error(),{code:'ETIMEDOUT',command:'DATA'});}});const e2=evento();
 assert.equal((await r2.processar(e2)).body.code,'DELIVERY_UNCERTAIN');assert.equal((await r2.processar(e2)).status,409);assert.equal(incertos,1);
});
test('interrupção anterior deixa sending bloqueado, sem reenvio automático', async t=>{
 const c=config(t);const e=evento();const digest=crypto.createHash('sha256').update(JSON.stringify([e.eventId,e.type,e.recordType,e.occurredAt])).digest('hex');
 fs.writeFileSync(path.join(c.diretorio,e.eventId+'.json'),JSON.stringify({digest,estado:'sending'}));let count=0;
 const r=criarReceptor({config:c,logger,enviar:async()=>{count++;return {ok:true};}});assert.equal((await r.processar(e)).status,409);assert.equal(count,0);
});
test('validação rejeita dados sensíveis adicionais e tipos desconhecidos',()=>{
 const e=evento();assert.equal(validarEvento(e),true);assert.equal(validarEvento({...e,recordType:'service'}),true);
 for(const invalid of [{...e,payload:'privado'},{...e,protocolo:'123'},{...e,recordType:'outro'},{...e,eventId:'../../etc/passwd'},{...e,occurredAt:'2026-02-31T10:00:00.000Z'}]) assert.equal(validarEvento(invalid),false);
});
test('HMAC rejeita adulteração, timestamp vencido e replay futuro até final da janela',t=>{
 const c=config(t);let now=Date.now();const r=criarReceptor({config:c,enviar:async()=>({ok:true}),agora:()=>now});const raw=Buffer.from('{}');
 assert.equal(r.autenticar(headers(raw),raw),null);const future=String(Math.floor(now/1000)+299);const h=headers(raw,future);assert.equal(r.autenticar(h,raw),null);
 now+=301000;assert.equal(r.autenticar(h,raw).code,'REPLAY');assert.equal(r.autenticar(headers(raw,'1000000000'),raw).status,401);assert.equal(r.autenticar(headers(raw),Buffer.from('{"x":1}')).status,401);
});
test('HTTP assinado, diagnóstico sem e-mail, limites e parser isolado',async t=>{
 const c=config(t);let count=0;const app=express();registrarRotas(app,express,{config:c,enviar:async()=>{count++;return {ok:true};}});app.use(express.json());app.post('/outra',(req,res)=>res.json(req.body));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(route,body,h=headers(body))=>fetch(base+route,{method:'POST',headers:h,body});
 let response=await post('/internal/integridade/diagnostic','{}');assert.equal(response.status,200);assert.equal(count,0);
 const e=evento();e.recordType='service';const body=JSON.stringify(e);response=await post('/internal/integridade/record-created',body);assert.equal(response.status,200);assert.equal(count,1);
 response=await post('/internal/integridade/record-created',body,{'content-type':'application/json'});assert.equal(response.status,401);
 response=await post('/internal/integridade/record-created','x'.repeat(3000));assert.equal(response.status,413);
 response=await post('/outra','{"preservado":true}');assert.deepEqual(await response.json(),{preservado:true});
});
