'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { accessForEmail } = require('../proposals/access');
const env = {
    AIRTABLE_FINANCE_TOKEN: 'token-fake',
    AIRTABLE_TOKEN: 'token-fake',
    AIRTABLE_BASE_ID: 'app9VVQi45UmZ8feM',
    AIRTABLE_FINANCE_BASE_ID: 'appI163NTfZrDtw22',
};
const FIN_CNPJ = 'fldb8XcWv0Uooz3Uo';
const FIN_EMAIL = 'fldtqo76edbzzQcNz';
function provider({ finance = true, recipient = true, acronym = 'EX', duplicate = false } = {}) {
    return async (rawUrl) => {
        const url = new URL(rawUrl);
        const financial = url.pathname.includes('/appI163NTfZrDtw22/');
        if (financial) {
            assert.equal(url.searchParams.get('returnFieldsByFieldId'), 'true');
            assert.ok(url.searchParams.getAll('fields[]').includes(FIN_EMAIL));
            const records = finance ? [{ fields: {
                [FIN_CNPJ]: '12.345.678/0001-99',
                [FIN_EMAIL]: recipient ? 'a@example.test' : 'outro@example.test',
            } }] : [];
            if (duplicate) records.push({ fields: records[0].fields });
            return { ok: true, json: async () => ({ records }) };
        }
        return { ok: true, json: async () => ({ records: [
            { fields: { CNPJ: '12345678000199', 'Sigla Cliente': acronym } },
        ] }) };
    };
}
test('campo financeiro renomeado: IDs autoritativos liberam SOMENTE a senha válida', async () => {
    const messages = [];
    const value = await accessForEmail('12345678000199', 'a@example.test', {
        env, fetcher: provider(), onDecision: (m) => messages.push(m),
    });
    assert.equal(value, 'EX123456');
    assert.deepEqual(messages, ['AUTHORIZED']);
});
test('nega acesso e explica a causa sem dados pessoais na classificação', async () => {
    for (const [scenario, code] of [
        [{finance:false}, 'FINANCE_CLIENT_NOT_FOUND'],
        [{recipient:false}, 'FINANCE_RECIPIENT_NOT_AUTHORIZED'],
        [{duplicate:true}, 'FINANCE_CLIENT_AMBIGUOUS'],
        [{acronym:''}, 'OPERATIONAL_PASSWORD_AMBIGUOUS'],
    ]) {
        let decision;
        const value = await accessForEmail('12345678000199', 'a@example.test', {
            env, fetcher: provider(scenario), onDecision: (m) => { decision = m; },
        });
        assert.equal(value, null);
        assert.equal(decision, code);
        assert.doesNotMatch(decision, /123456|example|EX/);
    }
});
test('não consulta bases sem token/configuração', async () => {
    let decision;
    const value = await accessForEmail('12345678000199', 'a@example.test', {
        env: {}, fetcher: async () => { throw new Error('NAO_DEVE_CONSULTAR'); },
        onDecision: code => { decision = code; },
    });
    assert.equal(value, null);
    assert.equal(decision, 'AIRTABLE_CONFIG_INCOMPLETE');
});
