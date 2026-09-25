'use strict';
require('dotenv').config({ quiet:true });
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const { carregarConfig, gravarAtomico }=require('./integridade_notifications');
function main(){
 const config=carregarConfig({...process.env,INTEGRIDADE_NOTIFICACOES_ATIVAS:'true'});
 const comando=process.argv[2]||'status';
 if(!fs.existsSync(config.diretorio)){console.log('Nenhum diretório de recibos criado ainda.');return;}
 if(comando==='status'){
  const totais={};const pendentes=[];
  for(const nome of fs.readdirSync(config.diretorio))if(/^[a-f0-9-]{36}\.json$/.test(nome)){
   const item=JSON.parse(fs.readFileSync(path.join(config.diretorio,nome),'utf8'));totais[item.estado]=(totais[item.estado]||0)+1;
   if(item.estado!=='sent' && pendentes.length<100)pendentes.push({eventId:item.eventId,estado:item.estado,atualizadoEm:item.atualizadoEm});
  }
  console.table(totais);console.table(pendentes);return;
 }
 const id=process.argv[3];
 if(!['rearmar','confirmar-entrega'].includes(comando)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id||'')||process.argv[4]!=='--confirmar')throw Error('Uso: node integridade_operacao.js status | rearmar EVENT_ID --confirmar | confirmar-entrega EVENT_ID --confirmar');
 const arquivo=path.join(config.diretorio,id+'.json');const item=JSON.parse(fs.readFileSync(arquivo,'utf8'));
 if(!['sending','uncertain','retryable'].includes(item.estado))throw Error('Estado não elegível para revisão.');
 const historico=path.join(config.diretorio,'historico');fs.mkdirSync(historico,{recursive:true,mode:0o700});
 gravarAtomico(path.join(historico,`${id}.${crypto.randomUUID()}.json`),item);
 item.estado=comando==='rearmar'?'retryable':'sent';item.atualizadoEm=new Date().toISOString();item.revisaoManual=comando;
 gravarAtomico(arquivo,item);
 const lock=path.join(config.diretorio,id+'.lock');if(fs.existsSync(lock))fs.unlinkSync(lock);
 console.log('Recibo atualizado. Reinicie o serviço e retome o evento no Portal. Execute revisão somente com o serviço de e-mails parado.');
}
try{main();}catch(e){console.error(e.message);process.exitCode=1;}
