'use strict';

require('dotenv').config({ quiet: true });

const {
  buscarResumoDiarioDetalhado,
  TIMEZONE,
} = require('./airtable.js');

const {
  montarEmailsIndividualizados,
} = require('./email_template.js');

const {
  prepararEnvioWhatsAppDaOS,
  CONFIG: WHATSAPP_CONFIG,
} = require('./enviar_whatsapp.js');

const {
  criarHashEnvio,
  buscarRegistroOs,
  avaliarControle,
  CONFIG: IDEMPOTENCIA_CONFIG,
} = require('./idempotencia_airtable.js');

const {
  verificarConexao,
} = require('./enviar_email.js');

function textoEnv(nome, padrao = '') {
  return String(
    process.env[nome] ?? padrao
  ).trim();
}

function booleanoEnv(nome, padrao = false) {
  const valor = textoEnv(nome);
  if (!valor) return padrao;
  return [
    '1', 'true', 'sim', 'yes', 'on',
  ].includes(valor.toLowerCase());
}

function exigir(condicao, mensagem) {
  if (!condicao) {
    throw new Error(mensagem);
  }
}

function ultimaAtualizacaoFonteDaOS(ordem) {
  const linhas = Array.isArray(
    ordem?.linhas
  )
    ? ordem.linhas
    : [];

  let maisRecente = null;

  for (const linha of linhas) {
    const bruto = String(
      linha?.dataAtualizacao || ''
    ).trim();

    if (!bruto) continue;

    const data = new Date(bruto);
    if (Number.isNaN(data.getTime())) {
      continue;
    }

    if (
      !maisRecente ||
      data.getTime() >
        maisRecente.getTime()
    ) {
      maisRecente = data;
    }
  }

  return maisRecente
    ? maisRecente.toISOString()
    : '';
}

function dataCalendarioNoFuso(
  data,
  timezone
) {
  const partes = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }
  ).formatToParts(data);

  const mapa = Object.fromEntries(
    partes.map(item => [
      item.type,
      item.value,
    ])
  );

  return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

function agoraSimuladoParaAmanha() {
  // O agrupador só usa o calendário no fuso configurado para definir
  // "ontem". Avançar 24h é suficiente para simular o processamento de
  // amanhã sem enviar nada e sem alterar dados.
  return new Date(
    Date.now() +
    24 * 60 * 60 * 1000
  );
}

function hashEmail({
  cliente,
  ordem,
  mensagens,
}) {
  return criarHashEnvio({
    canal: 'email',
    clienteId:
      cliente?.clienteId || '',
    osId:
      ordem?.osId || '',
    destino:
      mensagens.map(
        item => item.destinatario
      ),
    conteudo:
      mensagens.map(item => ({
        destinatario:
          item.destinatario,
        contatoPrincipal:
          item.ehContatoPrincipal ===
          true,
        assunto: item.assunto,
        texto: item.texto,
        html: item.html,
      })),
  });
}

function hashWhatsapp({
  cliente,
  ordem,
  preparado,
}) {
  const destinos =
    Array.isArray(preparado.envios)
      ? preparado.envios
          .map(
            item =>
              item.payload?.to || ''
          )
          .filter(Boolean)
          .sort()
          .join('|')
      : preparado.payload?.to || '';

  const conteudo =
    Array.isArray(preparado.envios)
      ? preparado.envios
          .map(item => item.payload)
      : preparado.payload;

  return criarHashEnvio({
    canal: 'whatsapp',
    clienteId:
      cliente?.clienteId || '',
    osId:
      ordem?.osId || '',
    destino: destinos,
    conteudo,
  });
}

function avaliacaoEhSegura(avaliacao) {
  if (avaliacao?.permitirReserva) {
    return true;
  }

  return (
    avaliacao?.bloqueado === true &&
    avaliacao
      ?.confirmadoAnteriormente ===
      true
  );
}

async function executar() {
  exigir(
    booleanoEnv('CRON_ATIVO'),
    'CRON_ATIVO precisa estar true para a automação de amanhã.'
  );

  exigir(
    textoEnv('CRON_HORARIO') ===
      '0 8 * * *',
    'CRON_HORARIO precisa estar exatamente "0 8 * * *".'
  );

  exigir(
    TIMEZONE ===
      'America/Sao_Paulo',
    `APP_TIMEZONE inesperado: ${TIMEZONE}.`
  );

  exigir(
    booleanoEnv('EMAIL_ATIVO'),
    'EMAIL_ATIVO precisa estar true.'
  );

  exigir(
    WHATSAPP_CONFIG.ativo === true,
    'WHATSAPP_ATIVO precisa estar true.'
  );

  exigir(
    WHATSAPP_CONFIG.simular === false,
    'WHATSAPP_SIMULAR precisa estar false em produção.'
  );

  exigir(
    WHATSAPP_CONFIG.modoTeste === false,
    'WHATSAPP_MODO_TESTE precisa estar false em produção.'
  );

  exigir(
    IDEMPOTENCIA_CONFIG.ativo === true,
    'IDEMPOTENCIA_ATIVA precisa estar true.'
  );

  // Verificação SMTP autentica no servidor, mas não envia mensagem.
  await verificarConexao();

  const agoraAmanha =
    agoraSimuladoParaAmanha();

  const dataExecucao =
    dataCalendarioNoFuso(
      agoraAmanha,
      TIMEZONE
    );

  const resultado =
    await buscarResumoDiarioDetalhado({
      agora: agoraAmanha,
      ignorarData: false,
    });

  const clientes =
    Array.isArray(resultado?.clientes)
      ? resultado.clientes
      : [];

  let quantidadeOS = 0;
  let quantidadeLinhas = 0;
  let emailsPreparados = 0;
  let whatsappsPreparados = 0;
  let duplicatasJaConfirmadas = 0;
  const problemas = [];

  for (const cliente of clientes) {
    const ordens =
      Array.isArray(cliente?.ordens)
        ? cliente.ordens
        : [];

    for (const ordem of ordens) {
      quantidadeOS += 1;
      quantidadeLinhas +=
        Array.isArray(ordem?.linhas)
          ? ordem.linhas.length
          : 0;

      const fonteAtualizadaEm =
        ultimaAtualizacaoFonteDaOS(
          ordem
        );

      const mensagens =
        montarEmailsIndividualizados(
          cliente,
          ordem
        );

      if (mensagens.length === 0) {
        problemas.push(
          `${ordem?.osNome || ordem?.osId || '(OS)'}: nenhum e-mail válido.`
        );
      } else {
        emailsPreparados +=
          mensagens.length;
      }

      const preparadoWhatsApp =
        prepararEnvioWhatsAppDaOS({
          cliente,
          ordem,
        });

      if (!preparadoWhatsApp?.ok) {
        problemas.push(
          `${ordem?.osNome || ordem?.osId || '(OS)'}: WhatsApp não pôde ser preparado (${preparadoWhatsApp?.motivo || 'motivo desconhecido'}).`
        );
      } else {
        whatsappsPreparados +=
          preparadoWhatsApp
            .quantidadeMensagens || 0;
      }

      if (
        IDEMPOTENCIA_CONFIG.ativo &&
        ordem?.osId
      ) {
        const registroOs =
          await buscarRegistroOs(
            ordem.osId
          );

        if (mensagens.length > 0) {
          const avaliacaoEmail =
            avaliarControle({
              registro: registroOs,
              canal: 'email',
              hash: hashEmail({
                cliente,
                ordem,
                mensagens,
              }),
              agora: agoraAmanha,
              fonteAtualizadaEm,
            });

          if (!avaliacaoEhSegura(
            avaliacaoEmail
          )) {
            problemas.push(
              `${ordem?.osNome || ordem.osId}: idempotência de e-mail bloqueada (${avaliacaoEmail?.motivo || 'motivo desconhecido'}).`
            );
          } else if (
            avaliacaoEmail
              ?.confirmadoAnteriormente ===
              true
          ) {
            duplicatasJaConfirmadas += 1;
          }
        }

        if (preparadoWhatsApp?.ok) {
          const avaliacaoWhatsapp =
            avaliarControle({
              registro: registroOs,
              canal: 'whatsapp',
              hash: hashWhatsapp({
                cliente,
                ordem,
                preparado:
                  preparadoWhatsApp,
              }),
              agora: agoraAmanha,
              fonteAtualizadaEm,
            });

          if (!avaliacaoEhSegura(
            avaliacaoWhatsapp
          )) {
            problemas.push(
              `${ordem?.osNome || ordem.osId}: idempotência de WhatsApp bloqueada (${avaliacaoWhatsapp?.motivo || 'motivo desconhecido'}).`
            );
          } else if (
            avaliacaoWhatsapp
              ?.confirmadoAnteriormente ===
              true
          ) {
            duplicatasJaConfirmadas += 1;
          }
        }
      }
    }
  }

  exigir(
    problemas.length === 0,
    'Prontidão de produção falhou:\n- ' +
      problemas.join('\n- ')
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        envioReal: false,
        escritaAirtable: false,
        chamadaMeta: false,
        smtp: 'conexao-autenticada-sem-envio',
        simulacaoExecucaoEm:
          dataExecucao,
        timezone: TIMEZONE,
        clientes:
          clientes.length,
        ordensServico:
          quantidadeOS,
        linhas:
          quantidadeLinhas,
        emailsPreparados,
        whatsappsPreparados,
        duplicatasJaConfirmadas,
        mensagem:
          quantidadeOS > 0
            ? 'Candidatos de amanhã preparados sem erro.'
            : 'Nenhuma OS elegível encontrada para amanhã; infraestrutura validada.',
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  executar().catch(erro => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          envioReal: false,
          escritaAirtable: false,
          erro:
            erro?.message ||
            String(erro),
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  });
}

module.exports = {
  ultimaAtualizacaoFonteDaOS,
  hashEmail,
  hashWhatsapp,
  dataCalendarioNoFuso,
  agoraSimuladoParaAmanha,
};
