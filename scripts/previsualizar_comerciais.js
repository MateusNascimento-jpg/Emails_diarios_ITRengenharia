'use strict';

// Prévia local dos e-mails comerciais (NEW, VERIFY, ACCEPTED, INVOICE) com o
// MIME REAL montado por enviarComercial(). O transporte SMTP é trocado por um
// transporte em memória do próprio Nodemailer (streamTransport): nada sai da
// máquina, nenhum .env é lido e os dados são fictícios.
//
// Para cada evento grava <tipo>.eml (MIME completo) e <tipo>.html (o mesmo
// HTML com as imagens CID embutidas, para abrir no navegador). Com Playwright
// disponível (opcional), também grava capturas em 640 px e 360 px e confere
// que a nuvem aparece inteira, sem corte, dentro de um link para o Portal.
//
//   node scripts/previsualizar_comerciais.js <pasta-de-saida>

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');

const saida = path.resolve(process.argv[2] || 'previa-emails');
fs.mkdirSync(saida, { recursive: true });

// Ambiente apenas deste processo: nunca usa credenciais reais.
Object.assign(process.env, {
    EMAIL_ATIVO: 'true', EMAIL_MODO_TESTE: '', SMTP_HOST: 'smtp.invalid', SMTP_USER: 'previa', SMTP_PASS: 'previa',
    EMAIL_REMETENTE: 'ITR Engenharia <naoresponda@itr.eng.br>',
});
const mensagens = [];
const criarOriginal = nodemailer.createTransport;
nodemailer.createTransport = () => {
    const memoria = criarOriginal({ streamTransport: true, buffer: true, newline: 'unix' });
    return {
        async sendMail(opcoes) {
            const info = await memoria.sendMail(opcoes);
            mensagens.push({ opcoes, bruto: info.message });
            return { messageId: info.messageId, accepted: [opcoes.to], rejected: [] };
        },
    };
};
const { enviarComercial } = require('../enviar_email');
const { render } = require('../proposals/template');

const ORIGEM = 'https://portal.itr.eng.br';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');
const proposta = {
    id: 'recAAAAAAAAAAAAAA', numero: '03', valor: 24500, cnpj: '00000000000191',
    nomeCliente: 'Empresa Fictícia Ltda', descricao: 'Ensaios de caracterização de solos (dados fictícios)',
    formaPagamento: 'Entrada + parcela final', prazoPagamentoDias: 10,
};
const snapshot = { attachmentId: 'attEEEEEEEEEEEEEE', proposal: proposta };
const eventos = {
    NEW: { type: 'NEW', snapshot },
    VERIFY: { type: 'VERIFY', snapshot, code: '48213907' },
    ACCEPTED: { type: 'ACCEPTED', snapshot },
    INVOICE: { type: 'INVOICE', snapshot, invoice: { id: 'recDDDDDDDDDDDDDD', contractName: 'C03', parcela: 'C03 - Parcela 1',
        vencimento: '2026-11-20', attachments: [{ id: 'attFFFFFFFFFFFFFF', tipo: 'nfse', filename: 'NFSe_0001.pdf' }] } },
};
const SENHA_FICTICIA = 'DEMO000000';
const nuvem = fs.readFileSync(path.join(__dirname, '..', 'assets', 'portal-cloud.png'));
const logo = fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo.png'));

async function montar() {
    const gerados = [];
    for (const [tipo, payload] of Object.entries(eventos)) {
        const corpo = render(payload, ORIGEM, { password: tipo === 'VERIFY' ? null : SENHA_FICTICIA });
        const pdfs = tipo === 'ACCEPTED'
            ? [{ filename: 'Proposta_03.pdf', content: PDF }, { filename: 'Comprovante de Contrato.pdf', content: PDF }]
            : tipo === 'VERIFY' ? [] : [{ filename: tipo === 'INVOICE' ? 'NFSe_0001.pdf' : 'Proposta_03.pdf', content: PDF }];
        await enviarComercial({ para: 'contato@example.test', assunto: corpo.assunto, html: corpo.html, texto: corpo.texto, pdfs, eventId: tipo.toLowerCase() });
        const { opcoes, bruto } = mensagens.at(-1);
        const eml = bruto.toString('utf8');
        // O anexo inline do CID portalCloud é exatamente o PNG versionado.
        const inline = opcoes.attachments.find(a => a.cid === 'portalCloud');
        assert.ok(inline && inline.content.equals(nuvem), `${tipo}: CID portalCloud = assets/portal-cloud.png`);
        assert.match(eml, /Content-ID: <portalCloud>/, `${tipo}: Content-ID no MIME`);
        assert.match(eml, /Content-Type: image\/png; name=portal-cloud\.png/, `${tipo}: tipo PNG`);
        assert.match(eml, /Content-Disposition: inline; filename=portal-cloud\.png/, `${tipo}: inline`);
        assert.equal((opcoes.html.match(/cid:portalCloud/g) || []).length, 1, `${tipo}: uma nuvem`);
        assert.ok(!/<[^>]+overflow:hidden/.test(opcoes.html), `${tipo}: nenhum ancestral corta a imagem`);
        if (tipo === 'VERIFY') assert.ok(!eml.includes(SENHA_FICTICIA), 'VERIFY sem senha permanente');
        fs.writeFileSync(path.join(saida, `${tipo}.eml`), bruto);
        const html = opcoes.html
            .replace('cid:portalCloud', 'data:image/png;base64,' + nuvem.toString('base64'))
            .replace('cid:logoITR', 'data:image/png;base64,' + logo.toString('base64'));
        fs.writeFileSync(path.join(saida, `${tipo}.html`), html);
        gerados.push(tipo);
    }
    return gerados;
}

async function capturar(tipos) {
    let chromium;
    try { ({ chromium } = require('playwright')); } catch (_) { return 'Playwright ausente: capturas não geradas.'; }
    const browser = await chromium.launch({ headless: true });
    const linhas = [];
    try {
        for (const largura of [640, 360]) {
            const page = await browser.newPage({ viewport: { width: largura, height: 900 }, deviceScaleFactor: 2 });
            await page.route('**/*', rota => (rota.request().url().startsWith('file:') || rota.request().url().startsWith('data:') ? rota.continue() : rota.abort()));
            for (const tipo of tipos) {
                await page.goto('file://' + path.join(saida, `${tipo}.html`));
                const medida = await page.evaluate(() => {
                    const img = document.querySelector('img[alt="Acessar Portal do Cliente"]');
                    const link = img.closest('a');
                    const r = img.getBoundingClientRect();
                    // Nenhum ancestral pode recortar a imagem.
                    const cortes = [];
                    for (let el = img.parentElement; el; el = el.parentElement) {
                        const s = getComputedStyle(el);
                        if (s.overflow !== 'visible') {
                            const c = el.getBoundingClientRect();
                            if (r.left < c.left || r.right > c.right || r.top < c.top || r.bottom > c.bottom) cortes.push(el.tagName);
                        }
                    }
                    return {
                        largura: r.width, altura: r.height, natural: [img.naturalWidth, img.naturalHeight],
                        href: link && link.getAttribute('href'), cortes,
                        cobre: link && link.getBoundingClientRect().width >= r.width && link.getBoundingClientRect().height >= r.height - 1,
                        dentroDaTela: r.left >= 0 && r.right <= window.innerWidth,
                        semRolagem: document.documentElement.scrollWidth <= window.innerWidth,
                    };
                });
                const proporcao = medida.largura / medida.altura;
                assert.deepEqual(medida.natural, [672, 390], `${tipo}@${largura}: PNG 3x carregado`);
                assert.ok(Math.abs(proporcao - 672 / 390) < 0.01, `${tipo}@${largura}: sem distorção (${proporcao.toFixed(3)})`);
                assert.equal(medida.href, 'https://portal.itr.eng.br/login.html', `${tipo}@${largura}: link do Portal`);
                assert.ok(medida.cobre, `${tipo}@${largura}: link cobre a imagem inteira`);
                assert.deepEqual(medida.cortes, [], `${tipo}@${largura}: nenhum recorte`);
                assert.ok(medida.dentroDaTela && medida.semRolagem, `${tipo}@${largura}: sem rolagem horizontal`);
                await page.screenshot({ path: path.join(saida, `${tipo}-${largura}.png`), fullPage: true });
                const nuvemTela = page.locator('img[alt="Acessar Portal do Cliente"]');
                await nuvemTela.screenshot({ path: path.join(saida, `${tipo}-${largura}-nuvem.png`) });
                linhas.push(`${tipo} @ ${largura}px: nuvem ${Math.round(medida.largura)}x${Math.round(medida.altura)} px, proporção ${proporcao.toFixed(3)}, link ok, sem corte`);
            }
            await page.close();
        }
    } finally {
        await browser.close();
    }
    return linhas.join('\n');
}

montar()
    .then(async tipos => {
        const capturas = await capturar(tipos);
        const relatorio = `Prévia comercial: ${tipos.join(', ')} — MIME real (enviarComercial), CID portalCloud = PNG versionado.\n${capturas}\n`;
        fs.writeFileSync(path.join(saida, 'RELATORIO_PREVIA_EMAILS.txt'), relatorio);
        console.log(relatorio);
    })
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
