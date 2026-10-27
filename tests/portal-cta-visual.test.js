'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {decodificarRgba}=require('./helpers/png');
const {render}=require('../proposals/template');
const raw=fs.readFileSync(path.join(__dirname,'../assets/portal-cta.png'));
const img=decodificarRgba(raw);
const base={ snapshot:{attachmentId:'attEEEEEEEEEEEEEE',proposal:{id:'recAAAAAAAAAAAAAA',numero:'03',cnpj:'12345678000199',valor:30}}};
const invoice={id:'recDDDDDDDDDDDDDD',contractName:'C03',attachments:[{id:'attFFFFFFFFFFFFFF',tipo:'nfse',filename:'NF.pdf'}]};
test('faixa PNG 3x, RGBA, recortes V, cor sólida e texto branco',()=>{
 assert.deepEqual([img.largura,img.altura],[1392,156]);
 assert.equal(raw[25],6,'PNG RGBA color type');
 for(const [x,y] of [[0,0],[1391,0],[0,155],[1391,155],[0,78],[1391,78]])assert.equal(img.pixel(x,y)[3],0,`transparente ${x},${y}`);
 assert.deepEqual(img.pixel(50,78),[27,54,79,255]);
 let whites=0;
 for(let y=40;y<115;y++)for(let x=400;x<1000;x++){
  const [r,g,b,a]=img.pixel(x,y);if(a>245&&r>245&&g>245&&b>245)whites++;
 }
 assert.ok(whites>300,'letras brancas no centro');
});
test('os quatro eventos: um CTA, link somente da imagem, responsivo',()=>{
 for(const type of ['NEW','VERIFY','ACCEPTED','INVOICE']){
  const payload={...base,type};if(type==='VERIFY')payload.code='12345678';if(type==='INVOICE')payload.invoice=invoice;
  const html=render(payload,'https://portal.example.test',{password:'SENHA_TESTE'}).html;
  assert.equal((html.match(/cid:portalCta/g)||[]).length,1,type);
  assert.doesNotMatch(html,/portalCloud|portal-cloud/);
  const m=html.match(/<a href="https:\/\/portal\.example\.test\/login\.html" title="Acessar Portal do Cliente" target="_blank"[^>]*>(<img[^>]*>)<\/a>/);
  assert.ok(m,`${type}: ancora envolve apenas imagem`);
  assert.match(m[1],/width="464" height="52"/);
  assert.match(m[1],/max-width:464px;height:auto/);
  assert.match(m[1],/alt="Acessar Portal do Cliente"/);
  assert.doesNotMatch(m[0],/overflow:hidden/);
  if(type==='VERIFY') assert.doesNotMatch(html,/SENHA_TESTE/);
 }
});
