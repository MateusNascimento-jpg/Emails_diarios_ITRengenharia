# ITR Notificações — E-mail, WhatsApp e Segurança do Portal

Serviço Node.js da ITR Engenharia para envio diário de atualizações por Ordem de Serviço, WhatsApp Cloud API, notificações de segurança do Portal ITR e webhook da Meta.

Versão deste pacote: **2.3.1**.

## Estado operacional da 2.3.1

- WhatsApp diário V3: `atualizacao_ordem_servico_v3`, `pt_BR`, parâmetros nomeados `order_service` e `order_status`.
- Uma mensagem de WhatsApp por OS por telefone no V3, independentemente da quantidade de linhas da OS.
- Cabeçalho IMAGE suportado por `WHATSAPP_TEMPLATE_HEADER_MEDIA_ID` ou `WHATSAPP_TEMPLATE_HEADER_MEDIA_URL`.
- E-mail individual por destinatário, sem expor a lista de outros destinatários.
- Destinatários de e-mail são consolidados por OS; contatos globais do cliente só entram como fallback quando a OS não possui e-mail válido.
- Idempotência persistente no Airtable é obrigatória para o modo de produção recomendado.
- Falhas globais de autenticação SMTP ou Meta interrompem o respectivo canal na execução corrente.
- Shutdown gracioso aguarda o lote em andamento dentro de um orçamento configurável.
- Execução direta de produção via terminal exige `--confirmar-producao`.
- `npm run teste` executa apenas a suíte de testes; não envia mensagens.

## Instalação

Use Node.js 20 ou 22. Em produção, mantenha uma versão controlada pelo ambiente de deploy.

```bash
npm ci
npm test
npm run preflight
```

O serviço valida configuração crítica no startup e o CI executa `npm ci`, `npm test` e auditoria de dependências de produção.

## Automação diária

O cron padrão roda às 08:00 no fuso `America/Sao_Paulo`:

```text
CRON_ATIVO=true
CRON_HORARIO=0 8 * * *
APP_TIMEZONE=America/Sao_Paulo
```

A regra funcional continua sendo processar registros cuja `Data da Última Atualização Update` pertence ao dia anterior. `AUTOMACAO_INICIO_EM` impede envios retroativos anteriores ao marco operacional.

> Observação arquitetural: a 2.3.1 mantém a semântica de "ontem" para evitar alterar silenciosamente o conjunto de clientes que receberão mensagens. Recuperação persistente de dias inteiros perdidos exige uma marca d'água armazenada fora do processo e deve ser implementada como mudança operacional própria.

## WhatsApp V3

Configuração esperada:

```text
WHATSAPP_ATIVO=true
WHATSAPP_SIMULAR=false
WHATSAPP_MODO_TESTE=false
WHATSAPP_TEMPLATE_NAME=atualizacao_ordem_servico_v3
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
WHATSAPP_TEMPLATE_PARAMETER_MODE=named
WHATSAPP_TEMPLATE_BODY_PARAMETERS=order_service,order_status
WHATSAPP_TEMPLATE_HEADER_TYPE=image
WHATSAPP_TEMPLATE_HEADER_MEDIA_URL=https://notificacoes.itr.eng.br/assets/logo-whatsapp.jpeg
WHATSAPP_TEMPLATE_BUTTONS=
```

O botão estático do Portal pertence ao template aprovado na Meta e não precisa ser enviado em `WHATSAPP_TEMPLATE_BUTTONS`.

Estados da OS no V3:

- `Aguardando Preparação` → `Amostra recebida`;
- `Enviado ao Cliente` → `Relatório Pronto`;
- ambos → `Amostra recebida e Relatório Pronto`.

## E-mail diário

- Um e-mail separado por destinatário válido.
- Assunto: `ITR Engenharia — Atualização da ordem de serviço {OS}`.
- Exibe CNPJ formatado, Portal do Cliente e e-mail cadastrado para primeiro acesso conforme a regra atual do Portal.
- O primeiro e-mail válido da própria OS define o e-mail de primeiro acesso.

A credencial inicial baseada em e-mail é uma regra legada do Portal. A migração definitiva recomendada é primeiro acesso por token de uso único/expiração; isso é uma decisão de autenticação do Portal, não uma alteração isolada deste serviço.

## Segurança do Portal

Endpoint interno:

```text
POST /internal/portal/security-notification
```

Autenticação:

- HMAC-SHA256;
- timestamp curto;
- nonce de uso único durante a vida do processo;
- comparação em tempo constante.

Tipos aceitos:

- `FIRST_ACCESS` → somente `/criar-senha.html#...`;
- `PASSWORD_RESET` → somente `/redefinir-senha.html#...`;
- `PASSWORD_CREATED`;
- `PASSWORD_CHANGED`.

Payload inválido retorna `422 payload-invalido`. Falha real de infraestrutura continua retornando 503.

Em `NODE_ENV=production`, `EMAIL_MODO_TESTE` não pode permanecer ativo enquanto o endpoint interno do Portal estiver configurado.

## Telefone

A normalização fica centralizada em `lib/telefone.js`:

- `+` e `00` preservam o caráter internacional;
- DDD + número brasileiro recebe `55`;
- número nacional sem DDD é rejeitado;
- número estrangeiro sem `+`/`00` não é adivinhado;
- formato final segue E.164 plausível.

## Idempotência

Produção recomendada:

```text
IDEMPOTENCIA_ATIVA=true
IDEMPOTENCIA_FALHAR_FECHADO=true
IDEMPOTENCIA_RESERVA_TTL_MINUTOS=30
```

Os campos de idempotência ficam na tabela `Ordem de Serviço`. Estado `incerto` permanece fail-closed de propósito para evitar duplicação quando não é possível provar se uma entrega ocorreu.

## Disparo manual

`POST /disparar-agora` autentica por `X-API-Key` ou `Authorization: Bearer`. A resposta é `202 Accepted` e o andamento fica em `/status`.

`GET /disparar-agora` deve permanecer desativado em produção:

```text
PERMITIR_DISPARO_MANUAL_GET=false
```

Execução pelo terminal:

```bash
# normal, só quando houver intenção explícita de envio real
node enviar_todos.js --confirmar-producao

# histórico, também exige confirmação quando o ambiente estiver em modo real
node enviar_todos.js --ignorar-data --confirmar-producao
```

## Scripts

```text
npm start                       inicia o serviço
npm run preflight               valida a configuração sem exibir segredos
npm run verificar               node --check nos módulos
npm run test:security           testes de segurança/hardening
npm test                        suíte completa + validadores locais
npm run teste                   alias seguro de npm test
npm run validar:airtable        valida regras Airtable sem acessar o Airtable real
npm run validar:whatsapp        valida WhatsApp sem chamar a Meta
npm run validar:idempotencia    valida idempotência sem escrever no Airtable real
npm run validar:v3              valida contratos do V3
npm run enviar                  execução CLI; em produção exige --confirmar-producao
npm run enviar:historico        execução histórica; em produção exige --confirmar-producao
```

## Health, status e webhook

```text
GET/HEAD /health
GET/HEAD /status                  autenticado
GET/POST /webhook/whatsapp
GET /assets/logo-whatsapp.jpeg
```

O webhook valida `X-Hub-Signature-256` sobre o corpo bruto quando `WHATSAPP_WEBHOOK_VALIDAR_ASSINATURA=true`.

## Privacidade e repositório

- `.env` e `node_modules` não são versionados;
- segredos não devem aparecer em commits, logs ou tickets;
- fixtures de teste usam dados fictícios;
- números e e-mails são mascarados nos logs operacionais;
- a rota `/status` é autenticada.
