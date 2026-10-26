'use strict';

// Decodificador PNG mínimo para testes (8 bits, RGB ou RGBA, sem
// entrelaçamento): suficiente para conferir dimensões, transparência e
// silhueta do CTA da nuvem sem dependências novas.

const zlib = require('node:zlib');

function decodificarRgba(buffer) {
    if (buffer.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error('não é PNG');
    let pos = 8;
    let largura = 0;
    let altura = 0;
    let bpp = 4;
    const dados = [];
    while (pos < buffer.length) {
        const tamanho = buffer.readUInt32BE(pos);
        const tipo = buffer.subarray(pos + 4, pos + 8).toString('ascii');
        const corpo = buffer.subarray(pos + 8, pos + 8 + tamanho);
        if (tipo === 'IHDR') {
            largura = corpo.readUInt32BE(0);
            altura = corpo.readUInt32BE(4);
            if (corpo[8] !== 8 || ![2, 6].includes(corpo[9]) || corpo[12] !== 0) throw new Error('esperado RGB/RGBA 8 bits sem entrelaçamento');
            bpp = corpo[9] === 6 ? 4 : 3;
        }
        if (tipo === 'IDAT') dados.push(corpo);
        if (tipo === 'IEND') break;
        pos += 12 + tamanho;
    }
    const bruto = zlib.inflateSync(Buffer.concat(dados));
    const linha = largura * bpp;
    const pixels = Buffer.alloc(linha * altura);
    for (let y = 0; y < altura; y += 1) {
        const filtro = bruto[y * (linha + 1)];
        const origem = bruto.subarray(y * (linha + 1) + 1, (y + 1) * (linha + 1));
        const atual = pixels.subarray(y * linha, (y + 1) * linha);
        const anterior = y ? pixels.subarray((y - 1) * linha, y * linha) : Buffer.alloc(linha);
        for (let x = 0; x < linha; x += 1) {
            const a = x >= bpp ? atual[x - bpp] : 0;
            const b = anterior[x];
            const c = x >= bpp ? anterior[x - bpp] : 0;
            let valor = origem[x];
            if (filtro === 1) valor += a;
            else if (filtro === 2) valor += b;
            else if (filtro === 3) valor += (a + b) >> 1;
            else if (filtro === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                valor += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            } else if (filtro !== 0) throw new Error('filtro PNG desconhecido');
            atual[x] = valor & 0xff;
        }
    }
    return {
        largura,
        altura,
        pixel(x, y) {
            const i = (y * largura + x) * bpp;
            return [pixels[i], pixels[i + 1], pixels[i + 2], bpp === 4 ? pixels[i + 3] : 255];
        },
    };
}

module.exports = { decodificarRgba };
