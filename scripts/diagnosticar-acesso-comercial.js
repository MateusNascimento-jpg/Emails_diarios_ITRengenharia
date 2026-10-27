'use strict';
// Diagnóstico de leitura para uso EXCLUSIVO no contêiner de E-MAILS.
// Nunca mostra a senha calculada, CNPJ, e-mail ou tokens na saída.
require('dotenv').config({ quiet: true });
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { accessForEmail } = require('../proposals/access');

async function main() {
    const prompt = readline.createInterface({ input: stdin, output: stdout });
    let cnpj, email;
    try {
        cnpj = await prompt.question('CNPJ do cliente (somente para consulta): ');
        email = await prompt.question('E-mail destinatário (somente para consulta): ');
    } finally { prompt.close(); }
    let codigo = 'SEM_DIAGNOSTICO';
    try {
        const senha = await accessForEmail(cnpj, email, {
            onDecision: (code) => { codigo = code; },
        });
        console.log('CREDENCIAL_AUTORIZADA:', Boolean(senha));
        console.log('CODIGO_DO_DIAGNOSTICO:', codigo);
        console.log('Nenhum e-mail enviado. Nenhuma alteracao realizada.');
    } catch (error) {
        console.log('CREDENCIAL_AUTORIZADA:', false);
        console.log('CODIGO_DO_DIAGNOSTICO:', codigo);
        console.log('CONSULTA_FALHOU:', error?.transient ? 'TEMPORARIA' : 'CADASTRO_OU_PERMISSAO');
        if ([401, 403, 422].includes(error?.status)) console.log('AIRTABLE_HTTP:', error.status);
        process.exitCode = 1;
    }
}
main().catch(() => { console.error('Falha no diagnostico de leitura.'); process.exitCode = 1; });
