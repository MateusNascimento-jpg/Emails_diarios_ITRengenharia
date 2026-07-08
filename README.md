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
