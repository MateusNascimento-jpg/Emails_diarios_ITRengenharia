#!/usr/bin/env python3
"""Gera assets/portal-cloud.png — CTA "Portal do Cliente" dos e-mails comerciais.

CÓPIA FIEL da nuvem aprovada pelo usuário (24/10/2026): silhueta, ponta e
letreiro saem dos pixels de scripts/referencias/portal-cloud-referencia.png
(recorte só da nuvem, sem outro conteúdo do print). Nada é redesenhado nem
trocado de fonte.

Como funciona (Pillow + numpy):
1. Cobertura de cor por pixel entre o azul-índigo da nuvem (#1800AD) e o branco:
   a suavização da borda original vira uma medida de 0 a 1.
2. A silhueta tem os "furos" das letras preenchidos; o letreiro é o branco que
   fica dentro dela.
3. Ambas as coberturas são ampliadas (bicúbico) a 8x do tamanho final,
   suavizadas para remover o serrilhado do print e cortadas no nível 0,5 — o
   contorno passa exatamente pela borda original (vetorização por nível).
4. Redução LANCZOS para o PNG final (3x do tamanho exibido), com folga
   transparente em volta; fora da nuvem o alfa é 0 (sem fundo retangular).

Tamanho exibido: 224 x 130 px (nuvem com ~200 px de largura, o que deixa o
letreiro ~16% maior que o texto do corpo, como na referência). PNG: 672 x 390.

Uso:  python3 -I scripts/gerar_nuvem_portal.py [saida.png]
Este script não roda em produção; o PNG gerado é versionado em assets/.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RAIZ = Path(__file__).resolve().parent.parent
REFERENCIA = RAIZ / "scripts" / "referencias" / "portal-cloud-referencia.png"
LARGURA, ALTURA = 224, 130          # tamanho exibido (width/height do <img>)
LARGURA_NUVEM = 200                 # largura da silhueta no tamanho exibido
ESCALA_SAIDA, SUPER = 3, 8          # PNG final 3x; trabalho interno 8x
INDIGO = np.array([0x18, 0x00, 0xAD], dtype=float)
BRANCO = np.array([255, 255, 255], dtype=float)


def cobertura_indigo(rgb):
    """0 = branco, 1 = índigo; projeção de cada pixel na reta branco→índigo."""
    eixo = INDIGO - BRANCO
    c = ((rgb - BRANCO) @ eixo) / (eixo @ eixo)
    return np.clip(c, 0.0, 1.0)


def preencher_furos(binaria):
    """Tudo que não é alcançável a partir da borda (letras) passa a ser nuvem."""
    # .copy(): imagem vinda de array numpy é somente leitura para o floodfill.
    img = Image.fromarray(np.pad(binaria, 1).astype(np.uint8) * 255).copy()
    ImageDraw.floodfill(img, (0, 0), 128)
    return (np.asarray(img)[1:-1, 1:-1] != 128)


def ampliar_nivel(cobertura, tamanho, suavizar):
    """Amplia uma cobertura 0..1 e devolve a máscara do nível 0,5 (8 bits)."""
    img = Image.fromarray((cobertura * 255).round().astype(np.uint8))
    img = img.resize(tamanho, Image.BICUBIC).filter(ImageFilter.GaussianBlur(suavizar))
    return img.point(lambda v: 255 if v >= 128 else 0)


def gerar(destino):
    rgb = np.asarray(Image.open(REFERENCIA).convert("RGB")).astype(float)
    c = cobertura_indigo(rgb)
    silhueta = preencher_furos(c >= 0.5)
    # Interior seguro (2 px para dentro): ali, branco = letreiro.
    interior = np.asarray(Image.fromarray(silhueta.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5))) > 0
    forma = np.where(interior, 1.0, c)
    letreiro = np.where(interior, 1.0 - c, 0.0)

    ys, xs = np.nonzero(silhueta)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    k = SUPER * ESCALA_SAIDA
    escala = float(LARGURA_NUVEM * k / (x1 - x0))    # px de referência -> px internos
    alto_nuvem = (y1 - y0) * escala
    if alto_nuvem > (ALTURA - 16) * k:
        raise SystemExit("A nuvem não cabe na altura do canvas com folga transparente.")
    # Folga de fundo em volta da silhueta ANTES de ampliar: sem ela, os pontos
    # extremos dos lóbulos (esquerda, direita, topo) ficam achatados na borda
    # do bloco ampliado — exatamente o "corte" que não pode existir.
    folga = 4
    if min(x0, y0, rgb.shape[1] - x1, rgb.shape[0] - y1) < folga:
        raise SystemExit("A referência precisa de pelo menos 4 px de fundo em volta da nuvem.")
    recorte = (slice(y0 - folga, y1 + folga), slice(x0 - folga, x1 + folga))
    tamanho = (round((x1 - x0 + 2 * folga) * escala), round((y1 - y0 + 2 * folga) * escala))
    suavizar = 0.40 * escala                        # 0,4 px do print: maior sobreposição (99,5%) sem serrilhado
    m_forma = ampliar_nivel(forma[recorte], tamanho, suavizar)
    m_letreiro = ampliar_nivel(letreiro[recorte], tamanho, suavizar * 0.8)

    canvas = (LARGURA * k, ALTURA * k)
    # Centraliza a silhueta (não o bloco com folga) no canvas.
    pos = (round((canvas[0] - (x1 - x0) * escala) / 2 - folga * escala),
           round((canvas[1] - alto_nuvem) / 2 - folga * escala))
    alfa = Image.new("L", canvas, 0)
    alfa.paste(m_forma, pos)
    texto = Image.new("L", canvas, 0)
    texto.paste(m_letreiro, pos)
    cor = Image.new("RGB", canvas, tuple(int(v) for v in INDIGO))
    cor.paste((255, 255, 255), (0, 0), texto)

    final = (LARGURA * ESCALA_SAIDA, ALTURA * ESCALA_SAIDA)
    imagem = cor.resize(final, Image.LANCZOS).convert("RGBA")
    imagem.putalpha(alfa.resize(final, Image.LANCZOS))
    imagem.save(destino, optimize=True)
    return imagem


if __name__ == "__main__":
    saida = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "assets" / "portal-cloud.png"
    imagem = gerar(saida)
    print(f"{saida}: {imagem.size[0]}x{imagem.size[1]} px; área opaca {imagem.getchannel('A').getbbox()}")
