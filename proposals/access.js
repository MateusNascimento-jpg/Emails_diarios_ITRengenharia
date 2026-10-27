'use strict';

// A senha continua FORA dos eventos e da outbox. Só é calculada
// no serviço SMTP, após confirmar a titularidade do contato na
// base Financeira e a sigla inequívoca na base Operacional.
const { documento, senhaGerada, campoSigla, emails } = require('../lib/portal-access');
const FINANCE_BASE = 'appI163NTfZrDtw22';
const FINANCE_CLIENTS = 'tbl8Sw1hYuEvgot8O';
// IDs canônicos do cadastro financeiro no Portal: resistem a renomeação
// de colunas no Airtable (nomes de campo não são chave estável).
const FINANCE_CNPJ_FIELD = 'fldb8XcWv0Uooz3Uo';
const FINANCE_EMAIL_FIELD = 'fldtqo76edbzzQcNz';

// Falha transitória (rede, timeout, 429/5xx): o receptor adia o envio para
// não mandar o e-mail sem a credencial. Recusa definitiva (cadastro ou
// configuração) devolve null e a mensagem segue só com o CNPJ.
function transient(message) {
    return Object.assign(new Error(message), { transient: true });
}

async function list(base, table, fields, token, fetcher, { byId = false } = {}) {
    const records = [];
    const seen = new Set();
    let offset = '';
    do {
        const params = new URLSearchParams({ pageSize: '100' });
        if (byId) params.set('returnFieldsByFieldId', 'true');
        for (const field of fields) params.append('fields[]', field);
        if (offset) params.set('offset', offset);
        let response;
        try {
            response = await fetcher(`https://api.airtable.com/v0/${base}/${table}?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(12000),
            });
        } catch (_) {
            throw transient('ACCESS_DIRECTORY_UNAVAILABLE');
        }
        if (response.status === 429 || response.status >= 500) throw transient('ACCESS_DIRECTORY_UNAVAILABLE');
        if (!response.ok) throw new Error('ACCESS_DIRECTORY_DENIED');
        let payload;
        try { payload = await response.json(); } catch (_) { throw transient('ACCESS_DIRECTORY_UNAVAILABLE'); }
        if (!Array.isArray(payload?.records)) throw transient('ACCESS_DIRECTORY_UNAVAILABLE');
        records.push(...payload.records);
        offset = payload.offset || '';
        if (offset && seen.has(offset)) throw new Error('ACCESS_DIRECTORY_AMBIGUOUS');
        seen.add(offset);
        if (records.length > 10000) throw new Error('ACCESS_DIRECTORY_TOO_LARGE');
    } while (offset);
    return records;
}

async function accessForEmail(cnpj, email, {
    env = process.env, fetcher = fetch, onDecision = () => {},
} = {}) {
    // Motivos são códigos não sensíveis: nunca registrar CNPJ, e-mail ou senha.
    const report = (code) => { try { onDecision(code); } catch (_) {} };
    const doc = documento(cnpj);
    const destination = String(email || '').trim().toLowerCase();
    if (!/^\d{14}$/.test(doc) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) { report('INPUT_INVALID'); return null; }

    const financeToken = env.AIRTABLE_FINANCE_TOKEN || env.AIRTABLE_TOKEN;
    const operationalToken = env.AIRTABLE_TOKEN;
    if (!financeToken || !operationalToken || !env.AIRTABLE_BASE_ID) {
        report('AIRTABLE_CONFIG_INCOMPLETE'); return null;
    }
    const financeBase = env.AIRTABLE_FINANCE_BASE_ID || FINANCE_BASE;
    if (!/^app[A-Za-z0-9]{14}$/.test(financeBase)) {
        report('FINANCE_BASE_INVALID'); return null;
    }

    // Um único cliente financeiro deve corresponder ao CNPJ. O destinatário
    // precisa estar no campo Email Cliente desse MESMO registro.
    let finance;
    try {
        finance = await list(financeBase, FINANCE_CLIENTS,
            [FINANCE_CNPJ_FIELD, FINANCE_EMAIL_FIELD], financeToken, fetcher, { byId: true });
    } catch (error) {
        report(error.transient ? 'FINANCE_LOOKUP_TEMPORARY' : 'FINANCE_LOOKUP_DENIED');
        throw error;
    }
    // Em testes antigos a API simulada pode devolver nomes; produção utiliza IDs.
    const financeCnpj = (r) => documento(r.fields?.[FINANCE_CNPJ_FIELD] ?? r.fields?.CNPJ);
    const financeEmails = (r) => emails(r.fields?.[FINANCE_EMAIL_FIELD] ?? r.fields?.['Email Cliente']);
    const matchedFinance = finance.filter((record) => financeCnpj(record) === doc);
    if (matchedFinance.length === 0) { report('FINANCE_CLIENT_NOT_FOUND'); return null; }
    if (matchedFinance.length !== 1) { report('FINANCE_CLIENT_AMBIGUOUS'); return null; }
    if (!financeEmails(matchedFinance[0]).includes(destination)) {
        report('FINANCE_RECIPIENT_NOT_AUTHORIZED'); return null;
    }

    // A base Operacional é fonte canônica da sigla usada no login atual.
    // Mesma regra do login do Portal (airtable.js → buscarIdentidadeAcesso):
    // todos os cadastros do CNPJ devem gerar a MESMA senha. Assim a senha do
    // e-mail é exatamente a que o Portal aceita; sigla ausente ou siglas
    // divergentes (login impossível no Portal) bloqueiam a divulgação.
    const operationalTable = env.AIRTABLE_CLIENTES_TABLE_ID || 'tblkQxQ6q7cBKXZ3C';
    const sigla = campoSigla(env);
    let clients;
    try {
        clients = await list(env.AIRTABLE_BASE_ID, operationalTable,
            ['CNPJ', sigla], operationalToken, fetcher);
    } catch (error) {
        report(error.transient ? 'OPERATIONAL_LOOKUP_TEMPORARY' : 'OPERATIONAL_LOOKUP_DENIED');
        throw error;
    }
    const passwords = clients.filter((record) => documento(record.fields?.CNPJ) === doc)
        .map((record) => senhaGerada(record.fields?.[sigla] || '', doc));
    if (!passwords.length) { report('OPERATIONAL_CLIENT_NOT_FOUND'); return null; }
    if (passwords.some((value) => !value) || new Set(passwords).size !== 1) {
        report('OPERATIONAL_PASSWORD_AMBIGUOUS'); return null;
    }
    report('AUTHORIZED');
    return passwords[0];
}

module.exports = { list, accessForEmail };
