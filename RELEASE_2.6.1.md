# Emails_diarios_ITRengenharia — 2.6.1 (24/10/2026)

Base: entrega de desenvolvimento de 23/10/2026 (2.5.1). **Não publicado.** Sem
envio real, sem SMTP real e sem teste em clientes Gmail/Outlook reais.
A 2.6.0 foi uma entrega intermediária (não publicada) cuja nuvem redesenhada
foi recusada; a 2.6.1 usa a cópia fiel da nuvem aprovada.

## CTA "Portal do Cliente" — nuvem (ADR-008)
- `assets/portal-cloud.png` é **cópia fiel da nuvem aprovada pelo usuário**: silhueta,
  ponta e letreiro vêm dos pixels de `scripts/referencias/portal-cloud-referencia.png`
  (recorte só da nuvem). Nada redesenhado, nenhuma fonte trocada. Coincidência da
  silhueta com a referência: 99,5% (teste exige ≥ 98,5%).
- Vetorização por nível em `scripts/gerar_nuvem_portal.py` (Pillow + numpy;
  determinístico): cobertura de cor índigo↔branco, ampliação 8x com folga, corte
  no nível 0,5 e redução LANCZOS. Fundo transparente em volta, sem retângulo.
- PNG 672 × 390 px (3x). Exibição 224 × 130 px: nuvem com ~200 px de largura, o
  que deixa o letreiro ~16% maior que o texto do corpo, a mesma relação medida
  nos prints aprovados (a 2.6.0 exibia a nuvem 1,7x maior).
- `proposals/template.js`: `<img width="224" height="130">` (um terço exato do PNG,
  sem distorção no Outlook), `width:100%;max-width:224px;height:auto`, link
  envolvendo só a imagem, nenhum `overflow:hidden` em ancestral (o cartão usa
  `border-radius` no cabeçalho). Texto alternativo estilizado e link em texto no plaintext.

## Ajustes de conteúdo
- Valor ausente não aparece mais como "R$ 0,00" ("Conforme proposta").
- INVOICE: texto da especificação 07 ("Informamos que a nota fiscal referente ao
  Contrato X já está disponível…"), vencimento em dd/mm/aaaa e rodapé referente ao
  contrato. NEW/VERIFY/ACCEPTED: texto aprovado preservado.

## Testes e prévia
- `npm run verificar && npm run test:security`: 81/81; `npm test`: código 0.
- `tests/portal-cloud-no-crop-final.test.js` decodifica os PNGs (sem dependência nova,
  `tests/helpers/png.js`) e confere dimensões, bordas transparentes, ponta, cor,
  texto e a **fidelidade da silhueta à referência aprovada** (reprova o desenho recusado).
- `scripts/previsualizar_comerciais.js`: monta o MIME **real** por `enviarComercial()`
  com transporte em memória, confere o CID `portalCloud` = PNG versionado e, com
  Playwright, mede a nuvem em 640 px e 360 px (proporção, link, sem corte).
- Ferramentas de geração e prévia não rodam em produção e não exigem variável nova.
- O teste que já falhava na base 23/10 (exigia o nome da empresa no e-mail) passou a
  validar o escape no nome do contato, conforme a decisão de não tratar empresa como pessoa.
