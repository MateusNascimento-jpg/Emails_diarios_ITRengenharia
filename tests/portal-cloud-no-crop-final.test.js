'use strict';

// CTA "Portal do Cliente" (decisão 24/10, ADR-008): a nuvem é a própria imagem
// PNG — cópia fiel da referência aprovada —, inteira, com ponta, texto
// incorporado e fundo transparente; o link cobre a imagem e nada em volta pode
// recortá-la ou desenhar um retângulo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('../proposals/template');
const { decodificarRgba } = require('./helpers/png');

const png = fs.readFileSync(path.join(__dirname, '../assets/portal-cloud.png'));
const payload = { type: 'ACCEPTED', snapshot: { attachmentId: 'attEEEEEEEEEEEEEE', proposal: { id: 'recAAAAAAAAAAAAAA', numero: '03', valor: 24500, cnpj: '00000000000000' } } };

test('PNG da nuvem: 3x do tamanho exibido, RGBA, bordas 100% transparentes e cor aprovada', () => {
    const imagem = decodificarRgba(png);
    assert.deepEqual([imagem.largura, imagem.altura], [672, 390]);
    // Folga transparente em volta de toda a silhueta (sem fundo retangular e sem corte).
    for (let x = 0; x < imagem.largura; x += 1) {
        for (const y of [0, 1, 2, 3, imagem.altura - 4, imagem.altura - 3, imagem.altura - 2, imagem.altura - 1]) {
            assert.equal(imagem.pixel(x, y)[3], 0, `borda horizontal opaca em ${x},${y}`);
        }
    }
    for (let y = 0; y < imagem.altura; y += 1) {
        for (const x of [0, 1, 2, 3, imagem.largura - 4, imagem.largura - 3, imagem.largura - 2, imagem.largura - 1]) {
            assert.equal(imagem.pixel(x, y)[3], 0, `borda vertical opaca em ${x},${y}`);
        }
    }
    // Ponta inteira: há pixels opacos junto ao vértice da ponta (inferior esquerda)…
    let ponta = 0;
    for (let y = 320; y < 356; y += 1) for (let x = 140; x < 200; x += 1) if (imagem.pixel(x, y)[3] > 200) ponta += 1;
    assert.ok(ponta > 50, 'vértice da ponta presente');
    // …e o corpo tem a cor azul-índigo aprovada (#1800AD).
    assert.deepEqual(imagem.pixel(100, 250), [0x18, 0x00, 0xad, 255]);
    // Texto branco incorporado no centro.
    let branco = 0;
    for (let x = 200; x < 450; x += 1) { const [r, g, b, a] = imagem.pixel(x, 165); if (a === 255 && r > 240 && g > 240 && b > 240) branco += 1; }
    assert.ok(branco > 10, 'texto branco incorporado');
});

// Silhueta de uma imagem: na referência (print), pixels azul-índigo com os
// furos das letras preenchidos; no PNG final, alfa > 127. Recortada na caixa.
function silhueta(imagem, opaco) {
    const { largura: w, altura: h } = imagem;
    const dentro = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) dentro[y * w + x] = opaco(imagem.pixel(x, y)) ? 1 : 0;
    // Preenche furos: tudo que não é alcançável a partir da borda faz parte da nuvem.
    const fora = new Uint8Array(w * h);
    const fila = [];
    for (let x = 0; x < w; x += 1) fila.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y += 1) fila.push(y * w, y * w + w - 1);
    while (fila.length) {
        const i = fila.pop();
        if (fora[i] || dentro[i]) continue;
        fora[i] = 1;
        const x = i % w;
        if (x > 0) fila.push(i - 1);
        if (x < w - 1) fila.push(i + 1);
        if (i >= w) fila.push(i - w);
        if (i < w * (h - 1)) fila.push(i + w);
    }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < w * h; i += 1) if (!fora[i]) {
        const x = i % w, y = (i - x) / w;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1, em: (x, y) => !fora[(y0 + y) * w + x0 + x] };
}

test('nuvem é cópia fiel da referência aprovada: silhueta coincide ≥ 98,5% e mesma proporção', () => {
    const referencia = decodificarRgba(fs.readFileSync(path.join(__dirname, '../scripts/referencias/portal-cloud-referencia.png')));
    const ref = silhueta(referencia, ([r, g, b]) => b > 120 && r < 110 && g < 90);
    const nova = silhueta(decodificarRgba(png), ([, , , a]) => a > 127);
    assert.ok(Math.abs(nova.w / nova.h - ref.w / ref.h) < 0.02, 'mesma proporção da nuvem aprovada');
    // Reduz a silhueta nova à resolução da referência (média por bloco) e compara.
    let intersecao = 0, uniao = 0;
    for (let y = 0; y < ref.h; y += 1) {
        for (let x = 0; x < ref.w; x += 1) {
            const xa = Math.floor(x * nova.w / ref.w), xb = Math.max(xa + 1, Math.floor((x + 1) * nova.w / ref.w));
            const ya = Math.floor(y * nova.h / ref.h), yb = Math.max(ya + 1, Math.floor((y + 1) * nova.h / ref.h));
            let soma = 0;
            for (let yy = ya; yy < yb; yy += 1) for (let xx = xa; xx < xb; xx += 1) soma += nova.em(xx, yy) ? 1 : 0;
            const n = soma * 2 > (xb - xa) * (yb - ya);
            const r = ref.em(x, y);
            if (n && r) intersecao += 1;
            if (n || r) uniao += 1;
        }
    }
    assert.ok(intersecao / uniao >= 0.985, `silhueta coincide ${(100 * intersecao / uniao).toFixed(2)}% com a referência`);
});

test('HTML: imagem com a mesma proporção do arquivo, link envolvendo só a imagem, sem recorte nem fundo', () => {
    const html = render(payload, 'https://portal.example.test', { password: 'DEMO2026' }).html;
    const bloco = html.match(/<a href="https:\/\/portal\.example\.test\/login\.html"[^>]*>(<img[^>]*>)<\/a>/);
    assert.ok(bloco, 'link do Portal envolve exatamente a imagem');
    const img = bloco[1];
    assert.match(img, /src="cid:portalCloud"/);
    assert.match(img, /width="224" height="130"/, '224x130 = um terço exato de 672x390');
    assert.match(img, /width:100%;max-width:224px;height:auto/, 'reduz proporcionalmente em telas estreitas');
    assert.match(img, /alt="Acessar Portal do Cliente"/);
    assert.doesNotMatch(bloco[0], /background|border-radius|padding/, 'nenhum retângulo/botão atrás da nuvem');
    assert.doesNotMatch(html, /overflow:hidden/, 'nenhum ancestral recorta a imagem');
    assert.equal((html.match(/cid:portalCloud/g) || []).length, 1);
});
