'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {render}=require('../proposals/template');
const {valid}=require('../proposals/receiver');
function payload(type){return {eventId:'a'.repeat(64),type,recipient:'contact@example.test',
 snapshot:{version:'b'.repeat(64),pdfHash:'c'.repeat(64),attachmentId:'att12345678901234',filename:'Proposta.pdf',
  proposal:{id:'recAAAAAAAAAAAAAA',cnpj:'12345678000199',numero:'03',nomeCliente:'Empresa Exemplo',valor:2300,formaPagamento:'Entrada',prazoPagamentoDias:10}},
  ...(type==='VERIFY'?{challengeId:'123e4567-e89b-42d3-a456-426614174000',expiresAt:Date.now()+7200000,code:'12345678'}:{}),
  ...(type==='ACCEPTED'?{documentHash:'d'.repeat(64)}:{})};}

test('VERIFY aceita código de 8 dígitos e não recebe senha permanente',()=>{
 const p=payload('VERIFY');assert.equal(valid(p,'https://portal.example.test'),true);
 const m=render(p,'https://portal.example.test',{password:'senha_injetada'});
 assert.match(m.html,/12345678/);assert.match(m.texto,/2 horas/);
 assert.ok(!m.html.includes('senha_injetada'));assert.ok(!m.texto.includes('senha_injetada'));
 assert.ok(!m.html.includes('Confirmar aceite'));
 assert.equal(valid({...p,code:'123456789'},'https://portal.example.test'),false);
});
test('NEW e ACCEPTED: senha apenas quando autorizada; texto e HTML coerentes',()=>{
 for(const type of ['NEW','ACCEPTED']){
  const p=payload(type);assert.equal(valid(p,'https://portal.example.test'),true);
  const hidden=render(p,'https://portal.example.test');assert.ok(!hidden.html.includes('Senha:</strong>'));
  const revealed=render(p,'https://portal.example.test',{password:'SIG123456'});
  assert.match(revealed.html,/SIG123456/);assert.match(revealed.texto,/SIG123456/);
  if (type === 'NEW') assert.match(revealed.html,/Documentos Integrais/);
  assert.match(revealed.html,/#1b364f/i); // azul-índigo aprovado (referência 22/10)
 }
});
