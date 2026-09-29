> Histórico: substituído por RELEASE_CONSOLIDADO.md nesta versão.

# Versão 2.4.0 — acesso gerado

Esta é a documentação do contrato atual. Guias de versões anteriores permanecem como histórico.

# Ambientes — Portal 3.3.0 / Notificações 2.4.0

Não há segredos reais neste pacote. Preserve os tokens, senhas, pepper e HMAC existentes. Os segredos colados na conversa devem ser substituídos no ambiente de produção; isso não foi executado neste trabalho.

## Portal

Adicionar ou ajustar no gerenciador de ambiente de produção:

```dotenv
CLIENT_AUTH_MODE=generated
AIRTABLE_CLIENT_SIGLA_FIELD=Sigla Cliente
PORTAL_NOTIFICATIONS_TIMEOUT_MS=60000
```

Manter:

```dotenv
AIRTABLE_CLIENT_EMAIL_FIELD=Email Cliente
AIRTABLE_CLIENT_WHATSAPP_FIELD=WhatsApp do Cliente
PORTAL_NOTIFICATIONS_URL=https://notificacoes.itr.eng.br
```

`PORTAL_NOTIFICATIONS_HMAC_SECRET` continua sendo o mesmo segredo que `PORTAL_INTERNAL_HMAC_SECRET` no serviço de notificações. Não gerar um novo valor isoladamente. `PORTAL_SECURITY_PEPPER` não precisa mudar para esta migração. `CLIENT_PASSWORDS_ENABLED` não reativa o login antigo: esta versão exige `generated`. Os limites `PASSWORD_REQUEST_*` continuam válidos para recuperação; parâmetros antigos de tamanho de senha e tokens não definem a senha gerada. Não mude parâmetros do Diretor.

`PORTAL_SCOPE_OVERRIDES_JSON`: revisar ANTES do deploy. Só CNPJ idêntico une automaticamente registros. Grupos com CNPJs diferentes devem ser autorizados explicitamente com os Record IDs reais, por exemplo:

```dotenv
PORTAL_SCOPE_OVERRIDES_JSON=[["recAAAAAAAAAAAAAA","recBBBBBBBBBBBBBB"]]
```

**Os IDs acima são fictícios. Não copie esse exemplo para produção.** Preserve os grupos existentes que já tenham sido revisados. Rode `npm run scope:diagnose` com seu ambiente real para comparar escopos autorizados e sugestões heurísticas; o diagnóstico é somente leitura e não imprime senhas. Um trabalho diretamente vinculado a dois clientes aparece para ambos, sem dar acesso aos outros trabalhos de cada empresa.

## E-mails diários

Adicionar:

```dotenv
AIRTABLE_CLIENTES_TABLE_ID=tblkQxQ6q7cBKXZ3C
AIRTABLE_CLIENT_SIGLA_FIELD=Sigla Cliente
```

A tabela de Clientes usa `CNPJ`, `Sigla Cliente`, `Email Cliente`, `WhatsApp do Cliente` e `ID Cliente`. O token desse serviço precisa ler essa tabela. A tabela de trabalhos, status, cron, fuso, campo de data, ledger de idempotência e integrações de Integridade permanecem como estão.

**Não substituir `AIRTABLE_CAMPO_EMAIL_CLIENTE=Email do Cliente` por `Email Cliente`**: o primeiro é o lookup da tabela de trabalhos; o segundo é o cadastro mestre consultado pelo novo módulo. Destinos finais vêm do cadastro mestre.

WhatsApp: mantenha `atualizacao_ordem_servico_v3` e `order_service,order_status` até aprovar outro template. Os números válidos separados por `;` são percorridos individualmente, sujeitos aos bloqueios configurados e à idempotência. `PORTAL_SECURITY_WHATSAPP_ENABLED=false` pode permanecer: a recuperação solicitada envia e-mails, e não mensagens de WhatsApp.

## Implantação

1. Conferir CNPJ, sigla e contatos dos clientes ativos, inclusive cadastros duplicados com o mesmo CNPJ. Duplicados precisam produzir a mesma senha; divergência bloqueia o acesso. Um cadastro inválido participante do resumo diário interrompe a execução antes dos envios, para não distribuir credenciais incorretas.
2. Conferir grupos de escopo. A mudança de autorização pode reduzir o que um CNPJ via por associação heurística anterior.
3. Configurar os deltas de ambiente nos dois serviços. A edição local de `.env` pelo PowerShell NÃO atualiza as variáveis do Coolify/servidor.
4. Publicar Notificações 2.4.0 primeiro. `GET /release` precisa retornar `version: "2.4.0"` e `generatedAccess: true`.
5. Publicar Portal 3.3.0. Sessões antigas de clientes são recusadas e será necessário entrar de novo. Sessões do Diretor permanecem.
6. Validar `/ready` no Portal; acessar com um cliente controlado, recuperar acesso, conferir todas as caixas postais e testar PDF autorizado. Fazer envio diário controlado seguindo as ferramentas existentes, sem apagar o ledger para forçar reenvio.

Não há nova migration nem campo novo no Airtable. As tabelas MySQL já existentes precisam estar presentes. As credenciais são calculadas em memória; não são gravadas em uma nova tabela de senhas.

## Limites operacionais

- A senha solicitada (sigla + parte do CNPJ) é previsível e compartilhada por empresa; é menos forte que uma senha aleatória individual. Rate limit e sessão segura não tornam essa fórmula secreta.
- A recuperação não muda a senha nem encerra sessões. Alterar a sigla no Airtable muda os próximos logins, com até 60 segundos de cache de identidade. Isso não revoga sessões já abertas; para revogação emergencial, encerrar as sessões do cliente no MySQL em procedimento administrativo controlado.
- E-mails inválidos são descartados; e-mails válidos são tentados individualmente. Aceitação SMTP não comprova chegada à caixa de entrada.
- Recuperação aguarda tentativas SMTP via serviço interno e devolve resposta genérica; não há fila durável nem retry automático por destinatário nessa operação. A latência pode diferenciar cadastros e muitos destinatários podem exceder o timeout, embora o serviço continue tentando. O rate limit reduz abuso, mas não elimina essa limitação.
- Não houve acesso à base real, envio real, alteração de segredos, commit remoto ou deploy durante esta revisão.


# WhatsApp — compatibilidade e proposta

O ambiente fornecido usa `atualizacao_ordem_servico_v3` com duas variáveis nomeadas: `order_service` e `order_status`. Alterar o código não altera o texto aprovado desse template. Por isso, o pacote mantém o contrato atual e envia a cada telefone válido do cadastro.

Caso queira CNPJ e senha dentro do WhatsApp, crie e aprove na Meta um novo template. Proposta de corpo, sujeita à aprovação e às regras da plataforma:

```text
Olá! Há uma atualização na ordem de serviço {{order_service}}.
Status: {{order_status}}.

Acompanhe suas amostras no Portal ITR.
CNPJ: {{cnpj}}
Senha: {{senha}}

Mantenha seus dados de acesso em local seguro.
```

Usar cabeçalho de imagem e botão com URL fixa `https://portal.itr.eng.br/login.html`, se aprovados. Nome proposto: `atualizacao_ordem_servico_v4`; idioma `pt_BR`.

Somente DEPOIS da aprovação, ajustar:

```dotenv
WHATSAPP_TEMPLATE_NAME=atualizacao_ordem_servico_v4
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
WHATSAPP_TEMPLATE_PARAMETER_MODE=named
WHATSAPP_TEMPLATE_BODY_PARAMETERS=order_service,order_status,cnpj,senha
```

Os valores `cnpj` e `senha` já estão disponíveis no construtor de contexto. Confira cabeçalho, botão e ordem dos parâmetros contra o template efetivamente aprovado. O validador específico de produção V3 (`teste_template_whatsapp_producao.js`) continua específico do V3: precisa ser adaptado e testado contra a definição final antes de usar o V4. A proposta NÃO foi cadastrada nem testada contra a Meta.

Não apagar registros de idempotência para redistribuir credenciais: isso pode reenviar notificações antigas. Recuperação por e-mail atende à distribuição de acesso sem mudar o template existente.
