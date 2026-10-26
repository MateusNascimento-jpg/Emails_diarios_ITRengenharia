'use strict';

// A senha continua FORA dos eventos e da outbox. Só é calculada
// no serviço SMTP, após confirmar a titularidade do contato na
// base Financeira e a sigla inequívoca na base Operacional.
const { documento, senhaGerada, campoSigla, emails } = require('../lib/portal-access');
const FINANCE_BASE = 'appI163NTfZrDtw22';
const FINANCE_CLIENTS = 'tbl8Sw1hYuEvgot8O';

async function list(base, table, fields, token, fetcher) {
    const records = [];
    const seen = new Set();
    let offset = '';
    do {
        const params = new URLSearchParams({ pageSize: '100' });
        for (const field of fields) params.append('fields[]', field);
        if (offset) params.set('offset', offset);
        const response = await fetcher(`https://api.airtable.com/v0/${base}/${table}?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) throw new Error('ACCESS_DIRECTORY_UNAVAILABLE');
        const payload = await response.json();
        if (!Array.isArray(payload.records)) throw new Error('ACCESS_DIRECTORY_UNAVAILABLE');
        records.push(...payload.records);
        offset = payload.offset || '';
        if (offset && seen.has(offset)) throw new Error('ACCESS_DIRECTORY_AMBIGUOUS');
        seen.add(offset);
        if (records.length > 10000) throw new Error('ACCESS_DIRECTORY_TOO_LARGE');
    } while (offset);
    return records;
}

async function accessForEmail(cnpj, email, {
    env = process.env, fetcher = fetch,
} = {}) {
    const doc = documento(cnpj);
    const destination = String(email || '').trim().toLowerCase();
    if (!/^\d{14}$/.test(doc) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) return null;

    const financeToken = env.AIRTABLE_FINANCE_TOKEN || env.AIRTABLE_TOKEN;
    const operationalToken = env.AIRTABLE_TOKEN;
    if (!financeToken || !operationalToken || !env.AIRTABLE_BASE_ID) return null;

    // Um único cliente financeiro deve corresponder ao CNPJ. O destinatário
    // precisa estar no campo Email Cliente desse MESMO registro.
    const finance = await list(FINANCE_BASE, FINANCE_CLIENTS,
        ['CNPJ', 'Email Cliente'], financeToken, fetcher);
    const matchedFinance = finance.filter((record) => documento(record.fields?.CNPJ) === doc);
    if (matchedFinance.length !== 1 ||
        !emails(matchedFinance[0].fields?.['Email Cliente']).includes(destination)) return null;

    // A base Operacional é fonte canônica da sigla usada no login atual.
    // Duplicidades ou sigla ausente bloqueiam a divulgação da senha.
    const operationalTable = env.AIRTABLE_CLIENTES_TABLE_ID || 'tblkQxQ6q7cBKXZ3C';
    const sigla = campoSigla(env);
    const clients = await list(env.AIRTABLE_BASE_ID, operationalTable,
        ['CNPJ', sigla], operationalToken, fetcher);
    const matches = clients.filter((record) => documento(record.fields?.CNPJ) === doc);
    if (matches.length !== 1) return null;
    return senhaGerada(matches[0].fields[sigla], doc);
}

module.exports = { list, accessForEmail };
