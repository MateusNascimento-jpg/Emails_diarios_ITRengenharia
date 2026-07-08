// ============================================================
//  ver_campos.js  -  INSPECAO DO AIRTABLE (rode uma vez)
// ------------------------------------------------------------
//  O que faz:
//   PARTE 1: lista todas as VIEWS da tabela "Novos Trabalhos"
//            com seus IDs (viw...). Ache a sua e copie o ID.
//   PARTE 2: se voce ja colocou AIRTABLE_VIEW_ID no .env,
//            lista tambem os CAMPOS EXATOS que essa view
//            retorna (nomes literais, com acentos e espacos).
//
//  Como usar:
//   1) npm install
//   2) copie .env.exemplo para .env e preencha TOKEN e BASE_ID
//   3) node ver_campos.js
//   4) cole o resultado inteiro no chat
//   5) preencha AIRTABLE_VIEW_ID no .env e rode de novo (opcional)
// ============================================================

require('dotenv').config();

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const VIEW = process.env.AIRTABLE_VIEW_ID; // opcional na 1a rodada

// ID da tabela "Novos Trabalhos" (confirmado no doc da ITR).
const TABELA_NOVOS_TRABALHOS = 'tblJAP4Av9sWm8SmL';

// --- validacao basica antes de bater na API ---
if (!TOKEN || TOKEN.startsWith('pat_cole')) {
  console.error('\n[ERRO] AIRTABLE_TOKEN nao preenchido no .env. Abortando.\n');
  process.exit(1);
}
if (!BASE || BASE.startsWith('app_cole')) {
  console.error('\n[ERRO] AIRTABLE_BASE_ID nao preenchido no .env. Abortando.\n');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };

// ------------------------------------------------------------
// PARTE 1 - listar as views da tabela via Meta API (schema)
// ------------------------------------------------------------
async function listarViews() {
  const url = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;
  const resp = await fetch(url, { headers });

  if (!resp.ok) {
    const texto = await resp.text();
    console.error(`\n[ERRO] Meta API respondeu ${resp.status}.`);
    console.error('Causas comuns: token sem scope schema.bases:read, ou base nao autorizada no token.');
    console.error('Resposta:', texto, '\n');
    process.exit(1);
  }

  const dados = await resp.json();
  const tabela = (dados.tables || []).find(t => t.id === TABELA_NOVOS_TRABALHOS);

  if (!tabela) {
    console.error('\n[ERRO] Tabela "Novos Trabalhos" nao encontrada nesta base.');
    console.error('Verifique se o AIRTABLE_BASE_ID e da base certa.\n');
    process.exit(1);
  }

  console.log('\n==================================================');
  console.log('  VIEWS da tabela "Novos Trabalhos"');
  console.log('==================================================');
  (tabela.views || []).forEach(v => {
    console.log(`  "${v.name}"   ->   ${v.id}   [tipo: ${v.type}]`);
  });
  console.log('--------------------------------------------------');
  console.log('  Ache a SUA view acima e copie o id (viw...)');
  console.log('  para AIRTABLE_VIEW_ID no .env.');
  console.log('==================================================\n');

  return tabela;
}

// ------------------------------------------------------------
// PARTE 2 - listar os campos que a VIEW realmente retorna
//   (a API omite campos vazios, entao lemos algumas linhas
//    reais da view e juntamos todos os nomes que aparecem)
// ------------------------------------------------------------
async function listarCamposDaView() {
  // pega ate 15 registros da view para amostrar os campos
  const url = `https://api.airtable.com/v0/${BASE}/${TABELA_NOVOS_TRABALHOS}`
    + `?view=${encodeURIComponent(VIEW)}&maxRecords=15`;
  const resp = await fetch(url, { headers });

  if (!resp.ok) {
    const texto = await resp.text();
    console.error(`\n[ERRO] Leitura da view respondeu ${resp.status}.`);
    console.error('Causa comum: AIRTABLE_VIEW_ID errado, ou token sem data.records:read.');
    console.error('Resposta:', texto, '\n');
    process.exit(1);
  }

  const dados = await resp.json();
  const registros = dados.records || [];

  if (registros.length === 0) {
    console.log('\n[AVISO] A view existe mas nao retornou nenhum registro agora.');
    console.log('Se a view filtra "somente hoje", rode num dia com movimento,');
    console.log('ou afrouxe o filtro temporariamente so para inspecionar.\n');
    return;
  }

  // junta todos os nomes de campo vistos em qualquer um dos registros
  const nomes = new Set();
  registros.forEach(r => Object.keys(r.fields || {}).forEach(k => nomes.add(k)));

  console.log('\n==================================================');
  console.log(`  CAMPOS que a view retorna (amostra de ${registros.length} registros)`);
  console.log('==================================================');
  [...nomes].sort().forEach(nome => {
    // mostra o nome entre aspas para revelar espacos no fim
    const exemplo = registros.find(r => r.fields[nome] !== undefined)?.fields[nome];
    const tipo = Array.isArray(exemplo) ? 'array/link' : typeof exemplo;
    console.log(`  "${nome}"   [tipo aparente: ${tipo}]`);
  });
  console.log('--------------------------------------------------');
  console.log('  Copie ESTA lista inteira e cole no chat.');
  console.log('  (os nomes entre aspas sao LITERAIS: atencao a');
  console.log('   acentos e espacos no fim)');
  console.log('==================================================\n');
}

// ------------------------------------------------------------
(async () => {
  await listarViews();

  if (VIEW && VIEW.startsWith('viw')) {
    await listarCamposDaView();
  } else {
    console.log('[proximo passo] Preencha AIRTABLE_VIEW_ID no .env com o viw... da');
    console.log('sua view (da lista acima) e rode de novo para ver os campos.\n');
  }
})().catch(err => {
  console.error('\n[ERRO inesperado]', err.message, '\n');
  process.exit(1);
});