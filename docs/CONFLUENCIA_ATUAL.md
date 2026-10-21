# Confluência atual Portal ↔ Notificações (correções de outubro/2026)

## Escopo aplicado

Contrato gerado de senha e fluxo `ACCESS_REQUEST` **mantidos para não bloquear clientes**. Consolidado o handler de login e recuperação do Portal, aposentando os dois handlers duplicados inalcançáveis. Todas as rotas de senha pessoal ainda protegidas pelo middleware retornam HTTP 410; Diretor, frontend, relatórios, Propostas e endpoints públicos existentes permanecem.

### Configuração compartilhada (obrigatória no ambiente real)

| Portal | Notificações | Regra |
| --- | --- | --- |
| `AIRTABLE_BASE_ID` | `AIRTABLE_BASE_ID` | Mesma base operacional |
| `AIRTABLE_CLIENTES_TABLE_ID` | `AIRTABLE_CLIENTES_TABLE_ID` | Mesma tabela Clientes; default `tblkQxQ6q7cBKXZ3C` |
| `AIRTABLE_CLIENT_SIGLA_FIELD` | `AIRTABLE_CLIENT_SIGLA_FIELD` | Mesmo nome exato do campo; default `Sigla Cliente` |
| `PORTAL_NOTIFICATIONS_HMAC_SECRET` | `PORTAL_INTERNAL_HMAC_SECRET` | Mesmo valor Base64 aleatório, mínimo 32 bytes (não colar em logs) |

Usar HTTPS na comunicação em produção; sincronização NTP nos dois servidores. Reverse proxy deve preservar os bytes exatos do corpo JSON e o `Content-Type: application/json`. Não copiar arquivos `.env` de um serviço para o outro nem sobrescrever os `.env` existentes em atualização. Em caso de rotação HMAC, atualizar ambos os serviços de forma coordenada; validar imediatamente o diagnóstico.

### Implantação recomendada, sem indisponibilidade

1. Faça backups completos de **ambos os projetos**, `.env` e volumes de recibos das Propostas (fora do código). Não publique `.env` no Git nem no ZIP.
2. Confira se `AIRTABLE_BASE_ID`, tabela Clientes e campo Sigla apontam exatamente para a mesma fonte. Verifique `PORTAL_ORIGIN`/`PORTAL_NOTIFICATIONS_URL` e os dois segredos HMAC conforme tabela. Não exiba os segredos para conferir; compare hashes com procedimentos autorizados.
3. Publique o serviço de **Notificações primeiro**. Execute `npm ci --ignore-scripts --no-audit --no-fund`, `npm test` e `npm run preflight` em ambiente controlado.
4. Publique o **Portal depois** (preserve banco MySQL e `.env`), execute `npm ci --ignore-scripts --no-audit --no-fund`, `npm run verify`, `npm test` e `npm run preflight` conforme infraestrutura configurada.
5. No Portal execute `npm run diagnose:notifications`. O endpoint `/internal/portal/diagnostic` não envia SMTP/WhatsApp. Valida assinatura HMAC, relógio e fingerprint de base/tabela/campo Sigla. Se falhar, **não prosseguir ao envio de credenciais de clientes**; investigar configurações e rede. O boot efetua diagnóstico assíncrono e grava resultado em log sem bloquear serviço de relatórios.
6. Valide com dados autorizados de cliente de teste: CNPJ + senha vigente, recuperação e entrega real, isolamento entre clientes, Propostas, PDF, Diretor, diário e WhatsApp V3. Em seguida monitore erros `[CONFLUENCIA]` e `[ACCESS_REQUEST]`.

### Limites desta entrega / risco residual importante

A senha `trim(sigla) + primeiros 6 dígitos do CNPJ` ainda é previsível e pode continuar em e-mails existentes. O teste de contrato NÃO transforma essa senha em segura. Migração para senha aleatória individual armazenada com hash, ou link temporário, exige: cadastramento de clientes, canal seguro de distribuição, revogação de sessões e atualização simultânea do Portal, Notificações e telas/ajuda. Isso **não foi ativado nesta manutenção**, para evitar lockout de clientes e alteração inesperada da experiência. Planejar como release separada com procedimento de migração e rollback.

`ACCESS_REQUEST` ainda tenta individualmente os destinatários. Uma falha SMTP parcial pode exigir nova tentativa, sujeita a entrega duplicada; recibos por destinatário/persistência são melhoria futura, não adicionados sem novo requisito de armazenamento.

O WhatsApp V3 não recebe credenciais. Fontes `senha`, `senha_inicial` e `senha_acesso` foram removidas e explicitamente recusadas no template. Um template experimental V4 descrito em notas históricas NÃO está coberto e precisaria ser redesenhado sem senha.

### Testes de contrato offline

Depois de extrair os **dois ZIPs na mesma pasta**, rode no diretório superior:

```powershell
node .\VERIFICAR_CONFLUENCIA.js
```

Pode passar os caminhos do Portal e Notificações como argumentos opcionais. O script usa credenciais *fictícias* e transporte simulado, sem acesso ao Airtable, à rede ou envio de mensagens. `npm test` e `preflight` **não** substituem a validação operacional real do ambiente.
