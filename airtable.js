// ============================================================
//  airtable.js  -  MODULO CENTRAL DE ACESSO AO AIRTABLE
// ------------------------------------------------------------
//  Responsabilidade unica: falar com o Airtable.
//  - le a tabela/view do Airtable
//  - IMPORTANTE: se usar uma view, ela NAO deve filtrar apenas "hoje".
//    A regra de data fica no codigo: enviar as atualizacoes de ONTEM.
//  - trata paginacao (a API traz de 100 em 100)
//  - agrupa: por ID do cliente  ->  por ID da ordem de servico
//
//  Chaves de agrupamento = record IDs (rec...) vindos dos campos de link.
//  Rotulos legiveis (nome do cliente, numero da OS) = campos "Texto".
//
//  Nada aqui envia email. Isso e responsabilidade de outro modulo.
// ============================================================

require('dotenv').config();

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const VIEW = process.env.AIRTABLE_VIEW_ID; // opcional, mas se usar deve ser uma view SEM filtro de data 'hoje'

const TABELA_NOVOS_TRABALHOS = process.env.AIRTABLE_TABLE_ID || 'tblJAP4Av9sWm8SmL';

// ------------------------------------------------------------
// STATUS QUE DISPARAM EMAIL (filtro no codigo)
// So registros com um destes status entram no email.
// ------------------------------------------------------------
const STATUS_PERMITIDOS = [
  'Aguardando Preparação',
  'Enviado ao Cliente',
];

// ------------------------------------------------------------
// NOMES EXATOS DOS CAMPOS (confirmados via ver_campos.js)
// Centralizados aqui: se um nome mudar no Airtable, muda so aqui.
// ------------------------------------------------------------
const CAMPOS = {
  // chaves de agrupamento (campos de link -> retornam ["rec..."])
  clienteLink: 'Cliente',            // record id do cliente
  osLink: 'Ordem de Serviço',        // record id da OS

  // rotulos legiveis (strings) para exibir no email
  clienteTexto: 'Cliente Texto',
  osTexto: 'OS Texto',

  // email de destino (lookup -> vem como array ["email@..."])
  emailCliente: 'Email do Cliente',

  // conteudo de cada linha do email
  idTrabalho: 'ID Trabalho',
  nomeTrabalho: 'Nome Trabalho',
  linkAmostras: 'Link Amostras',
  linkEnsaios: 'Link Ensaios',
  nomeCompletoEnsaios: 'Nome_Completo_Ensaios ', // ATENCAO: espaco no fim
  statusCliente: 'Status Cliente',
  status: 'Status', // status simples - usado no FILTRO de envio
  dataConclusao: 'Data de Conclusão do Ensaio',
  dataEnvioRelatorio: 'Data de Envio do Relatório',
  dataAtualizacao: 'Data da Última Atualização Update', // usado no FILTRO de "ontem"
}; 

// helper: extrai o primeiro record id de um campo de link.
// campos de link vem como array (ex: ["rec123"]); pega o primeiro.
function primeiroId(valor) {
  if (Array.isArray(valor) && valor.length > 0) return valor[0];
  if (typeof valor === 'string' && valor.startsWith('rec')) return valor;
  return null;
}

// helper: normaliza um valor para texto exibivel (trata array/vazio)
function texto(valor) {
  if (valor === undefined || valor === null) return '';
  if (Array.isArray(valor)) return valor.join(', ');
  return String(valor).trim();
}

// ------------------------------------------------------------
// FILTRO DE DATA: verifica se uma data (ISO) caiu ONTEM,
// no fuso de Brasilia. Usado para enviar de manha o que foi
// atualizado no dia anterior.
// ------------------------------------------------------------
function ehDeOntem(valorData) {
  // aceita string ISO ou array com ISO dentro
  let iso = valorData;
  if (Array.isArray(valorData)) iso = valorData[0];
  if (!iso) return false;

  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;

  // "agora" e "a data" convertidos para a data-calendario de Brasilia
  const fmt = (dt) => dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
  const hojeBR = fmt(new Date());
  const ontemBR = fmt(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const dataBR = fmt(d);

  return dataBR === ontemBR;
}

// ------------------------------------------------------------
// buscarRegistrosDaView()
//   Le TODOS os registros da view, seguindo a paginacao.
//   Retorna array cru de registros do Airtable.
// ------------------------------------------------------------
async function buscarRegistrosDaView() {
  if (!TOKEN || !BASE) {
    throw new Error('Faltam AIRTABLE_TOKEN ou AIRTABLE_BASE_ID no .env');
  }

  const headers = { Authorization: `Bearer ${TOKEN}` };
  let registros = [];
  let offset = undefined;

  do {
    let url = `https://api.airtable.com/v0/${BASE}/${TABELA_NOVOS_TRABALHOS}?pageSize=100`;
    if (VIEW) url += `&view=${encodeURIComponent(VIEW)}`;
    if (offset) url += `&offset=${offset}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const corpo = await resp.text();
      throw new Error(`Airtable respondeu ${resp.status}: ${corpo}`);
    }

    const dados = await resp.json();
    registros = registros.concat(dados.records || []);
    offset = dados.offset; // undefined quando acabou
  } while (offset);

  return registros;
}

// ------------------------------------------------------------
// agruparPorClienteEOS(registros)
//   Transforma a lista crua em:
//   [
//     {
//       clienteId, clienteNome,
//       ordens: [
//         { osId, osNome, linhas: [ {..dados do trabalho..}, ... ] },
//         ...
//       ]
//     },
//     ...
//   ]
//   Cada "ordem" vira 1 email (um email por OS de cada cliente).
// ------------------------------------------------------------
function agruparPorClienteEOS(registros, opcoes = {}) {
  const IGNORAR_DATA = opcoes.ignorarData === true;
  const clientes = new Map(); // clienteId -> objeto cliente

  for (const rec of registros) {
    const f = rec.fields || {};

    // FILTRO 1: so processa registros com status permitido (campo 'Status' simples)
    const statusReg = texto(f[CAMPOS.status]);
    if (!STATUS_PERMITIDOS.includes(statusReg)) {
      continue; // ignora qualquer outro status
    }

    // FILTRO 2: so registros atualizados ONTEM (envio matinal do dia anterior).
    // Pode ser desligado passando { ignorarData: true } — ver buscarResumoDiario.
    if (!IGNORAR_DATA && !ehDeOntem(f[CAMPOS.dataAtualizacao])) {
      continue;
    }

    const clienteId = primeiroId(f[CAMPOS.clienteLink]) || '(sem-cliente)';
    const osId = primeiroId(f[CAMPOS.osLink]) || '(sem-os)';

    // garante o cliente no mapa
    if (!clientes.has(clienteId)) {
      clientes.set(clienteId, {
        clienteId,
        clienteNome: texto(f[CAMPOS.clienteTexto]) || clienteId,
        email: texto(f[CAMPOS.emailCliente]), // lookup array -> string
        ordens: new Map(), // osId -> objeto ordem
      });
    }
    const cliente = clientes.get(clienteId);

    // se o email so aparecer em alguma linha posterior, captura assim que surgir
    if (!cliente.email) {
      const possivel = texto(f[CAMPOS.emailCliente]);
      if (possivel) cliente.email = possivel;
    }

    // garante a OS dentro do cliente
    if (!cliente.ordens.has(osId)) {
      cliente.ordens.set(osId, {
        osId,
        osNome: texto(f[CAMPOS.osTexto]) || osId,
        linhas: [],
      });
    }
    const ordem = cliente.ordens.get(osId);

    // monta a linha (uma linha = um trabalho/ensaio dentro da OS)
    ordem.linhas.push({
      idTrabalho: texto(f[CAMPOS.idTrabalho]),
      nomeTrabalho: texto(f[CAMPOS.nomeTrabalho]),
      amostra: texto(f[CAMPOS.linkAmostras]),
      ensaioSigla: texto(f[CAMPOS.linkEnsaios]),
      ensaioNome: texto(f[CAMPOS.nomeCompletoEnsaios]),
      status: texto(f[CAMPOS.status]), // Status simples -> de-para no template
      dataConclusao: texto(f[CAMPOS.dataConclusao]),
      dataEnvio: texto(f[CAMPOS.dataEnvioRelatorio]),
    });
  }

  // converte os Maps em arrays (mais facil de usar depois)
  return [...clientes.values()].map(c => ({
    clienteId: c.clienteId,
    clienteNome: c.clienteNome,
    email: c.email || '',
    ordens: [...c.ordens.values()],
  }));
}

// ------------------------------------------------------------
// buscarResumoDiario()
//   Funcao de alto nivel: le a view e ja devolve agrupado.
//   E' isso que o resto da aplicacao vai chamar.
// ------------------------------------------------------------
async function buscarResumoDiario(opcoes = {}) {
  const registros = await buscarRegistrosDaView();
  const agrupado = agruparPorClienteEOS(registros, opcoes);
  return agrupado;
}

module.exports = {
  buscarResumoDiario,
  buscarRegistrosDaView,
  agruparPorClienteEOS,
  CAMPOS,
};