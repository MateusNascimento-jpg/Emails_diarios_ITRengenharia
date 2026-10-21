'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validarConfiguracao } = require('../config_validation');
const { validarAssinaturaPortal } = require('../portal_hmac');
const crypto = require('node:crypto');

function config(bodyParams) {
  return validarConfiguracao({ NODE_ENV:'test', CRON_ATIVO:'false', EMAIL_ATIVO:'false', WHATSAPP_ATIVO:'false',
    WHATSAPP_TEMPLATE_BODY_PARAMETERS:bodyParams, PORTAL_ORIGIN:'https://portal.itr.eng.br' }, { estrito: false });
}
test('bloqueia configuração de senha no WhatsApp, inclusive com alias; aceita V3', () => {
  for (const param of ['senha', 'senha_inicial', 'senha_acesso', 'os=senha_acesso']) {
    assert.ok(config('order_service,'+param).erros.some(e=>/WhatsApp não pode receber senha/.test(e)), param);
  }
  assert.ok(!config('order_service,order_status').erros.some(e=>/WhatsApp não pode receber senha/.test(e)));
  assert.ok(validarConfiguracao({ NODE_ENV:'test', CRON_ATIVO:'false', EMAIL_ATIVO:'false',
    WHATSAPP_TEMPLATE_HEADER_TEXT_SOURCE:'senha' }, { estrito:false }).erros.some(e=>/WhatsApp não pode receber senha/.test(e)));
});
test('nenhum segredo de senha permanece no mapa de contexto do WhatsApp', () => {
  const code=fs.readFileSync(path.resolve(__dirname,'../whatsapp_template.js'),'utf8');
  assert.doesNotMatch(code, /senha_inicial:\s*require|senha_acesso:\s*require|senha:\s*require/);
  assert.match(code, /Credenciais de acesso não podem ser parâmetros do WhatsApp/);
});
test('assinatura HMAC real não aceita corpo adulterado ou segredo divergente',()=>{
  const secret=Buffer.alloc(32,17).toString('base64');
  const timestamp=String(Math.floor(Date.now()/1000));const nonce=crypto.randomBytes(18).toString('base64url');
  const body=Buffer.from(JSON.stringify({probe:true}));
  const sig=crypto.createHmac('sha256',Buffer.from(secret,'base64')).update(`${timestamp}.${nonce}.`).update(body).digest('hex');
  const args={secretBase64:secret,timestamp,nonce,signature:sig,rawBody:body,nonceStore:new Map()};
  assert.equal(validarAssinaturaPortal(args).ok,true);
  assert.equal(validarAssinaturaPortal({...args,nonceStore:new Map(),rawBody:Buffer.from('{}')}).ok,false);
  assert.equal(validarAssinaturaPortal({...args,nonceStore:new Map(),secretBase64:Buffer.alloc(32,23).toString('base64')}).ok,false);
});
