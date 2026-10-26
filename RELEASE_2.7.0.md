# E-mails ITR 2.7.0 — VERIFY v1 e bloco de acesso com senha válida

Base: 2.6.1 (`main` 633c5a4). Visual aprovado preservado (logo, tabela, nuvem azul-índigo inteira e clicável, cores e tamanhos). Sem alteração em `assets/`.

## Bloco "Acesso ao Portal do Cliente" (NEW, ACCEPTED, INVOICE)
- Removido o texto "Para obter seus dados de acesso, utilize a recuperação de acesso do Portal." (HTML) e "Recupere seus dados pela página de login." (texto simples).
- Senha confirmada → `CNPJ: …` + `Senha: …` + "Mantenha estes dados protegidos." (formato já aprovado).
- Senha não confirmada → apenas `CNPJ: …`.
- **Correção da causa**: `proposals/access.js` agora usa a mesma regra do login do Portal (`buscarIdentidadeAcesso`): todos os cadastros operacionais do CNPJ devem gerar a mesma senha `sigla + 6 primeiros dígitos do CNPJ`. Antes, um CNPJ com dois cadastros de mesma sigla (login válido no Portal) recebia o texto de recuperação.
- Airtable indisponível (rede, 429, 5xx) adia o envio até 5 vezes (`503 ACCESS_RETRY`, o Portal reenvia o MESMO evento); depois segue só com o CNPJ. Recusa definitiva (contato não pertence ao cliente financeiro único, siglas divergentes, configuração ausente) segue só com o CNPJ e registra aviso sem dados pessoais.
- VERIFY nunca recebe bloco de acesso nem senha.

## VERIFY (contrato `verify-v1`, `tests/fixtures/verify-event-v1.json`)
- Texto: "Seu código de aceite: 12345678", "Digite este código no Portal do Cliente … e confirme expressamente sua decisão", "2 horas (120 minutos)", validade em horário de Brasília.
- Receptor exige `code` string de 8 dígitos, `actionUrl` ausente, `expiresAt` no máximo 2 h + 5 min à frente.
- Limite do corpo do evento: 16 kB → 64 kB (descrições longas não ficam presas em 413).
- `/internal/portal/diagnostic` declara `proposalsContract: 'verify-v1'`.

## Testes
`tests/verify-contract-v1.test.js`, `tests/access-block-20261026.test.js`, `tests/commercial-access-all.test.js` (regra alinhada ao Portal; siglas divergentes continuam bloqueadas).
