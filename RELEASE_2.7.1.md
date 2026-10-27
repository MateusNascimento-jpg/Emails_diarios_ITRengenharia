# RELEASE 2.7.1 — Faixa Portal do Cliente + complementos

Base: Emails 2.7.0, Portal 3.6.0. Sem publicação, sem banco, sem SMTP.

- Substitui CTA de nuvem por faixa azul-marinho #1B364F (464 × 52 px, PNG 1392 × 156 RGBA) com texto Open Sans Bold e link único para `/login.html`, nos eventos NEW/VERIFY/ACCEPTED/INVOICE.
- `enviarComercial` usa anexo inline `portal-cta.png`, CID `portalCta`; os e-mails diários, de segurança e de primeiro acesso permanecem intactos.
- Inclui alteração complementar da credencial comercial: senha **somente quando validada** para CNPJ e destinatário, sem senha no VERIFY e sem obter senhas pessoais irreversivelmente armazenadas.
- Portal: cabeçalho «ACEITE DE PROPOSTA REGISTRADO», rodapé «Integridade do aceite (pdf da proposta)» com dois botões lado a lado para os PDFs autenticados. Comprovantes já emitidos não são alterados.
- `OpenSans-Bold.ttf` **não acompanha a entrega**; o PNG já está pronto. Para reproduzir a imagem, instalar localmente Open Sans Bold com licença OFL em `scripts/referencias/fontes/OpenSans-Bold.ttf`, executar `python scripts/gerar_faixa_portal.py`. Não instalar fontes em produção.

Validação realizada: 11 testes focados de e-mail; 3 testes do comprovante; oito prévias Chrome nas larguras 640/375 px sem overflow. `npm test` completo não foi validado: instalação offline de dependências ficou incompleta (`nodemailer`, `dotenv` etc. indisponíveis). MIME via transporte simulado permanece **pendente** de ambiente Node com dependências instaladas.

Aplicação: comparar e copiar somente as pastas `emails/` e `portal/` da raiz deste patch sobre checkouts limpos daquelas versões, respeitando os arquivos listados em `ARQUIVOS_ALTERADOS.txt`. Arquivos listados em `ARQUIVOS_REMOVER.txt` devem ser removidos **após** executar os testes no ambiente de homologação. Não copiar `previews/` para os projetos.

Verificação após instalar dependências em ambiente autorizado, sem envio real: `npm ci --ignore-scripts`, `npm test`, `node scripts/previsualizar_comerciais.js ./previa-local`. Não executar `enviar`, `migrate`, `deploy` ou `redeploy` para validar.

Rollback: recolocar os arquivos originais da versão 2.7.0 e do Portal 3.6.0; remover os arquivos novos listados em `ARQUIVOS_NOVOS.txt`; restaurar os removidos a partir do Git. Os PDFs históricos permanecem preservados em MySQL (sem alteração).
