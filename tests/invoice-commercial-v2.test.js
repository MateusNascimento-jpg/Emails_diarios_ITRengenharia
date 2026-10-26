'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {render}=require('../proposals/template');const {valid}=require('../proposals/receiver');
const inv={eventId:'a'.repeat(64),type:'INVOICE',recipient:'contato@example.test',
 snapshot:{version:'b'.repeat(64),pdfHash:'c'.repeat(64),filename:'Proposta.pdf',attachmentId:'attEEEEEEEEEEEEEE',proposal:{id:'recAAAAAAAAAAAAAA',cnpj:'12345678000199',numero:'03',valor:1500,nomeCliente:'Exemplo',formaPagamento:'Entrada',prazoPagamentoDias:10}},
 invoice:{id:'recDDDDDDDDDDDDDD',contractId:'recCCCCCCCCCCCCCC',contractName:'C03',
  documentVersion:'d'.repeat(64),parcela:'Parcela 1',vencimento:'2026-11-20',attachments:[{id:'attEEEEEEEEEEEEEE',tipo:'nfse',filename:'nota.pdf',sha256:'e'.repeat(64)}]}};
test('INVOICE valida envelope, documento e mensagens sem senha no pedido de verificação',()=>{
 assert.equal(valid(inv),true);
 const body=render(inv,'https://portal.example.test',{password:'SIG123456'});
 assert.match(body.html,/Nota fiscal disponível/);
 assert.match(body.html,/C03/);
 assert.match(body.html,/SIG123456/);
 assert.match(body.html,/documentos\/nfse\/recDDDDDDDDDDDDDD\/attEEEEEEEEEEEEEE/);
 assert.equal(valid({...inv,invoice:{...inv.invoice,attachments:[]}}),false);
});
