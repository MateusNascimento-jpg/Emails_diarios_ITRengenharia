'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
process.env.EMAIL_ATIVO='false';process.env.PAUSA_ENTRE_OS_MS='0';
const order={osNome:'OS sintética',linhas:[{recordId:'fake'}]};const load=Module._load;
Module._load=function(request,parent,isMain){
 if(parent?.filename.replace(/\\/g, '/').endsWith('/enviar_todos.js')){
  if(request==='./airtable.js')return {buscarResumoDiario:async()=>[{clienteId:'bad',acessoInvalido:true,acessoErro:'Cadastro incompleto',ordens:[order]},{clienteId:'good',clienteNome:'Válido',ordens:[order]}]};
  if(request==='./enviar_email.js')return {MODO_TESTE:false,enviar:async()=>{throw new Error('Nenhum envio permitido');},mascararDestinos:()=>''};
  if(request==='./enviar_whatsapp.js')return {CONFIG:{ativo:false,simular:true,modoTeste:false}};
  if(request==='./idempotencia_airtable.js')return {CONFIG:{ativo:false},reservarEnvio:async()=>{throw new Error('Nenhuma reserva permitida');}};
 }
 return load.call(this,request,parent,isMain);
};
const {executarEnvioDiario}=require('../enviar_todos');Module._load=load;
test('orquestrador pula cadastro inválido, continua outro cliente e reporta falha parcial',async()=>{
 const result=await executarEnvioDiario({origem:'teste'});assert.equal(result.ok,false);assert.equal(result.clientesComCadastroInvalido,1);assert.equal(result.ordensProcessadas,1);assert.equal(result.email.enviados,0);assert.equal(result.whatsapp.enviados,0);
});
