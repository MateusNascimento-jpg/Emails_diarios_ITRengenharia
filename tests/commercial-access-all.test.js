'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { accessForEmail }=require('../proposals/access');
const { render }=require('../proposals/template');

const env={AIRTABLE_FINANCE_TOKEN:'finance-fixture-token',AIRTABLE_TOKEN:'operations-fixture-token',
    AIRTABLE_BASE_ID:'app9VVQi45UmZ8feM'};
function fetcher({ambiguousFinance=false,ambiguousOperations=false,conflictingAcronym=null, email='a@example.test;b@example.test', acronym='ITR'}={}) {
    return async (url,options)=>{
        const parsed=new URL(url);
        const isFinance=parsed.pathname.includes('appI163NTfZrDtw22');
        assert.ok(options.headers.Authorization.startsWith('Bearer '));
        const rows=isFinance
            ?[{fields:{CNPJ:'12.345.678/0001-99','Email Cliente':email}},
              ...(ambiguousFinance?[{fields:{CNPJ:'12345678000199','Email Cliente':email}}]:[]),
              {fields:{CNPJ:'99999999000199','Email Cliente':'outro@example.test'}}]
            :[{fields:{CNPJ:'12345678000199','Sigla Cliente':acronym}},
              ...(ambiguousOperations?[{fields:{CNPJ:'12345678000199','Sigla Cliente':conflictingAcronym ?? acronym}}]:[])];
        return {ok:true,json:async()=>({records:rows})};
    };
}
test('todos os contatos financeiros recebem acesso quando existe correspondência segura',async()=>{
    for(const address of ['a@example.test','b@example.test'])
        assert.equal(await accessForEmail('12345678000199',address,{env,fetcher:fetcher()}),'ITR123456');
    assert.equal(await accessForEmail('12345678000199','outro@example.test',{env,fetcher:fetcher()}),null);
});
test('bloqueia credencial em CNPJ financeiro duplicado, siglas operacionais divergentes ou sigla vazia',async()=>{
    for(const scenario of [{ambiguousFinance:true},{ambiguousOperations:true,conflictingAcronym:'OUTRA'},{acronym:''},
        {ambiguousOperations:true,conflictingAcronym:''}])
        assert.equal(await accessForEmail('12345678000199','a@example.test',{env,fetcher:fetcher(scenario)}),null);
});
// Mesma regra do login do Portal (buscarIdentidadeAcesso): vários cadastros
// operacionais do CNPJ com a MESMA sigla geram a mesma senha válida.
test('cadastros operacionais repetidos com a mesma sigla recebem a senha aceita pelo Portal',async()=>{
    assert.equal(await accessForEmail('12345678000199','a@example.test',
        {env,fetcher:fetcher({ambiguousOperations:true})}),'ITR123456');
});
test('indisponibilidade do Airtable é transitória; recusa de credencial é definitiva',async()=>{
    for(const failing of [async()=>{throw new Error('ECONNRESET');},
        async()=>({ok:false,status:429}),async()=>({ok:false,status:503}),async()=>({ok:true,status:200,json:async()=>({})})])
        await assert.rejects(accessForEmail('12345678000199','a@example.test',{env,fetcher:failing}),(e)=>e.transient===true);
    await assert.rejects(accessForEmail('12345678000199','a@example.test',{env,fetcher:async()=>({ok:false,status:403})}),
        (e)=>!e.transient);
    assert.equal(await accessForEmail('12345678000199','a@example.test',{env:{},fetcher:fetcher()}),null);
});
test('não precisa da variável PORTAL_AUTHORIZED_CONTACTS_TABLE_ID',async()=>{
    assert.equal(await accessForEmail('12345678000199','a@example.test',{env,fetcher:fetcher()}),'ITR123456');
});
test('e-mail de código não revela a senha mesmo quando ela é passada ao template',()=>{
    const origin='https://portal.example.test';
    const proposal={id:'recAAAAAAAAAAAAAA',cnpj:'12345678000199',numero:'03',nomeCliente:'Cliente',valor:100};
    const snapshot={proposal,version:'a'.repeat(64),attachmentId:'attAAAAAAAAAAAAAA'};
    const message=render({type:'VERIFY',snapshot,code:'12345678'},origin,{password:'SENHA_PROIBIDA'});
    assert.match(message.html,/12345678/);
    assert.doesNotMatch(message.html,/SENHA_PROIBIDA/);
    assert.doesNotMatch(message.texto,/SENHA_PROIBIDA/);
});
