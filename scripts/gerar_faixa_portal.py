#!/usr/bin/env python3
"""Gera o botão PNG em 3x a partir de Open Sans Bold com supersampling 8x.
Dependência de build: Pillow. A fonte deve estar disponível localmente no diretório
scripts/referencias/fontes/OpenSans-Bold.ttf (licença OFL). Não roda em produção.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
FONT=ROOT/'scripts/referencias/fontes/OpenSans-Bold.ttf'
if not FONT.is_file():
    raise SystemExit('OpenSans-Bold.ttf necessária para reproduzir a imagem: instale a fonte OFL no caminho indicado.')
S=8
w,h=464,52
img=Image.new('RGBA',(w*S,h*S),(0,0,0,0))
d=ImageDraw.Draw(img)
# Contorno medido em coordenadas 1x, arredondamento de 3 px em cantos externos.
pts=[(3,0),(461,0),(464,3),(464,4),(458,26),(464,48),(464,49),(461,52),(3,52),(0,49),(0,48),(6,26),(0,4),(0,3)]
d.polygon([(x*S,y*S) for x,y in pts],fill='#1B364F')
# Canto arredondado com antialias na redução; pontos exteriores mantidos transparentes.
# Texto centralizado com altura visual de maiúscula ~15 px.
font=ImageFont.truetype(str(FONT),21*S)
text='Portal do Cliente'
bbox=d.textbbox((0,0),text,font=font)
center=((w*S-(bbox[2]-bbox[0]))/2-bbox[0],(h*S-(bbox[3]-bbox[1]))/2-bbox[1])
d.text(center,text,font=font,fill='#FFFFFF')
img=img.resize((1392,156),Image.Resampling.LANCZOS)
out=ROOT/'assets/portal-cta.png';img.save(out,optimize=True)
print(out)
