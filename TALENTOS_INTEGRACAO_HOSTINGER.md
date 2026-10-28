# Banco de Talentos ITR — Integração Node.js 2.8.0 + WordPress 1.1.0

**Status:** código preparado para homologação. Não houve deploy, SMTP real, leitura de currículos de produção nem mudança dos `.env` ativos.

## Arquitetura

1. O WordPress recebe dados e PDF (máximo 5 MiB), valida e guarda no MySQL e em pasta privada fora da área pública.
2. Uma tarefa agendada do WordPress envia apenas os metadados do candidato e o SHA-256 do PDF para `POST /internal/talentos/events`, pelo HTTPS, assinados com HMAC-SHA256 exclusivo.
3. O serviço Node valida assinatura, timestamp e nonce, e consulta o PDF por rota **GET autenticada**, construída a partir da variável privada `TALENTOS_WORDPRESS_REST_BASE`. URLs fornecidas pelo usuário não são aceitas.
4. O Node verifica MIME, tamanho, assinatura `%PDF-` e SHA-256 do arquivo baixado, então envia para **comercial@itr.eng.br**, usando o SMTP Hostinger existente e o PDF anexado. `Reply-To` usa o endereço do candidato.
5. O Node grava somente um recibo técnico no diretório persistente: hash do evento, estado e ID da mensagem. Não grava nome, e-mail nem currículo nesse recibo. O WordPress preserva o cadastro original.

O fluxo não modifica `enviar_todos.js`, cron diário, Airtable, WhatsApp, Portal, Propostas ou Integridade. O módulo entra **desligado** por padrão.

## Novas variáveis no Node.js (Hostinger)

```dotenv
TALENTOS_NOTIFICACOES_ATIVAS=false
TALENTOS_NOTIFICACOES_EMAIL=comercial@itr.eng.br
TALENTOS_NOTIFICACOES_HMAC_SECRET=
TALENTOS_NOTIFICACOES_DIRETORIO=
TALENTOS_WORDPRESS_REST_BASE=
```

- `TALENTOS_NOTIFICACOES_HMAC_SECRET`: crie segredo novo, exclusivo, aleatório, Base64 de 32 bytes ou mais; o mesmo valor estará no `wp-config.php` do WordPress, nunca no frontend. Não reutilize segredos publicados anteriormente.
- `TALENTOS_NOTIFICACOES_DIRETORIO`: caminho absoluto de volume **privado e persistente**, com escrita pelo processo Node. Não aponte para `public_html`, `hbuilds`, `nodejs` atual ou diretório do repositório. Se a Hostinger não permitir armazenamento persistente fora do build, **não ative esta implementação** antes de definir uma alternativa durável de recibos.
- `TALENTOS_WORDPRESS_REST_BASE`: base HTTPS exata, por exemplo `https://SEU_SITE_REAL/wp-json`. Permalinks REST amigáveis devem estar funcionando, sem redirecionamento; confirme primeiro `GET /wp-json/` no WordPress. O Node só aceita valor configurado, sem redirecionamentos de download.
- `TALENTOS_NOTIFICACOES_EMAIL`: fixo em `comercial@itr.eng.br`; o cliente não escolhe destinatário.
- `TALENTOS_NOTIFICACOES_ATIVAS`: somente passe a `true` em homologação depois de conferir pasta, HMAC, WordPress e políticas de privacidade.

As variáveis SMTP existentes continuam no Node, com credenciais **rotacionadas**, e `EMAIL_MODO_TESTE` deve estar vazio para ativar o módulo. A integração exige `EMAIL_ATIVO=true` mas não usa os envios diários.

## Configuração no WordPress

No `wp-config.php` (fora do repositório, nunca em HTML):

```php
define('ITR_TALENTOS_EMAIL_BACKEND', 'off');
define('ITR_TALENTOS_NOTIFICATIONS_URL', 'https://notificacoes.itr.eng.br/internal/talentos/events');
define('ITR_TALENTOS_HMAC_SECRET', 'COLE_AQUI_A_NOVA_CHAVE_BASE64');
```

Confirme o hostname HTTPS efetivamente usado pelo serviço Node.js antes de configurar essa URL; o exemplo vem do domínio ITR que já aparece nos ativos. Em teste, use `off` para evitar disparos reais; ao liberar o envio, mude para `'node'`. Se o backend não for configurado, o plugin continua no modo antigo `'wordpress'` por compatibilidade — nesse modo é necessária configuração SMTP separada no WordPress.

O armazenamento dos PDFs exige pasta privada fora do document root. Configure `ITR_TALENTOS_PRIVATE_DIR` no WordPress se necessário, conforme `LEIA-ME.md` do plugin.

## Deploy seguro na Hostinger

1. Faça backups do site WordPress, MySQL, currículos privados e projeto Node; preserve `.env` e recibos atuais de Propostas/Integridade.
2. Faça rotação das credenciais que foram compartilhadas em texto puro; coordene os segredos HMAC compartilhados entre sistemas para evitar indisponibilidade. Não cole valores em conversas ou código-fonte.
3. Em homologação isolada, publique **primeiro** o serviço Node 2.8.0 com `TALENTOS_NOTIFICACOES_ATIVAS=false`. Preserve os módulos existentes. Execute `npm ci` e `npm test` em ambiente Node 20/22.
4. Provisione o diretório permanente em área privada da Hostinger. Verifique que continua presente após redeploy; **em hospedagem Node gerenciada a pasta de build muda entre implantações**. Em VPS, configure permissões e backup do caminho externo.
5. Configure as cinco novas variáveis Node no ambiente de homologação. Ative `TALENTOS_NOTIFICACOES_ATIVAS=true` somente ali e execute `npm run diagnose:talentos`. O comando testa configurações e escrita local; **não envia e-mail**.
6. Instale o plugin WordPress 1.1.0 em staging; configure a URL, HMAC e a pasta PDF. Ative `'node'` apenas no staging. Configure cron de sistema para executar WP-Cron regularmente, respeitando seu plano.
7. Envie cadastro fictício com PDF fictício. Confirme protocolo, linha no MySQL, arquivo privado, evento autenticado, recibo `sent` no Node, e-mail e anexo em `comercial@itr.eng.br` (ou use uma caixa de homologação isolada no lugar dos serviços de produção).
8. Teste repetição do mesmo evento (deve retornar `ALREADY_SENT`), falha antes do SMTP (reenvio do mesmo ID) e erro após possível envio (estado `DELIVERY_UNCERTAIN`, **sem retry automático**).
9. Depois de testes completos, revisão LGPD/retenção e autorização operacional, faça rollout controlado em produção: Node primeiro, depois WordPress. Monitore os recibos, logs e caixa de entrada.

**Nunca execute `npm run enviar` ou disparo manual da automação diária como parte deste teste:** esse caminho opera notificações reais de clientes do Airtable.

## Semântica dos recibos

| HTTP Node | Código | WordPress | Conduta |
| --- | --- | --- | --- |
| 200 | `SENT` / `ALREADY_SENT` | `aceito` | Registrar aceitação SMTP. Conferir caixa postal em testes. |
| 503 | `BUSY`, `SMTP_RETRY`, `PDF_UNAVAILABLE` | `falhou` | Agendar retry do mesmo protocolo; até 4 tentativas. |
| 409 | `DELIVERY_UNCERTAIN` / `EVENT_CONFLICT` | `incerto` | **Parar, revisar manualmente; não gerar novo evento para forçar envio.** |
| 422 | `INVALID_EVENT` | `falhou` definitivo | Corrigir código/dados; não repetir cegamente. |
| 401 | `UNAUTHORIZED` | `falhou` | Verificar chaves e relógios, sem divulgar segredo. |

`SENT` significa aceitação pelo transporte SMTP, **não prova de chegada à caixa**. Não existe garantia absoluta de entrega exatamente uma vez em falhas de rede. O sistema bloqueia reenvios quando não é seguro decidir automaticamente.

Para consultar somente a contagem de recibos no ambiente configurado, execute `npm run status:talentos`. A ferramenta é **somente leitura**, mostra estados agregados e alerta para locks antigos. Ela não libera nem apaga recibos automaticamente. Para recuperar eventos incertos, suspenda envios e faça a reconciliação com os registros SMTP antes de qualquer ação manual.

## Segurança e privacidade

- Sem novos tokens Airtable/WhatsApp ou acesso direto do frontend ao Node.
- Recibos persistentes são essenciais: não apagar arquivos `.json`, locks e nonces durante deploy ou rollback.
- Área administrativa no WordPress continua restrita a administradores.
- Validação de PDF por MIME/assinatura/hash não equivale a antivírus.
- Os dados permanecem também em e-mails e backups; definir aviso de privacidade, prazo de retenção e exclusão.
- Se o site usa WordPress em subpasta, REST customizado, CDN que altera downloads privados, WAF que bloqueia HMAC ou limites de tempo PHP curtos, ajuste o ambiente em homologação. A rota de download exige `/wp-json/` acessível por HTTPS sem redirecionamento.
- `npm run diagnose:talentos` valida a escrita no momento do teste, mas **não garante persistência após redeploy**.

## Diagnóstico local e limites de validação

`npm run verificar` executa sintaxe. `node --test tests/talentos.test.js` verifica HMAC, replay, PDF, estado persistente, deduplicação e falhas simuladas **sem rede**.

O ambiente de geração deste pacote não possuía todas as dependências Node instaladas, nem PHP CLI, WordPress real ou acesso à Hostinger. Portanto, **não** foram feitos testes de integração SMTP/WordPress em produção nem `php -l`. Essa homologação é obrigatória antes de ativar envios reais.
