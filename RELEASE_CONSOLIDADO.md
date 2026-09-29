# ITR — versão consolidada final

Data: 29/09/2026. Portal **3.3.1** e Notificações **2.4.1**.

Esta entrega substitui os dois pares 3.3.0/2.4.0 analisados. Não misture arquivos de versões diferentes. Projetos completos separados; nenhum segredo real, node_modules ou .env de produção foi incluído.

## Comparação dos trabalhos

| Tema | Outro chat | Nossa primeira entrega | Consolidação |
|---|---|---|---|
| Senha | Sigla em maiúsculas, sem acentos/símbolos; número de dígitos configurável | Sigla como cadastrada, sem espaços nas pontas; seis dígitos | Regra única original: sigla como cadastrada + seis primeiros dígitos. Mesma implementação nos serviços. |
| Evento interno | ACCESS_CREDENTIALS | ACCESS_REQUEST | Portal envia ACCESS_REQUEST; receptor aceita também ACCESS_CREDENTIALS como alias. |
| Campo de sigla | Dois nomes de variável diferentes | AIRTABLE_CLIENT_SIGLA_FIELD | Nome canônico único; aliases antigos aceitos se não conflitarem. |
| Sessões anteriores | Revogação manual, papel Cliente reutilizado | Papel GeneratedClient e rejeição automática das sessões Cliente | Preservada rejeição automática, sem comando SQL obrigatório. DEV continua separado. |
| Contatos diários | Mantém contatos dos lookups de trabalhos | Consulta cadastro mestre de Clientes | Preservado cadastro mestre e todos os contatos válidos do mesmo CNPJ. |
| Sigla ausente | E-mail pode mostrar “Consulte a ITR” em vez da senha | Interrompe preparação de todos os clientes | Apenas cliente inválido fica bloqueado; demais continuam. Falha parcial explícita no resumo, sem reserva de idempotência do bloqueado. |
| Falha SMTP na recuperação | Exceção pode interromper antes dos próximos destinatários | Cada destinatário tentado apesar de falha anterior | Preservadas tentativas individuais, erro global se houver falhas, sem afirmar entrega à caixa postal. |
| Logo | CID com contentDisposition inline | CID em fundo escuro | Combinados inline explícito e fundo escuro. |
| Demais achados | Vários itens mantidos pendentes | Correções de DEV, logout, PDF, cache, histórico e guards | Preservadas as correções anteriores. |
| Textos | Ainda havia referências ao fluxo pessoal | Ainda havia cartão/tour legado oculto | Recuperação orienta entrada/spam; Conta explica acesso empresarial; tour independente de senha pessoal. |

Executei também a suíte completa dos E-mails do outro chat em Node 22 com as dependências instaladas: os 45 testes unitários passaram, mas `npm test` terminou com falha no validador V3, que ainda esperava o antigo e-mail de primeiro acesso no HTML. O validador da versão consolidada foi atualizado e passou. Não tratei a contagem de testes ou o relatório de outra entrega como comprovação de integração por si só.

## Regra final de acesso

- CNPJ com 14 dígitos numéricos.
- `Sigla Cliente` preserva caixa, acentos e símbolos; apenas espaços nas extremidades são removidos. Cadastros sem sigla, com controles de linha ou tamanho inválido são recusados.
- Senha = sigla + os **seis primeiros dígitos** do CNPJ. `GCO` + `17.205.251/0001-00` → `GCO172052`.
- Não foi adotado o exemplo com sete dígitos. `PORTAL_ACCESS_CNPJ_DIGITS=7` agora causa erro claro de configuração; não é silenciosamente ignorado. Deixar ausente ou usar `6`.
- CNPJs duplicados precisam ter siglas que produzam exatamente a mesma senha. Senão, falha fechada.
- Login não aceita e-mail como senha. Não cria senha pessoal e não envia ativação.
- Recuperação não muda a senha nem encerra a sessão de outros usuários.

A fórmula solicitada é previsível e compartilhada por empresa. Rate limit e sessão protegida não conferem a entropia de uma senha aleatória individual.

## Textos e experiência

Após a solicitação de recuperação, o usuário lê:

> Solicitação recebida. Se o CNPJ estiver cadastrado com e-mails válidos, enviaremos os dados de acesso para esses contatos. Confira sua caixa de entrada e a pasta de spam ou lixo eletrônico. O envio pode levar alguns minutos. Se não receber, confira o CNPJ informado ou entre em contato com a ITR. Sua senha atual continua a mesma.

A frase é condicional para não revelar cadastros nem prometer entrega que não podemos confirmar. Foram alinhados título, etapas, botão, estado de carregamento e fallback do frontend.

Na Conta, “Sua senha pessoal” e o formulário de alteração saíram. O cartão usa as classes originais e orienta “Receber dados de acesso”, mantendo o tour disponível. “E-mail de acesso” virou “E-mail principal de contato”: não sugere que e-mail serve para login.

O tour não depende mais de uma conta com senha pessoal. Guarda somente a versão vista neste navegador, sem CNPJ, e-mail ou senha. Na visualização DEV, não é oferecido automaticamente. Pode ser refeito manualmente. O guia explica avisos diários, sem prometer mensagem instantânea após aprovação. O texto do e-mail de recuperação mantém os parágrafos solicitados pelo usuário.

CSS originais foram preservados byte a byte. As imagens históricas ilustrativas do guia não foram redesenhadas; o texto e os formulários atuais são a referência para o novo acesso.

## Alinhamento das aplicações

- O Portal envia payload com CNPJ, senha e contatos obtidos no servidor, assinado por HMAC com timestamp e nonce.
- Notificações valida o contrato e envia mensagens individuais aos e-mails válidos. Não expõe os demais destinatários em To/CC.
- `ACCESS_CREDENTIALS` é aceito como alias de transição; não significa que todas as regras da outra versão sejam compatíveis. Implante os dois projetos consolidados.
- Sigla e CNPJ dos e-mails diários vêm do cadastro mestre. Não são combinados com um CNPJ desatualizado do lookup para inventar outra senha.
- Números separados por ponto e vírgula são normalizados e deduplicados. Bloqueios explicitamente configurados e idempotência continuam respeitados.
- Um cadastro inválido não gera e-mail com senha vazia ou fictícia e não trava todos os demais. Sua correção não apaga o ledger; a execução seguinte ainda obedece aos filtros de data e status. Uma notificação perdida fora da janela diária exige reprocessamento operacional controlado.
- WhatsApp V3 permanece com OS/status. CNPJ/senha dentro do WhatsApp ainda dependem de template aprovado pela Meta; não foram adicionados parâmetros incompatíveis.
- Node 22 é agora indicado no `.node-version` de ambos os projetos e usado na validação desta entrega.

## Auditoria: estado final

| Achado | Tratamento |
|---|---|
| A01 | Só mesmo CNPJ ou override explícito une escopos. E-mail, nome, amostra e trabalho compartilhados não fundem empresas. |
| A02 | Autenticação pelo CNPJ exato e sua sigla; não procura senha pessoal de outro membro do grupo. |
| A03 | DEV com papel próprio, limite persistente por IP/conta, sem download/onboarding em nome do cliente. Desabilitar DEV invalida seu uso; mudar só a senha DEV não revoga sessões existentes. |
| A04 | Histórico elimina GET por trabalho usando índice do snapshot. Ainda há limite global 500/1000; paginação por cliente permanece futura. |
| A05 | Listagem/download usam a mesma função de aprovação e arquivo publicado. Download reconsulta vínculo e URL. |
| A06 | Identidade tem consulta separada só a Clientes e cache de 60s. Listagem ainda depende de snapshot integral. |
| A07 | Filtro recente mantém createdTime; comentário corrigido. Não inventada data de envio. |
| A08–A10 | Logout expirado tratado; abertura de PDF corrigida; rótulo Geodeep/exemplos JS removidos. |
| A11 | Dicionários com single-flight e recuo de 30s em falha. |
| A12 | E-mail deixa de ser credencial/evidência de autorização; cadastro do CNPJ fornece contatos. |
| A13 | Login de cliente não limpa limite global de IP. Regra administrativa anterior preservada. |
| A14 | Acrescentados testes HTTP, comportamento do formulário, migração de sessões, contatos e integração assinada entre projetos. |
| A15 | UI ativa de senha pessoal retirada; rotas antigas bloqueadas. Módulos e arquivos históricos ainda existem, não constituem modo legado habilitável. |
| A16 | Readiness e preflight exigem tabelas ativas. Duplicidade histórica de definições de schema não foi redesenhada. |
| A17 | Guia de consolidação/ambientes é a referência atual; guias anteriores marcados históricos. |
| A18–A20 | Guard e no-store em /perfil; exemplo de cookie corrigido; abort/timers do proxy PDF tratados. |
| A21 | Recuperação usa todos os contatos válidos do mesmo CNPJ, sem alterar senha. |
| A22 | Estado em memória permanece; manter uma instância agendadora, sem declaração de suporte a cron horizontal. |

## Validação executada

Runtime: **Node 22.23.3**.

- Portal: `npm run check` — **57/57 testes passaram**, além do verificador de sintaxe/DOM/contratos.
- Notificações: `npm test` — **51/51 testes passaram**, além dos validadores locais de Airtable, WhatsApp, idempotência e V3.
- `Validar-Integracao.js`: executa o emissor real do Portal contra um receptor HTTP local, valida HMAC/timestamp/nonce com o módulo real de Notificações e percorre o processamento real da recuperação com SMTP simulado. Verifica dois destinatários, credencial idêntica, alias da outra entrega e logo CID.
- Teste comportamental do formulário: CNPJ-only, orientação de caixa/spam, resposta condicional e recuperação de botão após rate limit.
- Teste do orquestrador: cliente inválido é pulado e outro cliente é processado, com resumo de falha parcial.
- CSS comparado com o original; hashes dos ZIPs/manifesto; varredura dos valores secretos fornecidos contra os arquivos distribuídos.

Não houve envio real, acesso ao Airtable de produção, alteração de MySQL, rotação de segredos, push ou deploy. PowerShell revisado; não foi executado em Windows. A validação real de SMTP/Meta e dos vínculos empresariais permanece necessária na homologação.

## Limites conhecidos

Recuperação ainda não usa fila durável/outbox. O Portal aguarda a tentativa do serviço, devolve texto genérico e registra erro em falha; não há retry automático por destinatário nessa operação. Muitas caixas ou falhas de rede podem exceder timeout; latência pode diferenciar cenários de cadastro. Não afirmar que a senha “já está na caixa”.

Sessões novas GeneratedClient são preservadas ao recuperar acesso. Trocar sigla afeta próximos logins após cache de até 60s, mas não encerra sessões abertas. Reversão a código antigo pode voltar a aceitar sessões Cliente ainda existentes. Não foi executada exclusão destrutiva de sessões.

Grupos legítimos de CNPJs diferentes precisam de override com Record IDs reais. Não foi consultada a base para inventar esses vínculos. Aceitação SMTP não garante entrega e contatos inválidos/bloqueados não recebem mensagens.

## Arquivos por repositório

A lista completa de inclusões/alterações frente à base original e as diferenças frente às duas entregas 3.3.0/2.4.0 estão em `ARQUIVOS_ALTERADOS.md`. O pacote completo inclui os dois ZIPs separados, PowerShell, ambiente, comparação e teste de integração.


# Ambientes — Portal 3.3.1 / Notificações 2.4.1

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

1. Conferir CNPJ, sigla e contatos dos clientes ativos, inclusive cadastros duplicados com o mesmo CNPJ. Duplicados precisam produzir a mesma senha; divergência bloqueia o acesso. Um cadastro inválido participante do resumo diário bloqueia somente aquele cliente, com falha parcial no resumo. Os demais continuam; corrigir o cadastro antes da janela diária para não perder suas notificações.
2. Conferir grupos de escopo. A mudança de autorização pode reduzir o que um CNPJ via por associação heurística anterior.
3. Configurar os deltas de ambiente nos dois serviços. A edição local de `.env` pelo PowerShell NÃO atualiza as variáveis do Coolify/servidor.
4. Publicar Notificações 2.4.1 primeiro. `GET /release` precisa retornar `version: "2.4.1"` e `generatedAccess: true`.
5. Publicar Portal 3.3.1. Sessões antigas de clientes são recusadas e será necessário entrar de novo. Sessões do Diretor permanecem.
6. Validar `/ready` no Portal; acessar com um cliente controlado, recuperar acesso, conferir todas as caixas postais e testar PDF autorizado. Fazer envio diário controlado seguindo as ferramentas existentes, sem apagar o ledger para forçar reenvio.

Não há nova migration nem campo novo no Airtable. As tabelas MySQL já existentes precisam estar presentes. As credenciais são calculadas em memória; não são gravadas em uma nova tabela de senhas.

## Limites operacionais

- A senha solicitada (sigla + parte do CNPJ) é previsível e compartilhada por empresa; é menos forte que uma senha aleatória individual. Rate limit e sessão segura não tornam essa fórmula secreta.
- A recuperação não muda a senha nem encerra sessões. Alterar a sigla no Airtable muda os próximos logins, com até 60 segundos de cache de identidade. Isso não revoga sessões já abertas; para revogação emergencial, encerrar as sessões do cliente no MySQL em procedimento administrativo controlado.
- E-mails inválidos são descartados; e-mails válidos são tentados individualmente. Aceitação SMTP não comprova chegada à caixa de entrada.
- Recuperação aguarda tentativas SMTP via serviço interno e devolve resposta genérica; não há fila durável nem retry automático por destinatário nessa operação. A latência pode diferenciar cadastros e muitos destinatários podem exceder o timeout, embora o serviço continue tentando. O rate limit reduz abuso, mas não elimina essa limitação.
- Não houve acesso à base real, envio real, alteração de segredos, commit remoto ou deploy durante esta revisão.

## Compatibilidade com o pacote do outro chat

O nome canônico é `AIRTABLE_CLIENT_SIGLA_FIELD=Sigla Cliente` nos dois serviços. `AIRTABLE_CLIENT_ACRONYM_FIELD` e `AIRTABLE_CAMPO_SIGLA_CLIENTE` são aliases aceitos; se coexistirem, devem ter o mesmo valor. Recomenda-se deixar só o nome canônico. `PORTAL_ACCESS_CNPJ_DIGITS` deve ficar ausente ou `6`; esta entrega recusa qualquer outro valor. Não executar o antigo `revoke:client-sessions`: a nova sessão tem papel próprio e as antigas são recusadas automaticamente. `CLIENT_PASSWORDS_ENABLED=true/false` não muda o acesso gerado.

Ambos os repositórios indicam Node 22 no arquivo `.node-version`; a consolidação foi testada em Node 22.23.3.
