'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { configuration } = require('./receiver');
const { gravarAtomico } = require('../integridade_notifications');
require('dotenv').config({ quiet: true });

function main() {
    const config = configuration();
    if (!config.enabled)
        throw new Error('Configure o módulo comercial antes de consultar seus recibos.');
    const [command = 'status', id] = process.argv.slice(2);
    if (command === 'status') {
        const totals = {};
        for (const file of fs.readdirSync(config.directory)) {
            if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
            const receipt = JSON.parse(fs.readFileSync(path.join(config.directory, file), 'utf8'));
            totals[receipt.state] = (totals[receipt.state] || 0) + 1;
            if (receipt.state !== 'sent') console.log(file.slice(0, 64), receipt.state);
        }
        console.log(totals);
        return;
    }
    if (
        !['confirmar-enviado', 'rearmar'].includes(command) ||
        !/^[a-f0-9]{64}$/.test(id || '') ||
        !process.argv.includes('--servidor-parado') ||
        !process.argv.includes('--confirmar')
    ) {
        throw new Error(
            'Revisão manual exige ID, --servidor-parado e --confirmar. Consulte o SMTP antes de decidir.',
        );
    }
    const file = path.join(config.directory, id + '.json');
    if (!fs.existsSync(file))
        throw new Error('Recibo ausente. Não é seguro adivinhar o resultado.');
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (receipt.state === 'sent') throw new Error('Envio concluído não pode ser rearmado.');
    fs.copyFileSync(file, file + '.' + Date.now() + '.backup', fs.constants.COPYFILE_EXCL);
    receipt.reviewedAt = new Date().toISOString();
    receipt.resolution = command;
    receipt.state = command === 'confirmar-enviado' ? 'sent' : 'retryable';
    gravarAtomico(file, receipt);
    if (fs.existsSync(file + '.lock')) fs.unlinkSync(file + '.lock');
    console.log(
        'Recibo revisado. Reative o mesmo evento no Portal; nunca crie outro ID para forçar reenvio.',
    );
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
