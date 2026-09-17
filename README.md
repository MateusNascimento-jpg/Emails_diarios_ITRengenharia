# ITR Notificações — E-mail, WhatsApp e Segurança do Portal

Serviço Node.js da ITR Engenharia para:

- enviar o resumo diário por Ordem de Serviço;
- disparar WhatsApp a partir de template aprovado;
- receber notificações transacionais fechadas do Portal ITR;
- aplicar HMAC, timestamp e nonce no canal Portal → Notificações;
- auditar números de WhatsApp compartilhados sem bloquear por padrão;
- oferecer idempotência persistente opcional no Airtable.

Versão deste pacote: **2.2.1**.

## Antes de iniciar

1. Use Node.js 20 ou superior.
2. Rode `npm ci`.
3. Copie `.env.example` para `.env` somente no ambiente local.
4. Preserve os valores reais já existentes do ambiente.
5. Rode:

```bash
npm run preflight
npm test
```

O serviço também valida configuração crítica no startup.

A 2.2.1 mantém as regras da 2.2.0 e adiciona entrega resiliente para listas grandes de WhatsApp e contatos heterogêneos.

### Regras 2.2.1 — contatos, destinatários e mensagens grandes

- cada telefone válido é processado independentemente;
- um telefone inválido/bloqueado não derruba os demais números válidos do cliente;
- números compartilhados entre clientes geram aviso de auditoria e são permitidos; o mesmo número pode receber notificações de clientes diferentes quando estiver cadastrado nos dois;
- são aceitos formatos comuns com `+55`, `0055`, `0 + DDD`, parênteses, espaços e hífens;
- `;`, `,`, `|`, `/` e quebra de linha podem separar múltiplos telefones;
- OS grandes que excedem o limite de um único template são divididas automaticamente em partes, sem descartar os itens;
- cada telefone recebe todas as partes da OS; uma falha em um destino não impede as tentativas dos demais;
- `WHATSAPP_NUMEROS_BLOQUEADOS` funciona como lista de auditoria por padrão; para torná-la bloqueio efetivo, configure `WHATSAPP_BLOQUEIO_RIGIDO_NUMEROS=true`;
- `WHATSAPP_PAUSA_ENTRE_MENSAGENS_MS` controla a pausa curta entre partes/destinatários, sem alterar o cron;
- cada e-mail cadastrado recebe uma mensagem individual, sem expor os outros destinatários;
- o primeiro e-mail consolidado do Airtable é o contato principal e é o único que recebe a senha inicial legada;
- destinatários secundários recebem a mesma atualização do cliente, mas sem a senha inicial do contato principal;
- falhas finais da Meta recebidas pelo webhook ficam detalhadas nos logs e nas falhas recentes do `/status`.

A 2.2.1 também mantém os bloqueios de configuração crítica:

- valores residuais como `<PREENCHER>`, `CHANGEME`, `TODO` e `TBD`;
- nomes de campos do Airtable com sinais de encoding corrompido;
- `CHAVE_DISPARO_MANUAL` fraca quando configurada.

### Regra importante: `EMAIL_MODO_TESTE`

- vazio: envia para os destinatários reais;
- um e-mail válido: redireciona todos os envios para esse endereço;
- `false`, `true`, `0`, `1` ou qualquer texto que não seja e-mail: **configuração inválida e o serviço não inicia**.

## Automação diária

O cron padrão roda às 8h em `America/Sao_Paulo` e usa os registros permitidos pela configuração do Airtable.

`AUTOMACAO_INICIO_EM` é obrigatório quando `CRON_ATIVO=true` e deve conter data/hora ISO-8601 com fuso explícito, por exemplo:

```text
2026-08-01T00:00:00-03:00
```

`ignorarData=true` não ignora automaticamente esse marco de segurança.

## Portal ITR — notificações de segurança

Endpoint interno:

```text
POST /internal/portal/security-notification
```

Tipos aceitos:

- `FIRST_ACCESS`
- `PASSWORD_RESET`
- `PASSWORD_CREATED`
- `PASSWORD_CHANGED`

O endpoint não aceita HTML arbitrário. Links de primeiro acesso/reset precisam ser HTTPS, permanecer na origem configurada em `PORTAL_ORIGIN` e usar as páginas permitidas do Portal.

A autenticação entre serviços usa:

- HMAC-SHA256;
- timestamp curto;
- nonce de uso único no processo;
- comparação em tempo constante.

O mesmo segredo Base64 de 32+ bytes deve existir em:

```text
Notificações: PORTAL_INTERNAL_HMAC_SECRET
Portal:       PORTAL_NOTIFICATIONS_HMAC_SECRET
```

## WhatsApp de segurança

O alerta por WhatsApp é opcional. Ele **não recebe token nem link de redefinição**.

Quando:

```text
WHATSAPP_MODO_TESTE=true
```

as notificações de segurança usam `WHATSAPP_TEST_NUMBER`, assim como o fluxo diário. Elas não usam o telefone real do cliente durante o modo teste.

## Health e status

Health público e mínimo:

```text
GET /health
```

Resposta esperada:

```text
OK
```

`/status` contém telemetria operacional e exige autenticação:

```bash
curl -H "X-API-Key: SUA_CHAVE" https://SEU-SERVICO/status
```

Também é aceito:

```text
Authorization: Bearer SUA_CHAVE
```

A chave não é aceita por query string.

## Disparo manual

Use POST e envie a chave em header:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: SUA_CHAVE" \
  -d '{"ignorarData":false}' \
  https://SEU-SERVICO/disparar-agora
```

Para teste controlado sem filtro diário:

```json
{"ignorarData":true}
```

`PERMITIR_DISPARO_MANUAL_GET` deve permanecer `false` em produção.

## Idempotência

A proteção persistente existe, mas é deliberadamente explícita:

```text
IDEMPOTENCIA_ATIVA=false
```

Só ative depois de confirmar que os campos de idempotência existem na tabela de OS. Com a funcionalidade ativada, mantenha `IDEMPOTENCIA_FALHAR_FECHADO=true`.

## Logs e privacidade

O fluxo de e-mail mascara destinatários nos logs. Não registre tokens, senhas, HMACs, payloads sensíveis ou `.env` em tickets, commits ou conversas.

## Scripts principais

```text
npm start                 inicia o serviço
npm run preflight         valida configuração sem exibir segredos
npm run verificar         node --check nos módulos
npm run test:security     testes de segurança/hardening
npm test                  sintaxe + segurança + validadores locais
npm run audit:local       sintaxe + segurança + preflight
npm run enviar            execução normal
npm run teste             execução com ignorarData
```

## Produção

- `.env` e `node_modules` não devem ser versionados;
- use `npm ci` no build/deploy;
- use `/health` para monitoramento externo;
- mantenha `/status` autenticado;
- mantenha `PERMITIR_DISPARO_MANUAL_GET=false`;
- não ative WhatsApp de segurança sem template aprovado e teste controlado.
