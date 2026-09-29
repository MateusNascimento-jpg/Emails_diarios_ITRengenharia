"use strict";
const { senhaGerada, emails, documento } = require('./lib/portal-access');
const { normalizarTelefoneE164 } = require('./lib/telefone');
async function carregarClientesAcesso(request) {
  const table = process.env.AIRTABLE_CLIENTES_TABLE_ID || 'tblkQxQ6q7cBKXZ3C';
  const base = process.env.AIRTABLE_BASE_ID;
  const siglaField = require('./lib/portal-access').campoSigla();
  const all = []; let offset = ''; const seen = new Set();
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    for (const f of ['CNPJ', 'ID Cliente', 'Email Cliente', 'WhatsApp do Cliente', siglaField]) q.append('fields[]', f);
    if (offset) q.set('offset', offset);
    const data = await request(`https://api.airtable.com/v0/${encodeURIComponent(base)}/${encodeURIComponent(table)}?${q}`, {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, Accept: 'application/json'
    });
    all.push(...(data.records || []));
    offset = data.offset || '';
    if (offset && seen.has(offset)) throw new Error('Paginação circular na tabela de Clientes.');
    seen.add(offset);
    if (offset) await new Promise(r => setTimeout(r, 220));
  } while (offset);
  return { records: all, siglaField };
}
function enriquecerClientes(clientes, { records, siglaField }) {
  const byId = new Map(records.map(r => [r.id, r]));
  for (const cliente of clientes) {
    const rec = byId.get(cliente.clienteId);
    const cnpj = documento(rec?.fields?.CNPJ);
    const group = cnpj.length === 14 ? records.filter(r => documento(r.fields?.CNPJ) === cnpj) : [];
    const passwords = group.map(r => senhaGerada(r.fields?.[siglaField], cnpj));
    if (!passwords.length || passwords.some(p => !p) || new Set(passwords).size !== 1) {
      Object.assign(cliente, { acessoInvalido: true, siglaCliente: '', senhaAcesso: null, acessoErro: 'CNPJ ou Sigla Cliente ausente ou conflitante', emails: [], email: '', emailPrincipal: '', whatsappsParaEnvio: [], whatsappsEncontrados: [], whatsapp: '', whatsappSeguroParaEnvio: false });
      for (const ordem of cliente.ordens || []) { ordem.emails = []; ordem.emailPrincipal = ''; }
      continue;
    }
    const contacts = emails(group.map(r => r.fields?.['Email Cliente']));
    const phones = [...new Set(group.flatMap(r => String(r.fields?.['WhatsApp do Cliente'] || '').split(/[;,\r\n]+/))
      .map(v => normalizarTelefoneE164(v, process.env.AIRTABLE_WHATSAPP_COUNTRY_CODE || '55'))
      .filter(v => v.ok).map(v => v.telefone))];
    Object.assign(cliente, { acessoInvalido: false, acessoErro: null, cnpj, siglaCliente: String(rec.fields[siglaField]).trim(), senhaAcesso: passwords[0],
      contatosCadastro: true, emails: contacts, email: contacts.join(';'), emailPrincipal: contacts[0] || '',
      whatsapp: phones[0] || '', whatsappsEncontrados: phones, whatsappsParaEnvio: phones,
      whatsappSeguroParaEnvio: phones.length > 0, whatsappAmbiguo: false,
      whatsappBloqueado: false, whatsappTodosBloqueados: false,
      whatsappInvalido: false, telefoneInvalido: false, whatsappValido: phones.length > 0,
      whatsappMotivosBloqueio: [], whatsappCompartilhadoBloqueante: false,
      whatsappDuplicadoEntreClientes: false, clientesComMesmoWhatsapp: [],
      clienteNome: rec.fields['ID Cliente'] || cliente.clienteNome });
    for (const ordem of cliente.ordens || []) { ordem.emails = contacts; ordem.emailPrincipal = contacts[0] || ''; }
  }
  const owners = new Map();
  for (const r of records) {
    for (const raw of String(r.fields?.['WhatsApp do Cliente'] || '').split(/[;,\r\n]+/)) {
      const phone = normalizarTelefoneE164(raw, process.env.AIRTABLE_WHATSAPP_COUNTRY_CODE || '55');
      if (!phone.ok) continue;
      if (!owners.has(phone.telefone)) owners.set(phone.telefone, new Set());
      owners.get(phone.telefone).add(documento(r.fields?.CNPJ) || r.id);
    }
  }
  for (const c of clientes) {
    if (c.acessoInvalido) continue;
    c.whatsappDuplicadoEntreClientes = c.whatsappsEncontrados.some(n => (owners.get(n)?.size || 0) > 1);
    c.whatsappCompartilhadoBloqueante = c.whatsappDuplicadoEntreClientes && /^(true|1|sim)$/i.test(process.env.AIRTABLE_BLOQUEAR_WHATSAPP_COMPARTILHADO || 'false');
    if (c.whatsappCompartilhadoBloqueante) {
      c.whatsappSeguroParaEnvio = false;
      c.whatsappMotivosBloqueio = ['numero-compartilhado-entre-clientes'];
    }
  }
  return clientes;
}
module.exports = { carregarClientesAcesso, enriquecerClientes };
