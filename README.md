# ITR Emails Diários

Aplicação Node.js para enviar e-mails diários aos clientes da ITR Engenharia com as amostras/ensaios atualizados no dia anterior.

## Regra principal

- O envio automático roda às 8h no fuso `America/Sao_Paulo`.
- O código filtra registros cujo campo `Data da Última Atualização Update` caiu no dia anterior.
- Somente entram no e-mail os status `Aguardando Preparação` e `Enviado ao Cliente`.
- Cada Ordem de Serviço gera um e-mail separado para o respectivo cliente.

## Atenção sobre Airtable

Se preencher `AIRTABLE_VIEW_ID`, a view escolhida não deve filtrar apenas "hoje". Ela precisa permitir que o código encontre os registros de ontem. O filtro de data correto já está no código.

## Uso local

1. Rode `npm install`.
2. Copie `.env.example` para `.env`.
3. Preencha as variáveis reais no `.env`.
4. Teste sem filtro de data com `npm run teste`.
5. Teste o envio normal com `npm run enviar`.
6. Suba o servidor com `npm start`.

## Produção

- Subir para GitHub sem `.env` e sem `node_modules`.
- Configurar as variáveis de ambiente no Render.
- Start command: `npm start`.
- Usar UptimeRobot para pingar a URL do Render e evitar hibernação.

## Teste manual em produção

Com `EMAIL_MODO_TESTE` preenchido, acesse:

`/disparar-agora?chave=SUA_CHAVE`

Para testar sem filtro de data, ainda com tudo redirecionado para o e-mail de teste:

`/disparar-agora?chave=SUA_CHAVE&ignorarData=1`

Nunca versionar `.env`.

## Portal ITR 3.1 — notificações de segurança

A versão 2.1 deste serviço também recebe eventos transacionais fechados do Portal em:

`POST /internal/portal/security-notification`

O endpoint não aceita HTML, destinatário arbitrário ou texto livre. Ele aceita somente `FIRST_ACCESS`, `PASSWORD_RESET`, `PASSWORD_CREATED` e `PASSWORD_CHANGED`, valida o e-mail e, quando existe link de ação, exige HTTPS + o mesmo domínio configurado em `PORTAL_ORIGIN`.

A autenticação entre serviços usa HMAC-SHA256 + timestamp + nonce. Configure o mesmo segredo Base64 de 32+ bytes nos dois serviços:

- aqui: `PORTAL_INTERNAL_HMAC_SECRET`
- Portal: `PORTAL_NOTIFICATIONS_HMAC_SECRET`

O e-mail contém o link de primeiro acesso/reset. O aviso por WhatsApp é opcional e **não recebe token nem link de redefinição**.

### Comunicação diária

O e-mail diário passou a apresentar:

- `CNPJ de acesso`
- `Senha inicial (somente no primeiro acesso)` = e-mail cadastrado
- explicação de que depois da ativação o acesso é CNPJ + senha pessoal.

O contexto do template WhatsApp também oferece `cnpj`, `senha_inicial` e `email_acesso`. Use esses campos apenas no template aprovado para explicar o primeiro acesso.
