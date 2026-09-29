
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
const {senhaGerada,emails}=require('../lib/portal-access');
const {enriquecerClientes,carregarClientesAcesso}=require('../client_directory');
const {montarEmailsIndividualizados}=require('../email_template');
const {montarEmailAcesso}=require('../access_email_template');
test('senha usa exatamente seis dígitos, mantém caixa e rejeita cadastro incompleto',()=>{
 assert.equal(senhaGerada(' GCO ','17.205.251/0001-00'),'GCO172052');assert.equal(senhaGerada('gco','17205251000100'),'gco172052');assert.equal(senhaGerada('', '17205251000100'),null);assert.equal(senhaGerada('EX','123'),null);
 assert.deepEqual(emails(' A@example.test;b@example.test;A@example.test;invalido'),['a@example.test','b@example.test']);
});
test('cadastro autoritativo fornece todos os emails e telefones e remove lookup antigo',()=>{
 const records=[{id:'a',fields:{CNPJ:'12345678000190','Sigla Cliente':'EX','Email Cliente':'a@example.test;b@example.test','WhatsApp do Cliente':'5511999990001;5511999990002'}},{id:'b',fields:{CNPJ:'12345678000190','Sigla Cliente':'EX','Email Cliente':'c@example.test'}},{id:'c',fields:{CNPJ:'99999999000190','Sigla Cliente':'OTHER','Email Cliente':'outsider@example.test'}}];
 const cliente={clienteId:'a',ordens:[{osNome:'OS-1',emails:['stale@example.test'],linhas:[]}],whatsappMotivosBloqueio:['telefone-invalido']};
 enriquecerClientes([cliente],{records,siglaField:'Sigla Cliente'});
 assert.deepEqual(cliente.emails,['a@example.test','b@example.test','c@example.test']);assert.deepEqual(cliente.whatsappsParaEnvio,['5511999990001','5511999990002']);assert.deepEqual(cliente.whatsappMotivosBloqueio,[]);
 const messages=montarEmailsIndividualizados(cliente,cliente.ordens[0]);assert.equal(messages.length,3);for(const m of messages){assert.match(m.texto,/Senha: EX123456/);assert.doesNotMatch(m.texto,/primeiro acesso|senha inicial/i);}
 records[1].fields['Sigla Cliente']='CONFLICT';enriquecerClientes([cliente],{records,siglaField:'Sigla Cliente'});assert.equal(cliente.acessoInvalido,true);assert.deepEqual(cliente.emails,[]);
});
test('consulta do cadastro pagina e solicita os campos exatos',async()=>{
 let count=0;const result=await carregarClientesAcesso(async(url,headers)=>{assert.ok(headers.Authorization);assert.ok(new URL(url).searchParams.getAll('fields[]').includes('Email Cliente'));return ++count===1?{records:[{id:'a'}],offset:'next'}:{records:[{id:'b'}]};});assert.equal(count,2);assert.equal(result.records.length,2);
});
test('recuperação tem texto solicitado, logo CID em fundo escuro e escape HTML',()=>{
 const r=montarEmailAcesso({name:'Empresa <teste>',cnpj:'12345678000190',accessPassword:'EX123456'},'https://portal.itr.eng.br');assert.match(r.texto,/Conforme solicitado, seguem os dados para acesso ao Portal do Cliente ITR:/);assert.match(r.texto,/Senha: EX123456/);assert.match(r.html,/cid:logoITR/);assert.match(r.html,/bgcolor="#0f2543"/);assert.match(r.html,/Empresa &lt;teste&gt;/);assert.doesNotMatch(r.html,/#token|criar-senha/);
});
test('SMTP tenta cada destinatário individualmente mesmo após falha parcial',async()=>{
 const calls=[];const realLoad=Module._load;
 Module._load=function(request,parent,isMain){if(request==='./enviar_email.js'&&parent.filename.endsWith('security_notifications.js'))return {enviar:async message=>{calls.push(message);return {ok:calls.length!==2};}};return realLoad.call(this,request,parent,isMain);};
 let processar;try{delete require.cache[require.resolve('../security_notifications')];processar=require('../security_notifications').processarNotificacaoSeguranca;}finally{Module._load=realLoad;}
 await assert.rejects(()=>processar({type:'ACCESS_REQUEST',client:{name:'Teste',cnpj:'12345678000190',accessPassword:'EX123456',emails:['a@example.test','b@example.test','c@example.test']}}),/Todos foram tentados/);
 assert.deepEqual(calls.map(c=>c.para),[['a@example.test'],['b@example.test'],['c@example.test']]);assert.ok(calls.every(c=>c.texto.includes('EX123456')));
});

test('aliases de ambiente são aceitos sem permitir regra divergente entre serviços',()=>{
 const {campoSigla}=require('../lib/portal-access');
 assert.equal(campoSigla({AIRTABLE_CLIENT_ACRONYM_FIELD:'Sigla Cliente',PORTAL_ACCESS_CNPJ_DIGITS:'6'}),'Sigla Cliente');
 assert.equal(campoSigla({AIRTABLE_CAMPO_SIGLA_CLIENTE:'Sigla Cliente'}),'Sigla Cliente');
 assert.throws(()=>campoSigla({PORTAL_ACCESS_CNPJ_DIGITS:'7'}),/exige/);
 assert.throws(()=>campoSigla({AIRTABLE_CLIENT_SIGLA_FIELD:'A',AIRTABLE_CAMPO_SIGLA_CLIENTE:'B'}),/divergentes/);
});
test('cadastro inválido não impede enriquecer outro cliente válido',()=>{
 const clientes=[{clienteId:'invalid',ordens:[]},{clienteId:'valid',ordens:[]}];
 enriquecerClientes(clientes,{records:[{id:'valid',fields:{CNPJ:'12345678000190','Sigla Cliente':'EX','Email Cliente':'a@example.test'}}],siglaField:'Sigla Cliente'});
 assert.equal(clientes[0].acessoInvalido,true);assert.equal(clientes[1].acessoInvalido,false);assert.equal(clientes[1].senhaAcesso,'EX123456');
});
