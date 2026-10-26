'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {render}=require('../proposals/template');
const base={snapshot:{attachmentId:'attEEEEEEEEEEEEEE',proposal:{id:'recAAAAAAAAAAAAAA',numero:'03',valor:24500,cnpj:'00000000000000',nomeCliente:'Empresa Exemplo',nomeContato:'Mariana Costa',descricao:'Serviço fictício',formaPagamento:'Entrada + parcela final',prazoPagamentoDias:10}}};
test('ACCEPTED respeita conteúdo comercial aprovado e mostra ambos os documentos',()=>{
 const m=render({...base,type:'ACCEPTED'},'https://portal.example.test',{password:'DEMO2026'});
 for(const trecho of ['Olá, <strong>Mariana Costa</strong>!', 'O aceite da <strong>Proposta nº 03</strong> foi registrado com sucesso','Agradecemos a confiança na <strong>ITR Engenharia</strong>!', 'Você pode consultar a proposta aceita', 'Descrição','Serviço fictício','Entrada + parcela final','Senha:</strong> DEMO2026','Documentos Integrais','Comprovante de Contrato','Mensagem automática de confirmação do aceite da Proposta nº 03']) assert.ok(m.html.includes(trecho),trecho);
 assert.ok(m.html.indexOf('Você pode consultar')<m.html.indexOf('cid:portalCloud'));
 assert.ok(m.html.indexOf('cid:portalCloud')<m.html.indexOf('Senha:</strong>'));
 assert.ok(m.html.indexOf('Atenciosamente')<m.html.indexOf('Documentos Integrais'));
});
test('NEW não afirma aceite e VERIFY não expõe senha permanente',()=>{
 const n=render({...base,type:'NEW'},'https://portal.example.test',{password:'DEMO2026'});
 assert.ok(n.html.includes('Nova proposta comercial disponível'));
 assert.ok(!n.html.includes('registrado com sucesso em nosso sistema'));
 const v=render({...base,type:'VERIFY',code:'12345678'},'https://portal.example.test',{password:'DEMO2026'});
 assert.ok(v.html.includes('VÁLIDO POR 2 HORAS'));
 assert.ok(!v.html.includes('DEMO2026'));
});
test('Nuvem: dimensões do <img> são exatamente um terço do PNG 3x e cabem no cartão de 640 px',()=>{
 const image=fs.readFileSync(path.join(__dirname,'../assets/portal-cloud.png'));
 assert.equal(image.subarray(1,4).toString(),'PNG');
 const width=image.readUInt32BE(16),height=image.readUInt32BE(20);
 const html=render({...base,type:'ACCEPTED'},'https://portal.example.test').html;
 const [,w,h]=html.match(/src="cid:portalCloud" width="(\d+)" height="(\d+)"/);
 assert.deepEqual([Number(w)*3,Number(h)*3],[width,height],'sem distorção no Outlook (usa width/height)');
 assert.match(html,/width="640"/);
 assert.ok(Number(w)<=580,'cabe na área útil do cartão');
 assert.doesNotMatch(html,/overflow:hidden/);
});
