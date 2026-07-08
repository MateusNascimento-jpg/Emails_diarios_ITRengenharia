// ============================================================
//  server.js  -  AGENDADOR (cron) + HEALTH-CHECK (Render)
// ------------------------------------------------------------
//  - agenda o envio diario num horario fixo (node-cron)
//  - sobe um mini servidor HTTP que a Render exige e o
//    UptimeRobot vai pingar para nao deixar o app dormir
//  - expoe /disparar-agora para teste manual protegido por senha
// ============================================================

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { executarEnvioDiario } = require('./enviar_todos.js');

const app = express();
const PORT = process.env.PORT || 3000;

// horario do envio: padrao 08:00. Formato cron: "min hora * * *"
// pode sobrescrever no .env com CRON_HORARIO (ex: "0 8 * * 1-5" = 8h seg-sex)
const CRON_HORARIO = process.env.CRON_HORARIO || '0 8 * * *';

// fuso horario de Brasilia
const TIMEZONE = 'America/Sao_Paulo';

// --- health-check: a Render precisa de uma porta ouvindo ---
app.get('/', (req, res) => {
  res.send('ITR Emails Diarios - no ar. Proximo envio agendado: ' + CRON_HORARIO);
});

// --- disparo manual protegido (para testar em producao) ---
// acesse: https://SEU-APP/disparar-agora?chave=SUA_CHAVE
// teste sem filtro de data, mantendo EMAIL_MODO_TESTE ativo:
// https://SEU-APP/disparar-agora?chave=SUA_CHAVE&ignorarData=1
app.get('/disparar-agora', async (req, res) => {
  const chave = process.env.CHAVE_DISPARO_MANUAL;
  if (!chave || req.query.chave !== chave) {
    return res.status(403).send('Acesso negado.');
  }
  const ignorarData = req.query.ignorarData === '1' || req.query.ignorarData === 'true';
  res.send(ignorarData
    ? 'Disparo de teste iniciado sem filtro de data. Veja os logs.'
    : 'Disparo iniciado. Veja os logs.');
  executarEnvioDiario({ ignorarData }).catch(e => console.error('Erro no disparo manual:', e.message));
});

app.listen(PORT, () => {
  console.log(`Servidor no ar na porta ${PORT}.`);
  console.log(`Envio diario agendado: "${CRON_HORARIO}" (fuso ${TIMEZONE}).`);
});

// --- agenda o envio diario ---
if (cron.validate(CRON_HORARIO)) {
  cron.schedule(CRON_HORARIO, () => {
    console.log('Cron disparou o envio diario.');
    executarEnvioDiario().catch(e => console.error('Erro no envio agendado:', e.message));
  }, { timezone: TIMEZONE });
} else {
  console.error(`[ERRO] CRON_HORARIO invalido: "${CRON_HORARIO}". Envio NAO agendado.`);
}