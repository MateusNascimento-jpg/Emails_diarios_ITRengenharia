'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('endpoint interno exige HMAC, timestamp e nonce',()=>{
  const server=read('server.js');
  assert.match(server,/\/internal\/portal\/security-notification/);
  assert.match(server,/x-itr-timestamp/i);
  assert.match(server,/x-itr-nonce/i);
  assert.match(server,/x-itr-signature/i);
  assert.match(server,/timingSafeEqual/);
  assert.match(server,/nonce-repetido/);
});

test('notificações de segurança usam tipos fechados e não aceitam HTML arbitrário',()=>{
  const mod=read('security_notifications.js');
  const email=read('security_email_template.js');
  for(const type of ['FIRST_ACCESS','PASSWORD_RESET','PASSWORD_CREATED','PASSWORD_CHANGED']) assert.match(email,new RegExp(type));
  assert.match(mod,/DEFINICOES\[type\]/);
  assert.doesNotMatch(mod,/payload\?\.html|payload\.html|req\.body\.html/);
});

test('links de ativação/reset precisam permanecer no domínio HTTPS do Portal',()=>{
  const mod=read('security_notifications.js');
  assert.match(mod,/u\.protocol === 'https:'/);
  assert.match(mod,/u\.origin === origem\.origin/);
  assert.match(mod,/criar-senha\.html/);
  assert.match(mod,/redefinir-senha\.html/);
  assert.match(mod,/Boolean\(u\.hash\)/);
});

test('WhatsApp de segurança não recebe token nem actionUrl de redefinição',()=>{
  const wa=read('security_whatsapp.js');
  assert.doesNotMatch(wa,/actionUrl|#token|redefinir-senha\.html/);
  assert.match(wa,/portal_url/);
});

test('mensagem diária expõe CNPJ e e-mail apenas como credencial inicial',()=>{
  const email=read('email_template.js');
  const wa=read('whatsapp_template.js');
  assert.match(email,/Senha inicial \(somente no primeiro acesso\)/);
  assert.match(email,/Depois disso, use CNPJ \+ sua senha/);
  assert.match(wa,/senha_inicial/);
  assert.match(wa,/cnpj/);
});
