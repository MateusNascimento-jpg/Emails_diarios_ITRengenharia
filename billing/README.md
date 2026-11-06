# Financeiro — contrato de integração v1 (Etapa 1)

Implementação local do receptor. **Não há emissor, detector, baseline ou agenda no Portal nesta entrega.** Nenhuma consulta ao Airtable é realizada por este módulo. A flag `BILLING_EMAILS_ENABLED` é `false` por padrão. As rotas abaixo são um contrato novo a implementar no Portal, não interfaces já existentes.

## Configuração futura

- `BILLING_EMAILS_ENABLED=true`: somente depois da homologação integrada.
- `BILLING_RECEIPTS_DIRECTORY`: diretório absoluto externo ao código, privado, em volume persistente compartilhado por todas as instâncias deste receptor. Não compartilhar com recibos comerciais.
- `BILLING_HMAC_SECRET`: segredo exclusivo base64, pelo menos 32 bytes aleatórios; provisionar fora do Git.
- `BILLING_PORTAL_ORIGIN`: origem HTTPS fixa, sem caminho, credenciais ou query.
- SMTP existente: `EMAIL_ATIVO=true`, `EMAIL_MODO_TESTE` vazio. Não há redirecionamento financeiro de destinatários. O transporte existente é utilizado sem alterar suas funções anteriores.

Nenhum `.env` foi editado. A configuração ativa inválida impede a inicialização, em vez de reduzir as checagens.

## Evento recebido

`POST /internal/billing/v1/events`, JSON bruto, máximo 16 KiB, orçamento global de 120 pedidos/minuto/processo. Um destinatário por evento. Sem URLs, HTML, CNPJ textual ou senha no payload.

Esquema fechado em `contract.js`, exemplo executável fictício em `fixtures.js`:

| Campo | Regra |
| --- | --- |
| protocol | `itr-billing-v1` |
| eventId | SHA-256 determinístico calculado por `eventId()` |
| type | BOLETO_AVAILABLE, BOLETO_D_MINUS_1, BOLETO_DUE_TODAY, BOLETO_OVERDUE_REMINDER, BOLETO_PAYMENT_RECORDED, NFSE_AVAILABLE |
| recipient | Um e-mail normalizado em minúsculas |
| clientId / proposalId / contractId / invoiceId | IDs `rec` + 14 caracteres alfanuméricos, cadeia única e recíproca verificada pelo Portal |
| contractName / installment | Labels confiáveis, até 120 caracteres, sem controles |
| amountCents | Inteiro seguro não negativo em centavos ou null; nunca valor total de contrato |
| dueDate | Data civil válida YYYY-MM-DD (2000–2099) ou null |
| scheduledFor | Exclusivo e obrigatório em BOLETO_OVERDUE_REMINDER; data civil YYYY-MM-DD da ocorrência |
| stateVersion | SHA-256 da versão material da intenção: vínculos, identificação, valor, vencimento e o documento do próprio evento. Status e autorização ficam fora do hash e são revalidados em cada prova |
| transitionId | SHA-256 da transição nova pós-baseline para Pago; null nos outros eventos |
| document | null para pagamento; nos demais: `{id,kind,version,sha256,size}` |

Documento: ID `att` + 14 alfanuméricos; kind `boleto` ou `nfse` conforme evento; version e sha256 com 64 hex minúsculos; tamanho exato entre 5 bytes e 10 MiB. Um documento por mensagem; NFSe e boleto independentes.

Disponibilidade sem vencimento funciona. Dados inválidos de valor/data devem ser normalizados pelo Portal para null somente quando a legitimidade da cobrança estiver comprovada; lembretes exigem vencimento. Não aceitar data incoerente como confiável. Disponibilidade não exige NFSe nem status A Vencer.

Chave: SHA-256 do JSON canônico de `[1,type,clientId,contractId,invoiceId,recipient,contentSHA256OuTransitionId,dueDateOuNull,amountCentsOuNull]`. Para BOLETO_OVERDUE_REMINDER, acrescentar scheduledFor como último elemento do array; para BOLETO_UPDATED, acrescentar previous. Troca de URL/attachmentId do mesmo conteúdo não autoriza novo envio. Mesmo eventId com qualquer outro payload resulta em conflito; retry preserva o evento integral. `canonical()` ordena recursivamente as chaves, preservando arrays; sem espaços.

`BOLETO_D_PLUS_1` foi removido e é rejeitado. BOLETO_OVERDUE_REMINDER exige dueDate e scheduledFor válidos, diferença positiva exatamente divisível por cinco dias corridos e scheduledFor igual ao dia civil da entrega em America/Sao_Paulo. O receptor verifica novamente o calendário depois da prova final. Não há catch-up: ocorrência passada ou futura é obsoleta; D+1/D+6 são inválidos. A agenda e o cancelamento das ocorrências pertencem somente ao Portal.

Valor e vencimento integram o eventId: alterá-los sem recalcular a chave invalida o evento. Alterações de stateVersion ou outros dados na mesma intenção continuam sujeitas a EVENT_CONFLICT. O Portal deve cancelar a intenção obsoleta e encaminhar a alteração para conciliação/supersessão formal; não trocar IDs arbitrariamente nem usar outra ocorrência para reenviar dados incorretos.

`BOLETO_UPDATED` anuncia uma nova versão de boleto já notificado. Exige PDF de boleto, vencimento, valor e `previous` (`{sha256, dueDate, amountCents}` do que o cliente recebeu antes), que integra o eventId e precisa diferir dos dados atuais. O texto é escolhido pela comparação: SHA-256 diferente anuncia a substituição do documento; SHA-256 igual informa apenas os dados alterados. O receptor confere o SHA-256 dos bytes do PDF. É autorizado e entregue como os demais eventos de cobrança. A decisão de quando usá-lo pertence ao Portal, que cancela as intenções da versão anterior. Disponibilidade nunca substitui uma correção.

## Janela de envio

O envio ocorre das 08:00 às 18:00 em America/Sao_Paulo, todos os dias, com `withinWindow()` de `contract.js`. Fora dela, o receptor responde 503 `OUTSIDE_SEND_WINDOW` antes de consultar o Portal e, de novo, logo antes do SMTP. O Portal aguarda a próxima abertura; o calendário de cada evento continua valendo, então um lembrete de dia passado vira `OBSOLETE`.

## Contato financeiro

`BILLING_FINANCE_CONTACT_EMAIL` é opcional e existe só neste serviço. Com um endereço válido, ele vira Reply-To e aparece como "Contato financeiro" nos templates financeiros. Vazio, nada muda. Valor inválido impede a subida quando `BILLING_EMAILS_ENABLED=true`. Não integra o evento nem o contrato, e os e-mails comerciais não o usam.

## HMAC e replay

Headers: `x-itr-timestamp` (segundos Unix), `x-itr-nonce` (24 bytes aleatórios em base64url, 32 caracteres), `x-itr-signature` (hex minúsculo). HMAC-SHA256 com segredo decodificado de base64 sobre:

```text
itr-billing-v1\nMETHOD\nPATH\nTIMESTAMP\nNONCE\n<bytes exatos do corpo>
```

Janela de 300 segundos, comparação timing-safe. Nonce consumido duravelmente antes de processar JSON, inclusive em falha de validação. Retry usa novo nonce e mesmo evento. Não reutilizar assinatura comercial. Query não integra o contrato; emissor usa a rota exata sem query.

## Autorização independente e lease de envio

O receptor faz duas chamadas autenticadas `POST /internal/billing/v1/authorize` com JSON canônico `{event,phase}`, phase `prepare` e `smtp` (após download). Sem interface ou prova válida: HTTP 503, zero SMTP. A autorização comercial/senha não participa deste caminho.

Resposta JSON até 16 KiB, assinada nos mesmos headers, usando método literal `RESPONSE` e a rota acima. Campos exigidos:

```text
protocol = itr-billing-v1
requestNonce = nonce da requisição que originou esta resposta
eventDigest = SHA256(canonical(event))
phase = prepare ou smtp, igual ao pedido
authorized = eligible = chainVerified = baselineVerified = true
proposalStatus = Aceita
contractStatus = Ativo ou Concluído
paymentStatus = Aguardando Emissão da NF | A Vencer | Vencido | Pago
checkedAt = epoch ms (não futuro; no máximo 5 segundos atrás)
expiresAt = epoch ms (futuro; no máximo checkedAt + 10 segundos)
collectionStopped = false para cobrança
documentPayable = true para cobrança
payableAfterDue = true quando vencido ou vencimento anterior ao dia local
newPaymentTransition = true para confirmação de pagamento
leaseId = identificador SHA256 obrigatório na fase smtp
```

O digest vincula TODOS os campos do evento, incluindo destinatário, cadeia, parcela, valores e versão documental. O Portal não pode simplesmente ecoar o payload: deve confirmar o destinatário no cadastro financeiro atual do cliente, lido na origem a cada prova, cadeia recíproca única, proposta aceita, contrato elegível, versão e estado correntes, cutoff e baseline. Ele deve emitir `eligible` somente para a intenção específica e documento corrente, e negar ambiguidades/indisponibilidade da fonte. Para pagamentos, `Pago` é obrigatório; para NFSe, `Pago` é permitido sem transformá-la em cobrança. Cancelado/estado desconhecido bloqueiam todos.

Na fase smtp, o Portal deve reservar uma intenção de entrega serializada por parcela e destinatário, ligada a leaseId/eventDigest e ao prazo. Atualizações concorrentes observadas pelo Portal devem invalidar eventos pendentes e impedir novas leases após pagamento/cancelamento/revogação. O receptor revalida imediatamente antes de começar o SMTP, mas não pode tornar SMTP e Airtable uma transação atômica. A janela entre a prova e a aceitação SMTP precisa ser homologada: não prometer cancelamento de mensagem já entregue ao SMTP. O Portal deve manter bloqueio durável de cobrança após Pago, inclusive se o status oscilar posteriormente.

## Identificação de acesso ao Portal

Todos os templates HTML e texto incluem o botão https://portal.itr.eng.br/login.html e, com prova válida, o bloco "Dados de acesso", igual ao do e-mail de aceite da proposta. O evento continua sem CNPJ. A resposta assinada de authorize pode fornecer `access: {clientId, recipient, cnpj}`: objeto fechado, IDs/destinatário exatamente iguais ao evento e CNPJ numérico normalizado de 14 dígitos. A assinatura cobre access e eventDigest na mesma prova, vinculando identidade, cliente, documento e autorização atual. O Portal deve obter o CNPJ da fonte autoritativa da cadeia verificada, nunca ecoar um dado arbitrário. A validação sintática do receptor não substitui essa comprovação.

Contexto presente mas inválido, cliente diferente ou destinatário diferente bloqueiam o envio. Com contexto válido, o bloco exibe o CNPJ formatado; sem contexto, o bloco não aparece. O receptor utiliza exclusivamente o contexto da prova final smtp; não reutiliza o da fase prepare nem grava CNPJ nos recibos/logs. O SMTP e o template recebem o contexto em argumento separado do payload; chamadores internos devem fornecer apenas contexto da prova autenticada.

A senha vem da mesma fonte do e-mail de aceite (`proposals/access.js`, `accessForEmail`), consultada em `enviarFinanceiro` depois da prova final, em leitura no Airtable com limite de 5 segundos. Ela não entra no evento, na prova, na assinatura, nos recibos nem nos logs. **Diferença em relação à proposta:** se a senha não for confirmada, o aviso financeiro é enviado só com o CNPJ, com um código não sensível no log, porque o receptor já registrou o início do SMTP e um erro nesse ponto bloquearia o aviso. A senha é derivada do CNPJ e permanente: enviá-la em lembretes recorrentes foi decisão de negócio de 06/11/2026, e o risco segue em `docs/BILLING_SEGURANCA_SENHA.md`, no Portal.

## Download autenticado

`GET /internal/billing/v1/pdf/{eventId}/{attachmentId}`, HMAC com corpo vazio. Somente origem configurada, redirects proibidos, timeout de 15s, leitura incremental limitada a 10 MiB. Portal deve conferir autorização e vínculo novamente e baixar a origem com suas próprias proteções SSRF.

Resposta `application/pdf`, headers `x-itr-client-id`, `x-itr-invoice-id`, `x-itr-document-kind`, `x-itr-document-version` exatamente iguais ao evento. Receptor confere tamanho exato, prefixo `%PDF-`, SHA-256 e escopo. O hash esperado é vinculado pela prova de autorização assinada. Nome de anexo gerado internamente: Boleto.pdf ou NFSe.pdf; nenhum caminho/filename externo chega ao SMTP.

## Recibos e operação

Arquivos de nomes SHA-256, conteúdo sem e-mail, CNPJ, PDF, senha ou valores. Intenção, início SMTP e aceitação são registros separados imutáveis, gravados com `wx` + fsync. Diretório também recebe fsync em plataformas POSIX. Em Windows, durabilidade sob desligamento abrupto e semântica do volume precisam de homologação. Todas as réplicas precisam enxergar o MESMO volume com criação exclusiva atômica; volumes isolados/NFS sem essa garantia não são suportados.

Lock por cliente/contrato/parcela serializa eventos e destinatários; conflito retorna BUSY. Após crash, lock órfão NÃO é roubado por timeout: exige conciliação. Prova Pago cria tombstone compartilhado por destinatários antes do SMTP. Erro após início SMTP, rejeição/ack ausente ou crash preservam `sending` e retornam DELIVERY_UNCERTAIN, sem reenvio cego. Não há promessa de exatamente uma entrega nem confirmação de inbox.

| HTTP/código | Conduta do Portal |
| --- | --- |
| 200 SENT / ALREADY_SENT | Persistir recibo e encerrar tentativa |
| 401 UNAUTHORIZED / REPLAY | Corrigir assinatura/relógio; novo nonce |
| 422 INVALID_EVENT / 413 | Corrigir contrato, sem retry cego |
| 429 RATE_LIMIT | Backoff com jitter |
| 503 PORTAL_VALIDATION_FAILED / BUSY / STORAGE_UNAVAILABLE | Manter mesma intenção; backoff limitado, verificar estado |
| 409 EVENT_CONFLICT / OBSOLETE / COLLECTION_STOPPED | Não reenviar; revisão/cancelamento na outbox |
| 409 DELIVERY_UNCERTAIN | Conciliar com logs do provedor pelo Message-ID `billing-{eventId}@itr.eng.br` |
| 503 DISABLED | Flag desligada, sem efeitos de envio |

Runbook: interromper somente o emissor financeiro; localizar recibo e Message-ID; confirmar no provedor se houve aceitação; preservar evidências; somente após decisão humana comprovada reconciliar em ferramenta operacional futura. Não apagar `sending`, locks ou recibos para forçar retry. Recibos/tombstones não expiram automaticamente. Nonces também são conservados nesta etapa; monitorar espaço, definir retenção auditada antes de produção (nunca retirar nonce dentro da janela válida). Falha de storage bloqueia envio. Sem ferramenta de conciliação automática nesta etapa.

## Portal — trabalho posterior

Implementar detector read-only, baseline transacional sem retroativos, outbox por destinatário, detecção por conteúdo, agenda civil São Paulo D−1/D0 e D+5/D+10/D+15... sem catch-up atrasado, cancelamento/supersessão, autorização financeira e as duas rotas acima. Se desejado, exigir disponibilidade prévia antes de lembretes na elegibilidade do Portal. Nunca criar cron neste receptor. Homologar interoperabilidade e leases com fixture/SMTP sink antes de configurar ativação. Para rollback, desativar somente BILLING_EMAILS_ENABLED e preservar recibos.

## Verificação local

```powershell
$env:NODE_OPTIONS='--require=./tests/offline-guard.cjs'
node --test tests/*.test.js
npm.cmd test
Get-ChildItem billing -Filter '*.js' | ForEach-Object { node --check $_.FullName }
node billing/preview.js
node scripts/billing-homologacao.js --saida=<pasta-nova>
git diff --check
```

O guard é exclusivo de testes: impede dotenv e conexões externas; mocks injetados e HTTP loopback continuam disponíveis. Não iniciar server.js para testar. Previews autossuficientes com imagens locais incorporadas estão em `billing/previews/`, um HTML por evento, mais exemplo adicional D+10 (BOLETO_OVERDUE_REMINDER_D10.html); o preview principal de recorrência representa D+5. O CNPJ dos previews é exclusivamente fictício. Não representam envio nem homologação em Gmail/Outlook.

## Teste SMTP de homologação

`scripts/billing-homologacao.js` gera o pacote dos dez cenários com os dois PDFs fictícios de `billing/homologacao/` e, só por pedido explícito, envia **um** cenário a **um** destinatário controlado. Usa o template e o `createSender` oficiais, com dados fictícios, faixa de homologação no corpo, prefixo `[HOMOLOGAÇÃO]` no assunto e PDFs renomeados. Não acessa Portal, Airtable, MySQL, outbox nem recibos, e não é chamado por testes, cron ou servidor.

```powershell
node scripts/billing-homologacao.js --saida=C:\caminho\pasta-nova
# Simulação: mostra o que seria enviado, sem conectar ao SMTP.
node scripts/billing-homologacao.js --enviar --cenario=01_BOLETO_DISPONIVEL --destinatario=pessoa@dominio
# Envio real: exige também BILLING_HOMOLOGACAO_DESTINATARIO igual ao destinatário.
node scripts/billing-homologacao.js --enviar --cenario=01_BOLETO_DISPONIVEL --destinatario=pessoa@dominio --confirmar-envio-real
```
