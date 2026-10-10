# Entrega Propostas ITR — Portal 3.4.0 / Notificações 2.5.0

Preparado em 10/10/2026 a partir dos ZIPs fornecidos. Nenhum commit remoto foi presumido. Esta entrega contém código e validações locais; não houve push, deploy, envio real ou alteração de dados de produção.

## Funcionamento para o cliente

1. O cliente solicita o aceite no Portal e escolhe um contato cadastrado, exibido de forma mascarada. O Portal mostra um código aleatório de oito dígitos, com botão de cópia e validade de 30 minutos desde a solicitação.
2. O e-mail leva à página segura `confirmar-proposta.html`. O cliente informa o código, confere os dados, marca sua concordância e clica em **Confirmar aceite da proposta**. Não precisa voltar à tela original nem fazer novo login para concluir esse desafio específico.
3. Abrir o e-mail, acessar o link ou validar o código NÃO aceita a proposta. Somente a confirmação expressa permite gravar `Aceita` no Airtable. Após verificar a gravação, o Portal agenda o e-mail final. Se o cliente retornar ao Portal, os cards são atualizados ao recuperar o foco da janela.
4. Rejeição exige motivo de 5 a 1.000 caracteres; observações adicionais são opcionais, até 3.000 caracteres. Um único PATCH grava `Feedback1` e `Rejeitada`. Cancelar o modal não grava nada.

Ações comerciais são permitidas somente em `Enviada` e `Em Análise pelo Cliente`. São exigidos vínculo fiscal inequívoco, exatamente um PDF e dados comerciais válidos. Propostas com vários documentos precisam de revisão cadastral; o sistema não adivinha qual documento está sendo aceito.

## Alterações adicionais solicitadas em 10/10

O menu mostra Propostas, Relatórios, Conta, Ajuda e Site ITR nessa ordem, omitindo os dois primeiros conforme os registros efetivamente autorizados. Os itens começam ocultos para evitar exibição indevida durante o carregamento. Conta, Ajuda e Site permanecem disponíveis. Em falha de consulta há opção de tentar novamente; a falha não é tratada como autorização.

“Relatórios” representa a área operacional existente: qualquer trabalho autorizado, incluindo ensaios em andamento e histórico, habilita a área. Um simples cadastro ou uma proposta comercial não habilita Relatórios. Não é necessário que o trabalho já tenha um PDF concluído para acompanhar seu andamento.

Foi removida a expansão automática de escopo por e-mail, nome, amostras, prefixos de trabalhos e co-vínculos. CNPJs iguais e grupos administrativos expressamente configurados em `PORTAL_SCOPE_OVERRIDES_JSON` continuam autorizados. Trabalhos com vínculos que extrapolam o escopo são bloqueados. **Filiais com CNPJs diferentes que dependiam da heurística anterior podem deixar de ver trabalhos compartilhados**: conferir os vínculos autorizados em homologação, sem reativar inferência por e-mail. As rotas e os controles de papel do Diretor permanecem preservados.

O componente do documento usa as variáveis existentes de fundo, texto, link e borda nos dois temas. Não houve redesenho global.

## Arquitetura e persistência

- Portal: regras de negócio, CNPJ, CSRF, desafio, auditoria, decisões e outbox no MySQL.
- Notificações: HMAC, recibos persistentes em disco e entrega SMTP pelo transporte existente; módulo independente do cron e dos templates laboratoriais.
- Código armazenado somente como HMAC vinculado ao desafio. Link com token opaco aleatório de 256 bits; somente seu hash fica no desafio. Payloads que precisam transportar o link ficam cifrados com AES-256-GCM, usando chaves derivadas do pepper existente por HKDF e finalidade.
- Link usa fragmento removido imediatamente do histórico; o token é trocado por cookie limitado, HttpOnly, Secure em produção, SameSite=Strict e CSRF próprio. Esse cookie não cria uma sessão de cliente geral.
- Cinco tentativas erradas invalidam o desafio; há limites por IP/proposta, intervalo de reenvio de um minuto, invalidação de desafio anterior, expiração também na confirmação final e bloqueios por proposta.
- IDs determinísticos de evento, transações de outbox, locks MySQL por proposta/evento, nonce persistente e recibo SMTP em arquivo atômico protegem contra reexecuções e reinícios.
- A decisão fica `applying` antes de enviar PATCH. Em resposta perdida, o Portal reconcilia por leitura; não repete cegamente a gravação. E-mail final só é enfileirado após leitura confirmada de status e conteúdo.
- O PDF original é baixado com URL HTTPS de domínio permitido, limite de 10 MiB, tempo limitado, validação do conteúdo e SHA-256. O serviço de e-mail o obtém por endpoint interno HMAC e confere o hash antes de anexar os bytes reais. Nenhuma URL arbitrária é aceita como destino de download. O anexo não é reconstruído.
- A consulta individual do Airtable usa `returnFieldsByFieldId=true`, sem `fields[]`. A seleção de campos continua nas consultas de listagem, onde é apropriada.

## Migração MySQL

`Portal/migrations/003_proposals.sql` adiciona cinco tabelas InnoDB: `portal_proposal_state`, `portal_proposal_challenges`, `portal_proposal_outbox`, `portal_proposal_settings`, `portal_proposal_nonces`. Não remove tabelas, sessões ou dados existentes. Requer suporte MySQL a JSON e GET_LOCK. A prontidão `/ready` passa a exigir essas estruturas.

Executar exclusivamente o script específico; **não usar a migração antiga como substituto**. A migração não é executada pelo startup nem pelos scripts de cópia. Ela cria o módulo desativado. DDL MySQL não tem rollback transacional completo: em falha parcial, preservar backup e corrigir a causa antes de reaplicar o script idempotente.

Em ambiente autorizado, após backup:

```powershell
Set-Location 'C:\Projetos\APLICACAO_PORTAL_ITRengenharia'
node .\scripts\migrate-proposals.js --aplicar
if ($LASTEXITCODE -ne 0) { throw 'Migração falhou; interrompa a aplicação.' }
node .\scripts\proposals-admin.js status
```

A migração foi revisada, mas **não executada em um servidor MySQL neste ambiente**. Validar em banco de homologação restaurado de backup antes de produção, incluindo reinício, falha de conexão e concorrência com duas instâncias.

## Configuração

Nenhum `.env` foi alterado ou incluído. Não copie `.env.example` sobre configurações reais.

| Aplicação | Configuração | Comportamento |
| --- | --- | --- |
| Notificações | `PROPOSTAS_NOTIFICACOES_ATIVAS` | Nova; `false` por padrão. Ativar somente após homologação e autorização de envios. |
| Notificações | `PROPOSTAS_NOTIFICACOES_DIRETORIO` | Nova; padrão `/dados/propostas-notificacoes`. Caminho absoluto, externo ao código, em volume persistente com escrita restrita ao usuário do serviço. |
| Portal | `PUBLIC_APP_ORIGIN` | Existente; origem HTTPS oficial, usada no link de confirmação. |
| Portal | `PORTAL_NOTIFICATIONS_URL` | Existente; origem HTTPS do serviço. |
| Ambos | Segredos HMAC existentes | Reutilizados com domínio de assinatura comercial separado; precisam corresponder entre serviços. |
| Portal | `PORTAL_SECURITY_PEPPER` | Existente; também deriva chaves de proteção da persistência comercial. |
| Ambos | SMTP, Airtable, MySQL e Safe Mode | Configurações existentes preservadas. |

No Portal, ativação comercial e marco inicial ficam no MySQL, não em nova variável. `ativar` estabelece o marco apenas na primeira ativação; `pausar` e reativar preservam esse marco. O worker faz polling a cada 60 segundos e entrega de fila a cada 3 segundos; tempo total depende de Airtable/SMTP e de eventuais retentativas. A varredura é separada da entrega de confirmações.

Não há disparo retroativo: a notificação de nova proposta considera registros criados após o marco, em status elegível, com PDF pronto. Propostas anteriores continuam visíveis e podem ter decisão solicitada pelo Portal; não recebem automaticamente o aviso inicial. Ausência/invalidade do PDF adia o aviso. E-mails iniciais/finais são individuais para contatos financeiros cadastrados; verificação vai ao contato escolhido dentre esses contatos. Conferir cadastros antes de ativar.

Webhook Airtable é opcional; o polling funciona sem ele. A rota `/internal/proposals/airtable-webhook` verifica assinatura nativa e replay, e apenas desperta a varredura. Nenhuma assinatura de webhook foi criada nesta entrega. Criar/renovar a assinatura e provisionar seu MAC por stdin com `node scripts/proposals-admin.js webhook --confirmar` exige procedimento operacional separado; nunca passar segredo como argumento de linha de comando.

## Backup, validação e aplicação local em PowerShell

Os caminhos abaixo são exemplos; use os diretórios reais. Extraia cada ZIP em diretório novo, sem sobrepor o projeto existente. Use Node.js 22 LTS para ambas as aplicações.

```powershell
$Entrega = 'C:\ITR\Entrega-Propostas'
$Portal = 'C:\Projetos\APLICACAO_PORTAL_ITRengenharia'
$Emails = 'C:\Projetos\Emails_diarios_ITRengenharia'
$Backups = 'C:\ITR\Backups-Privados'

Expand-Archive -LiteralPath "$Entrega\APLICACAO_PORTAL_ITRengenharia-3.4.0_PROPOSTAS.zip" -DestinationPath "$Entrega\portal-extraido"
Expand-Archive -LiteralPath "$Entrega\Emails_diarios_ITRengenharia-2.5.0_PROPOSTAS.zip" -DestinationPath "$Entrega\emails-extraido"

# Testar cópias limpas; não iniciar server.js nem importar .env real.
& "$Entrega\PowerShell\Validar-ITR.ps1" -Pacote "$Entrega\portal-extraido\Portal"
& "$Entrega\PowerShell\Validar-ITR.ps1" -Pacote "$Entrega\emails-extraido\Emails"

# Simular compatibilidade com os arquivos-base fornecidos no handoff.
& "$Entrega\PowerShell\Aplicar-ITR.ps1" -Pacote "$Entrega\portal-extraido\Portal" -Projeto $Portal -Backups $Backups
& "$Entrega\PowerShell\Aplicar-ITR.ps1" -Pacote "$Entrega\emails-extraido\Emails" -Projeto $Emails -Backups $Backups

# Depois da revisão, com processos LOCAIS parados:
& "$Entrega\PowerShell\Aplicar-ITR.ps1" -Pacote "$Entrega\portal-extraido\Portal" -Projeto $Portal -Backups $Backups -Aplicar
& "$Entrega\PowerShell\Aplicar-ITR.ps1" -Pacote "$Entrega\emails-extraido\Emails" -Projeto $Emails -Backups $Backups -Aplicar
```

O aplicador recusa divergência de SHA-256 em arquivo que será modificado e recusa colisão com arquivo novo. Não presume que v0.3.3 esteja no GitHub nem descarta mudanças locais. Faz backup completo antes de copiar (exceto `node_modules`), altera somente a lista aprovada e preserva `.env`, `.git` e arquivos não relacionados. Uma segunda aplicação do mesmo pacote é recusada por não corresponder mais à base; não force os hashes. Se houver divergência, comparar e mesclar a versão local primeiro.

O backup contém configurações reais: guardá-lo em pasta privada, fora de repositórios e sincronizações públicas. Os scripts não modificam a política de execução do PowerShell; seguir a política corporativa existente. Não foram executados no Windows neste ambiente.

Backup de banco, somente quando autorizado, com arquivo de opções `.cnf` privado já provisionado pelo responsável:

```powershell
& "$Entrega\PowerShell\Backup-MySQL-ITR.ps1" -DefaultsFile 'C:\ITR\Segredos\mysql-backup.cnf' -Banco 'portal_itr' -Destino 'C:\ITR\Backups-Privados\portal-antes-propostas.sql'
```

Não escrever senha no comando ou no histórico. Preservar também o volume de recibos de Notificações; ele faz parte da garantia de idempotência. Depois da cópia, reinstalar dependências em cada projeto com `npm ci --ignore-scripts --no-audit --no-fund`. Nenhum script desta entrega faz push/deploy.

## Ordem de homologação e futura ativação

1. Validar os pacotes limpos e revisar diferenças locais.
2. Restaurar backup em MySQL isolado; aplicar somente a migração 003; verificar tabelas, bloqueios, transações e reinícios. Usar registros e destinatários exclusivos de homologação, sem reaproveitar dados de produção para envios.
3. Preparar e testar volume persistente de recibos. Instalar Notificações com módulo comercial inicialmente desativado; cron/laboratório devem permanecer conforme ambiente aprovado, sem teste manual de disparo real.
4. Instalar Portal com estruturas prontas. Confirmar `/ready`, login, sessão, conta, navegação e PDFs autorizados. Testar os quatro cenários e tentativas de acesso direto entre CNPJs.
5. Após autorização específica para envio, ativar o receptor comercial e depois `node scripts/proposals-admin.js ativar --confirmar` no Portal. Isso é um comando operacional, não foi executado nesta entrega.
6. Fazer teste controlado com proposta criada após o marco, PDF original e destinatários de homologação: nova proposta, desafio, confirmação, rejeição separada e falhas de transporte. Validar Gmail e Outlook reais antes de promover.

Não ativar o worker apontando a produção para “testar”. Apenas instalar o código não autoriza envios reais.

## Falhas e revisão manual

`node scripts/proposals-admin.js status` mostra fila e decisões pendentes. Um PATCH sem resultado conhecido fica pendente para leitura/reconciliação. Se o Airtable continua em estado elegível e o responsável verificou que a decisão não foi aplicada, `liberar-tentativa <recordId> --confirmar` encerra a tentativa pendente e exige novo desafio; não grava no Airtable. Nunca usar para encobrir mudança externa não examinada.

SMTP não garante exatamente uma entrega em todo cenário de perda de conexão. Após aceitação possivelmente ocorrida, o receptor marca resultado incerto e não repete automaticamente. Com o serviço de notificações parado, conferir logs/recibo do provedor e usar `node proposals/admin.js confirmar-enviado <eventId> --servidor-parado --confirmar` OU `rearmar` somente quando comprovado que não houve envio. Depois, no Portal, `node scripts/proposals-admin.js reconsultar-evento <eventId> --confirmar`. O ID original é preservado. Não apagar recibos, locks ou criar outro ID para forçar reenvio.

## Rollback

Antes de reverter código, pausar comercial no Portal e parar os processos envolvidos. **A versão anterior tem aceite imediato**: não reativá-la com escritas abertas. O responsável pelo ambiente deve manter Safe Mode/escritas bloqueadas durante rollback até revisão, sem usar o script para sobrescrever `.env`. Preservar sessões, tabelas comerciais, decisões, outbox, recibos e marco inicial.

```powershell
# Operação de banco: somente no ambiente autorizado.
node .\scripts\proposals-admin.js pausar --confirmar

# Informar o diretório exato impresso pelo aplicador, um por aplicação.
& "$Entrega\PowerShell\Rollback-ITR.ps1" -Backup 'C:\ITR\Backups-Privados\DIRETORIO-DO-BACKUP'
& "$Entrega\PowerShell\Rollback-ITR.ps1" -Backup 'C:\ITR\Backups-Privados\DIRETORIO-DO-BACKUP' -Aplicar
```

O rollback recusa mudanças posteriores e restaura somente os arquivos envolvidos. Reinstalar dependências pelo lockfile restaurado. Não restaura `.env`/`.git` e não faz DROP ou restauração automática do banco. Status já aceitos/rejeitados no Airtable não devem ser desfeitos automaticamente. Restaurar banco completo só em incidente tratado separadamente, considerando todas as outras gravações desde o backup.

## Segurança e limites restantes

- Autenticação atual gerada por sigla + primeiros seis dígitos do CNPJ permanece, conforme escopo. É previsível e o envio de senha permanente por e-mail aumenta o risco de acesso indevido. Os novos e-mails não incluem senha. A recuperação antiga não foi redesenhada. Evolução de autenticação exige etapa própria.
- Credenciais reais foram compartilhadas na conversa. Planejar sua rotação em procedimento separado; não foram usadas, reproduzidas ou alteradas nesta entrega. A rotação do pepper requer planejamento para sessões e payloads cifrados pendentes; não substituir às cegas.
- Airtable não oferece transação distribuída com MySQL nem compare-and-swap usado por este fluxo. Locks locais serializam decisões pelo Portal; edições externas concorrentes exigem reconciliação e revisão. Não prometer “exactly once” absoluto para SMTP.
- O cache operacional existente conserva suas janelas de atualização; revogações precisam ser verificadas em homologação, inclusive invalidando sessões quando necessário. A decisão comercial e o PDF de proposta reconsultam o vínculo atual.
- Migração em MySQL real, execução dos PowerShell no Windows, PDF específico de produção, permissões reais do PAT/SMTP, clientes Gmail/Outlook e configuração do proxy/HTTPS ficam para homologação autorizada. Os testes entregues são locais com dados sintéticos.
- Não foram implementados Financeiro, Clicksign ou notificações comerciais de WhatsApp. Cron diário e templates laboratoriais permanecem preservados.
