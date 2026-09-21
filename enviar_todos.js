'use strict';

// ============================================================
// enviar_todos.js — ORQUESTRADOR FINAL DE E-MAIL E WHATSAPP
// ============================================================
// Fluxo:
//
// 1. Consulta os dados no Airtable.
// 2. Aplica o filtro de data e status.
// 3. Recebe os dados agrupados em:
//      Cliente → Ordem de Serviço → Linhas.
// 4. Gera um e-mail individual por destinatário de cada OS.
// 5. Após o e-mail, gera a notificação de WhatsApp da OS.
// 6. O e-mail mantém os detalhes da OS; o WhatsApp leva apenas
//    identificação da OS e status consolidado no template V3.
// 7. Se o cliente possuir mais de um WhatsApp válido, a mesma
//    notificação será enviada para cada número.
// 8. Uma falha em um canal não encerra toda a execução.
// 9. Duas execuções simultâneas no mesmo processo são impedidas.
//
// Regras:
//
// UMA ORDEM DE SERVIÇO = UMA ATUALIZAÇÃO DE E-MAIL POR DESTINATÁRIO
// UMA ORDEM DE SERVIÇO = UMA NOTIFICAÇÃO DE WHATSAPP
// UMA NOTIFICAÇÃO = UMA MENSAGEM PARA CADA DESTINATÁRIO
//
// Os dados utilizados nos dois canais vêm do Airtable.
// ============================================================

require('dotenv').config({ quiet: true });

const {
  buscarResumoDiario,
} = require('./airtable.js');

const {
  montarEmailDaOS,
  montarEmailsIndividualizados,
} = require('./email_template.js');

const {
  enviar,
  mascararDestinos,
  MODO_TESTE,
} = require('./enviar_email.js');

const {
  prepararEnvioWhatsAppDaOS,
  enviarWhatsAppDaOS,
  CONFIG: WHATSAPP_CONFIG,
} = require('./enviar_whatsapp.js');

const {
  criarHashEnvio,
  reservarEnvio,
  marcarComoEnviado,
  marcarComoFalhou,
  marcarComoIncerto,
  CONFIG: IDEMPOTENCIA_CONFIG,
} = require('./idempotencia_airtable.js');

// ============================================================
// CONFIGURAÇÕES
// ============================================================

function textoEnv(nome, padrao = '') {
  return String(
    process.env[nome] ?? padrao
  ).trim();
}

function booleanoEnv(nome, padrao = false) {
  const valor = textoEnv(nome);

  if (!valor) {
    return padrao;
  }

  return [
    '1',
    'true',
    'sim',
    'yes',
    'on',
  ].includes(valor.toLowerCase());
}

function numeroInteiroNaoNegativo(
  valor,
  padrao
) {
  const numero = Number.parseInt(
    String(valor ?? ''),
    10
  );

  return Number.isInteger(numero) &&
    numero >= 0
    ? numero
    : padrao;
}

const CONFIG = Object.freeze({
  emailAtivo: booleanoEnv(
    'EMAIL_ATIVO',
    true
  ),

  whatsappExigirEmailEnviado: booleanoEnv(
    'WHATSAPP_EXIGIR_EMAIL_ENVIADO',
    true
  ),

  emailPausaMs: numeroInteiroNaoNegativo(
    process.env.EMAIL_PAUSA_MS,
    1500
  ),

  whatsappPausaMs: numeroInteiroNaoNegativo(
    process.env.WHATSAPP_PAUSA_MS,
    1200
  ),

  pausaEntreOsMs: numeroInteiroNaoNegativo(
    process.env.PAUSA_ENTRE_OS_MS,
    0
  ),
});

// ============================================================
// TRAVA DE EXECUÇÃO
// ============================================================

let execucaoEmAndamento = null;

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function dormir(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function agoraFormatado() {
  return new Date().toLocaleString(
    'pt-BR',
    {
      timeZone:
        process.env.APP_TIMEZONE ||
        'America/Sao_Paulo',
    }
  );
}

function textoSeguro(valor, fallback) {
  const resultado = String(
    valor ?? ''
  ).trim();

  return resultado || fallback;
}

function possuiDestinatarioEmail(cliente) {
  if (
    Array.isArray(cliente?.emails) &&
    cliente.emails.length > 0
  ) {
    return true;
  }

  return Boolean(
    String(
      cliente?.email || ''
    ).trim()
  );
}

function destinoEmailDoCliente(cliente) {
  if (
    Array.isArray(cliente?.emails) &&
    cliente.emails.length > 0
  ) {
    return cliente.emails;
  }

  return cliente?.email || '';
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

    if (!bruto) {
      continue;
    }

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
function idempotenciaAplicavelAoEmail() {
  return (
    IDEMPOTENCIA_CONFIG.ativo &&
    CONFIG.emailAtivo &&
    !MODO_TESTE
  );
}

function idempotenciaAplicavelAoWhatsapp() {
  return (
    IDEMPOTENCIA_CONFIG.ativo &&
    WHATSAPP_CONFIG.ativo &&
    !WHATSAPP_CONFIG.simular &&
    !WHATSAPP_CONFIG.modoTeste
  );
}

function emailConfirmado(resultado) {
  return (
    resultado?.enviado === true ||
    resultado?.confirmadoAnteriormente === true
  );
}

function erroEmailEhGlobal(erro) {
  const codigo =
    String(
      erro?.code || ''
    )
      .trim()
      .toUpperCase();

  const resposta =
    Number(
      erro?.responseCode || 0
    );

  return (
    codigo === 'EAUTH' ||
    resposta === 530 ||
    resposta === 535
  );
}

function falhaWhatsappEhIncerta(resultado) {
  if (resultado?.parcial === true) {
    return true;
  }

  const statusHttp = Number(
    resultado?.statusHttp || 0
  );

  const tipoErro = String(
    resultado?.tipoErro || ''
  ).toLowerCase();

  if (
    tipoErro.includes('timeout') ||
    tipoErro.includes('network') ||
    tipoErro.includes('rede')
  ) {
    return true;
  }

  if (!statusHttp) {
    return true;
  }

  return (
    statusHttp === 408 ||
    statusHttp === 429 ||
    statusHttp >= 500
  );
}

async function finalizarIdempotencia({
  reserva,
  estado,
  canal,
  clienteNome,
  osNome,
  resumo,
}) {
  if (!reserva) {
    return {
      ok: true,
      atualizado: false,
      bypass: true,
    };
  }

  let resultado;

  if (estado === 'enviado') {
    resultado = await marcarComoEnviado(
      reserva
    );
  } else if (estado === 'falhou') {
    resultado = await marcarComoFalhou(
      reserva
    );
  } else {
    resultado = await marcarComoIncerto(
      reserva
    );
  }

  if (!resultado?.ok) {
    resumo[canal]
      .idempotenciaFalhas += 1;

    console.error(
      `  [IDEMPOTÊNCIA ALERTA] ` +
      `${clienteNome} / ${osNome} / ` +
      `${canal}: ` +
      `${resultado?.mensagem || `falha ao registrar ${estado}`}`
    );
  }

  return resultado;
}

function resultadoBloqueadoPorIdempotencia({
  controle,
  canal,
  clienteNome,
  osNome,
  resumo,
}) {
  resumo[canal]
    .idempotenciaIgnorados += 1;

  if (controle?.ok === false) {
    resumo[canal]
      .idempotenciaFalhas += 1;
  }

  console.warn(
    `  [${canal.toUpperCase()} IDEMPOTÊNCIA] ` +
    `${clienteNome} / ${osNome}: ` +
    `${controle?.motivo || 'envio bloqueado'}`
  );

  return {
    ok:
      controle?.ok !== false,

    enviado:
      false,

    simulado:
      false,

    ignorado:
      true,

    motivo:
      controle?.motivo ||
      'bloqueado-por-idempotencia',

    mensagem:
      controle?.mensagem || '',

    confirmadoAnteriormente:
      controle?.confirmadoAnteriormente === true,

    idempotencia:
      true,
  };
}

function criarResumoInicial() {
  return {
    ok: true,
    executado: true,
    motivo: '',

    inicio:
      new Date().toISOString(),

    fim: '',

    duracaoMs: 0,

    clientesEncontrados: 0,
    ordensEncontradas: 0,
    ordensProcessadas: 0,
    ordensSemLinhas: 0,

    email: {
      enviados: 0,
      destinatariosEnviados: 0,
      destinatariosComFalha: 0,
      parciais: 0,
      falhas: 0,
      semDestino: 0,
      desativados: 0,
      idempotenciaIgnorados: 0,
      idempotenciaFalhas: 0,
    },

    whatsapp: {
      enviados: 0,
      destinatariosEnviados: 0,
      destinatariosComFalha: 0,
      simulados: 0,
      falhas: 0,
      ignorados: 0,
      desativados: 0,
      bloqueadosPorEmail: 0,
      idempotenciaIgnorados: 0,
      idempotenciaFalhas: 0,
    },
  };
}

function registrarResultadoWhatsApp(
  resumo,
  resultado
) {
  if (!resultado) {
    resumo.whatsapp.falhas += 1;
    return;
  }

  const quantidadeEnviados =
    Number.isInteger(
      resultado.quantidadeEnviados
    )
      ? resultado.quantidadeEnviados
      : (
          resultado.enviado === true
            ? 1
            : 0
        );

  const quantidadeFalhas =
    Number.isInteger(
      resultado.quantidadeFalhas
    )
      ? resultado.quantidadeFalhas
      : (
          resultado.ok === false
            ? 1
            : 0
        );

  resumo.whatsapp
    .destinatariosEnviados +=
      quantidadeEnviados;

  resumo.whatsapp
    .destinatariosComFalha +=
      quantidadeFalhas;

  if (resultado.parcial === true) {
    if (resultado.enviado === true) {
      resumo.whatsapp.enviados += 1;
    }

    resumo.whatsapp.falhas += 1;
    return;
  }

  if (
    resultado.enviado === true
  ) {
    resumo.whatsapp.enviados += 1;
    return;
  }

  if (
    resultado.simulado === true
  ) {
    resumo.whatsapp.simulados += 1;
    return;
  }

  if (
    resultado.motivo ===
    'whatsapp-desativado'
  ) {
    resumo.whatsapp.desativados += 1;
    return;
  }

  if (
    resultado.ignorado === true
  ) {
    resumo.whatsapp.ignorados += 1;
    return;
  }

  if (resultado.ok === false) {
    resumo.whatsapp.falhas += 1;
    return;
  }

  resumo.whatsapp.ignorados += 1;
}

// ============================================================
// PROCESSAMENTO DO E-MAIL DE UMA OS
// ============================================================

async function processarEmailDaOS({
  cliente,
  ordem,
  resumo,
}) {
  const clienteNome =
    textoSeguro(
      cliente?.clienteNome,
      '(cliente sem nome)'
    );

  const osNome =
    textoSeguro(
      ordem?.osNome ||
        ordem?.osId,
      '(OS sem nome)'
    );

  if (!CONFIG.emailAtivo) {
    resumo.email.desativados += 1;

    console.log(
      `  [E-MAIL DESATIVADO] ` +
      `${clienteNome} / ${osNome}`
    );

    return {
      ok: true,
      enviado: false,
      ignorado: true,
      motivo: 'email-desativado',
    };
  }

  const possuiDestino =
    possuiDestinatarioEmail(
      cliente
    );

  if (
    !possuiDestino &&
    !MODO_TESTE
  ) {
    resumo.email.semDestino += 1;

    console.warn(
      `  [E-MAIL PULADO] ` +
      `${clienteNome} / ${osNome}: ` +
      `cliente sem e-mail cadastrado.`
    );

    return {
      ok: false,
      enviado: false,
      ignorado: true,
      motivo: 'sem-email',
    };
  }

  let reserva = null;

  try {
    let mensagens =
      montarEmailsIndividualizados(
        cliente,
        ordem
      );

    // Mantém o modo de teste útil mesmo quando o cliente não
    // possui e-mail real: envia uma prévia única ao EMAIL_MODO_TESTE.
    if (
      mensagens.length === 0 &&
      MODO_TESTE
    ) {
      mensagens = [
        {
          destinatario: '',
          ehContatoPrincipal: true,
          ...montarEmailDaOS(
            cliente,
            ordem,
            {
              destinatarioEmail: '',
              ehContatoPrincipal: true,
            }
          ),
        },
      ];
    }

    if (mensagens.length === 0) {
      resumo.email.semDestino += 1;

      return {
        ok: false,
        enviado: false,
        ignorado: true,
        motivo: 'sem-email',
      };
    }

    for (const mensagem of mensagens) {
      if (
        !mensagem?.assunto ||
        !mensagem?.html ||
        !mensagem?.texto
      ) {
        throw new Error(
          'O template de e-mail retornou ' +
          'conteúdo incompleto.'
        );
      }
    }

    if (idempotenciaAplicavelAoEmail()) {
      const hash = criarHashEnvio({
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
              item.ehContatoPrincipal === true,
            assunto:
              item.assunto,
            texto:
              item.texto,
            html:
              item.html,
          })),
      });

      const controle =
        await reservarEnvio({
          canal:
            'email',

          osId:
            ordem?.osId || '',

          hash,

          fonteAtualizadaEm:
            ultimaAtualizacaoFonteDaOS(
              ordem
            ),
        });

      if (
        controle?.bloqueado === true ||
        controle?.ok === false
      ) {
        return resultadoBloqueadoPorIdempotencia({
          controle,
          canal: 'email',
          clienteNome,
          osNome,
          resumo,
        });
      }

      reserva =
        controle?.reserva || null;
    }

    const resultados = [];
    let erroGlobalCanal = null;

    for (
      let indice = 0;
      indice < mensagens.length;
      indice += 1
    ) {
      const mensagem =
        mensagens[indice];

      try {
        const resultado =
          await enviar({
            para:
              mensagem.destinatario,

            assunto:
              mensagem.assunto,

            html:
              mensagem.html,

            texto:
              mensagem.texto,
          });

        if (!resultado?.ok) {
          console.error(
            `  [E-MAIL FALHA ` +
            `${indice + 1}/${mensagens.length}] ` +
            `${clienteNome} / ${osNome}: ` +
            `${resultado?.motivo || 'falha desconhecida'}`
          );

          resultados.push({
            ok: false,
            enviado: false,
            motivo:
              resultado?.motivo ||
              'falha-email',
            destinatario:
              mensagem.destinatario,
            contatoPrincipal:
              mensagem.ehContatoPrincipal === true,
          });

          continue;
        }

        const destinoLog =
          mascararDestinos(
            mensagem.destinatario ||
            resultado.destino
          ).join(', ');

        console.log(
          `  [E-MAIL OK ` +
          `${indice + 1}/${mensagens.length}] ` +
          `${clienteNome} / ${osNome}` +
          `${destinoLog ? ` → ${destinoLog}` : ''}` +
          `${mensagem.ehContatoPrincipal ? ' [contato principal]' : ''}`
        );

        resultados.push({
          ok: true,
          enviado: true,
          id: resultado.id || '',
          destinatario:
            mensagem.destinatario,
          destinoMascarado:
            mascararDestinos(
              mensagem.destinatario ||
              resultado.destino
            ),
          contatoPrincipal:
            mensagem.ehContatoPrincipal === true,
        });
      } catch (erro) {
        console.error(
          `  [E-MAIL ERRO ` +
          `${indice + 1}/${mensagens.length}] ` +
          `${clienteNome} / ${osNome}: ` +
          `${erro?.message || erro}`
        );

        resultados.push({
          ok: false,
          enviado: false,
          motivo: 'erro-email',
          mensagem:
            erro?.message ||
            String(erro),
          destinatario:
            mensagem.destinatario,
          contatoPrincipal:
            mensagem.ehContatoPrincipal === true,
        });

        if (erroEmailEhGlobal(erro)) {
          erroGlobalCanal = {
            code:
              String(erro?.code || ''),
            responseCode:
              Number(
                erro?.responseCode || 0
              ),
            mensagem:
              erro?.message ||
              String(erro),
          };

          console.error(
            `  [E-MAIL] Canal interrompido nesta execução: ` +
            `falha global de autenticação SMTP.`
          );

          break;
        }
      }
    }

    const enviados =
      resultados.filter(
        item => item.enviado === true
      );

    const falhas =
      resultados.filter(
        item => item.ok === false
      );

    resumo.email.destinatariosEnviados +=
      enviados.length;

    resumo.email.destinatariosComFalha +=
      falhas.length;

    if (enviados.length > 0) {
      resumo.email.enviados += 1;
    }

    if (falhas.length > 0) {
      resumo.email.falhas += 1;
    }

    const parcial =
      enviados.length > 0 &&
      falhas.length > 0;

    if (parcial) {
      resumo.email.parciais += 1;
    }

    const estadoIdempotencia =
      falhas.length === 0
        ? 'enviado'
        : (
            enviados.length > 0
              ? 'incerto'
              : 'falhou'
          );

    const idempotencia =
      await finalizarIdempotencia({
        reserva,
        estado:
          estadoIdempotencia,
        canal:
          'email',
        clienteNome,
        osNome,
        resumo,
      });

    if (parcial) {
      console.warn(
        `  [E-MAIL PARCIAL] ` +
        `${clienteNome} / ${osNome}: ` +
        `${enviados.length} enviado(s), ` +
        `${falhas.length} falha(s).`
      );
    }

    return {
      ok:
        falhas.length === 0,

      enviado:
        enviados.length > 0,

      parcial,

      ignorado:
        false,

      motivo:
        erroGlobalCanal
          ? 'erro-email-global'
          : (
              falhas.length === 0
                ? ''
                : (
                    parcial
                      ? 'email-parcial'
                      : 'falha-email'
                  )
            ),

      erroGlobalCanal:
        Boolean(erroGlobalCanal),

      detalheErroGlobal:
        erroGlobalCanal,

      quantidadeDestinos:
        resultados.length,

      quantidadeEnviados:
        enviados.length,

      quantidadeFalhas:
        falhas.length,

      resultados,

      idempotenciaPersistida:
        idempotencia?.ok !== false,
    };
  } catch (erro) {
    await finalizarIdempotencia({
      reserva,

      estado:
        'incerto',

      canal:
        'email',

      clienteNome,
      osNome,
      resumo,
    });

    resumo.email.falhas += 1;

    console.error(
      `  [E-MAIL ERRO] ` +
      `${clienteNome} / ${osNome}: ` +
      `${erro?.message || erro}`
    );

    return {
      ok:
        false,

      enviado:
        false,

      ignorado:
        false,

      motivo:
        erroEmailEhGlobal(erro)
          ? 'erro-email-global'
          : 'erro-email',

      erroGlobalCanal:
        erroEmailEhGlobal(erro),

      detalheErroGlobal:
        erroEmailEhGlobal(erro)
          ? {
              code:
                String(erro?.code || ''),
              responseCode:
                Number(
                  erro?.responseCode || 0
                ),
              mensagem:
                erro?.message ||
                String(erro),
            }
          : null,

      mensagem:
        erro?.message ||
        String(erro),
    };
  }
}

// ============================================================
// PROCESSAMENTO DO WHATSAPP DE UMA OS
// ============================================================

async function processarWhatsAppDaOS({
  cliente,
  ordem,
  emailResultado,
  resumo,
}) {
  const clienteNome =
    textoSeguro(
      cliente?.clienteNome,
      '(cliente sem nome)'
    );

  const osNome =
    textoSeguro(
      ordem?.osNome ||
        ordem?.osId,
      '(OS sem nome)'
    );

  if (
    CONFIG.whatsappExigirEmailEnviado &&
    !emailConfirmado(emailResultado)
  ) {
    resumo.whatsapp
      .bloqueadosPorEmail += 1;

    console.warn(
      `  [WHATSAPP PULADO] ` +
      `${clienteNome} / ${osNome}: ` +
      `o e-mail da OS não foi confirmado.`
    );

    return {
      ok:
        true,

      enviado:
        false,

      simulado:
        false,

      ignorado:
        true,

      motivo:
        'email-nao-confirmado',
    };
  }

  let reserva = null;

  try {
    if (
      idempotenciaAplicavelAoWhatsapp()
    ) {
      const preparado =
        prepararEnvioWhatsAppDaOS({
          cliente,
          ordem,
        });

      if (preparado?.ok) {
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

        const hash = criarHashEnvio({
          canal:
            'whatsapp',

          clienteId:
            cliente?.clienteId || '',

          osId:
            ordem?.osId || '',

          destino:
            destinos,

          conteudo,
        });

        const controle =
          await reservarEnvio({
            canal:
              'whatsapp',

            osId:
              ordem?.osId || '',

            hash,

            fonteAtualizadaEm:
              ultimaAtualizacaoFonteDaOS(
                ordem
              ),
          });

        if (
          controle?.bloqueado === true ||
          controle?.ok === false
        ) {
          const bloqueado =
            resultadoBloqueadoPorIdempotencia({
              controle,
              canal:
                'whatsapp',

              clienteNome,
              osNome,
              resumo,
            });

          registrarResultadoWhatsApp(
            resumo,
            bloqueado
          );

          return bloqueado;
        }

        reserva =
          controle?.reserva || null;
      }
    }

    const resultado =
      await enviarWhatsAppDaOS({
        cliente,
        ordem,
      });

    if (
      resultado?.enviado === true &&
      resultado?.parcial !== true
    ) {
      resultado.idempotenciaPersistida =
        (
          await finalizarIdempotencia({
            reserva,

            estado:
              'enviado',

            canal:
              'whatsapp',

            clienteNome,
            osNome,
            resumo,
          })
        )?.ok !== false;
    } else if (reserva) {
      const incerto =
        resultado?.ok === false &&
        falhaWhatsappEhIncerta(
          resultado
        );

      await finalizarIdempotencia({
        reserva,

        estado:
          incerto
            ? 'incerto'
            : 'falhou',

        canal:
          'whatsapp',

        clienteNome,
        osNome,
        resumo,
      });
    }

    registrarResultadoWhatsApp(
      resumo,
      resultado
    );

    return resultado;
  } catch (erro) {
    await finalizarIdempotencia({
      reserva,

      estado:
        'incerto',

      canal:
        'whatsapp',

      clienteNome,
      osNome,
      resumo,
    });

    resumo.whatsapp.falhas += 1;

    console.error(
      `  [WHATSAPP ERRO] ` +
      `${clienteNome} / ${osNome}: ` +
      `${erro?.message || erro}`
    );

    return {
      ok:
        false,

      enviado:
        false,

      simulado:
        false,

      ignorado:
        false,

      motivo:
        'erro-whatsapp-nao-tratado',

      mensagem:
        erro?.message ||
        String(erro),
    };
  }
}

// ============================================================
// EXECUÇÃO INTERNA
// ============================================================

async function executarInternamente(
  opcoes = {}
) {
  const inicioMs = Date.now();
  const resumo = criarResumoInicial();

  const ignorarData =
    opcoes.ignorarData === true;

  console.log('');

  console.log(
    `[${agoraFormatado()}] ` +
    `Iniciando processamento diário da ITR.`
  );

  if (MODO_TESTE) {
    console.log(
      `*** E-MAIL EM MODO TESTE: ` +
      `todos os e-mails serão enviados para ` +
      `${MODO_TESTE}. ***`
    );
  }

  if (!CONFIG.emailAtivo) {
    console.log(
      '*** CANAL DE E-MAIL DESATIVADO. ***'
    );
  }

  if (IDEMPOTENCIA_CONFIG.ativo) {
    console.log(
      '*** IDEMPOTÊNCIA PERSISTENTE ATIVA: ' +
      'envios repetidos serão bloqueados pelo Airtable. ***'
    );
  } else {
    console.log(
      '*** IDEMPOTÊNCIA PERSISTENTE DESATIVADA. ***'
    );
  }

  if (!WHATSAPP_CONFIG.ativo) {
    console.log(
      '*** WHATSAPP DESATIVADO: nenhuma chamada à Meta será realizada. ***'
    );
  } else if (WHATSAPP_CONFIG.simular) {
    console.log(
      '*** WHATSAPP EM SIMULAÇÃO: os payloads serão montados, mas não enviados. ***'
    );
  } else if (WHATSAPP_CONFIG.modoTeste) {
    console.log(
      '*** WHATSAPP EM MODO TESTE: todos os envios serão redirecionados para WHATSAPP_TEST_NUMBER. ***'
    );
  }

  if (ignorarData) {
    console.log(
      '*** FILTRO DE DATA IGNORADO: serão considerados todos os registros com status permitido. ***'
    );
  }

  let clientes;
  let emailCanalInterrompido = null;
  let whatsappCanalInterrompido = null;

  try {
    clientes =
      await buscarResumoDiario({
        ...opcoes,
        ignorarData,
      });
  } catch (erro) {
    resumo.ok = false;

    resumo.motivo =
      'falha-consulta-airtable';

    resumo.fim =
      new Date().toISOString();

    resumo.duracaoMs =
      Date.now() - inicioMs;

    console.error(
      `[ERRO AIRTABLE] ` +
      `${erro?.message || erro}`
    );

    throw Object.assign(
      new Error(
        `Não foi possível consultar o Airtable: ` +
        `${erro?.message || erro}`
      ),
      {
        resumo,
        causaOriginal: erro,
      }
    );
  }

  resumo.clientesEncontrados =
    clientes.length;

  resumo.ordensEncontradas =
    clientes.reduce(
      (total, cliente) =>
        total +
        (
          Array.isArray(
            cliente?.ordens
          )
            ? cliente.ordens.length
            : 0
        ),
      0
    );

  console.log(
    `Clientes encontrados: ` +
    `${resumo.clientesEncontrados}`
  );

  console.log(
    `Ordens de Serviço encontradas: ` +
    `${resumo.ordensEncontradas}`
  );

  for (const cliente of clientes) {
    const ordens =
      Array.isArray(
        cliente?.ordens
      )
        ? cliente.ordens
        : [];

    for (const ordem of ordens) {
      const clienteNome =
        textoSeguro(
          cliente?.clienteNome,
          '(cliente sem nome)'
        );

      const osNome =
        textoSeguro(
          ordem?.osNome ||
            ordem?.osId,
          '(OS sem nome)'
        );

      const linhas =
        Array.isArray(
          ordem?.linhas
        )
          ? ordem.linhas
          : [];

      if (linhas.length === 0) {
        resumo.ordensSemLinhas += 1;

        console.warn(
          `  [OS IGNORADA] ` +
          `${clienteNome} / ${osNome}: ` +
          `nenhuma amostra ou ensaio disponível.`
        );

        continue;
      }

      resumo.ordensProcessadas += 1;

      console.log('');

      console.log(
        `Processando: ` +
        `${clienteNome} / ${osNome} / ` +
        `${linhas.length} linha(s)`
      );

      // ------------------------------------------------------
      // E-MAIL
      // ------------------------------------------------------

      let emailResultado;

      if (emailCanalInterrompido) {
        resumo.email.desativados += 1;

        emailResultado = {
          ok: false,
          enviado: false,
          ignorado: true,
          motivo:
            'canal-email-interrompido',
          mensagem:
            'O canal de e-mail foi interrompido após uma falha global de autenticação SMTP nesta execução.',
        };

        console.warn(
          `  [E-MAIL PULADO] ` +
          `${clienteNome} / ${osNome}: ` +
          `canal interrompido após falha global anterior.`
        );
      } else {
        emailResultado =
          await processarEmailDaOS({
            cliente,
            ordem,
            resumo,
          });

        if (
          emailResultado
            ?.erroGlobalCanal === true
        ) {
          emailCanalInterrompido =
            emailResultado
              .detalheErroGlobal ||
            {
              motivo:
                emailResultado
                  .motivo,
            };
        }
      }

      if (
        CONFIG.emailAtivo &&
        !emailCanalInterrompido &&
        (
          emailResultado.enviado === true ||
          emailResultado.ignorado !== true
        )
      ) {
        await dormir(
          CONFIG.emailPausaMs
        );
      }

      // ------------------------------------------------------
      // WHATSAPP
      // ------------------------------------------------------
      //
      // O módulo recebe a OS inteira.
      //
      // Não existe loop por amostra aqui.
      //
      // O enviar_whatsapp.js realiza internamente um envio para
      // cada número válido do cliente.
      // ------------------------------------------------------

      let whatsappResultado;

      if (whatsappCanalInterrompido) {
        resumo.whatsapp.ignorados += 1;

        whatsappResultado = {
          ok: false,
          enviado: false,
          simulado: false,
          ignorado: true,
          motivo:
            'canal-whatsapp-interrompido',
          mensagem:
            'O canal WhatsApp foi interrompido após uma falha global da Meta nesta execução.',
        };

        console.warn(
          `  [WHATSAPP PULADO] ` +
          `${clienteNome} / ${osNome}: ` +
          `canal interrompido após falha global anterior.`
        );
      } else {
        whatsappResultado =
          await processarWhatsAppDaOS({
            cliente,
            ordem,
            emailResultado,
            resumo,
          });

        if (
          whatsappResultado
            ?.erroGlobalCanal === true
        ) {
          whatsappCanalInterrompido =
            whatsappResultado
              .detalheErroGlobal ||
            {
              motivo:
                whatsappResultado
                  .motivo,
            };
        }
      }

      if (
        whatsappResultado?.enviado === true ||
        whatsappResultado?.simulado === true
      ) {
        await dormir(
          CONFIG.whatsappPausaMs
        );
      }

      await dormir(
        CONFIG.pausaEntreOsMs
      );
    }
  }

  resumo.fim =
    new Date().toISOString();

  resumo.duracaoMs =
    Date.now() - inicioMs;

  console.log('');

  console.log(
    '================ RESUMO ================'
  );

  console.log(
    `Clientes: ` +
    `${resumo.clientesEncontrados}`
  );

  console.log(
    `Ordens encontradas: ` +
    `${resumo.ordensEncontradas}`
  );

  console.log(
    `Ordens processadas: ` +
    `${resumo.ordensProcessadas}`
  );

  console.log(
    `Ordens sem linhas: ` +
    `${resumo.ordensSemLinhas}`
  );

  console.log(
    `OS com e-mail enviado: ` +
    `${resumo.email.enviados}`
  );

  console.log(
    `Destinatários de e-mail enviados: ` +
    `${resumo.email.destinatariosEnviados}`
  );

  console.log(
    `Destinatários de e-mail com falha: ` +
    `${resumo.email.destinatariosComFalha}`
  );

  console.log(
    `OS com envio de e-mail parcial: ` +
    `${resumo.email.parciais}`
  );

  console.log(
    `OS com falha de e-mail: ` +
    `${resumo.email.falhas}`
  );

  console.log(
    `OS sem e-mail: ` +
    `${resumo.email.semDestino}`
  );

  console.log(
    `E-mails desativados: ` +
    `${resumo.email.desativados}`
  );

  console.log(
    `E-mails bloqueados pela idempotência: ` +
    `${resumo.email.idempotenciaIgnorados}`
  );

  console.log(
    `Falhas do controle de e-mail: ` +
    `${resumo.email.idempotenciaFalhas}`
  );

  console.log(
    `OS com WhatsApp enviado: ` +
    `${resumo.whatsapp.enviados}`
  );

  console.log(
    `Destinatários de WhatsApp enviados: ` +
    `${resumo.whatsapp.destinatariosEnviados}`
  );

  console.log(
    `Destinatários de WhatsApp com falha: ` +
    `${resumo.whatsapp.destinatariosComFalha}`
  );

  console.log(
    `WhatsApps simulados: ` +
    `${resumo.whatsapp.simulados}`
  );

  console.log(
    `OS com falha no WhatsApp: ` +
    `${resumo.whatsapp.falhas}`
  );

  console.log(
    `WhatsApps ignorados: ` +
    `${resumo.whatsapp.ignorados}`
  );

  console.log(
    `WhatsApps desativados: ` +
    `${resumo.whatsapp.desativados}`
  );

  console.log(
    `WhatsApps bloqueados por falha/ausência de e-mail: ` +
    `${resumo.whatsapp.bloqueadosPorEmail}`
  );

  console.log(
    `WhatsApps bloqueados pela idempotência: ` +
    `${resumo.whatsapp.idempotenciaIgnorados}`
  );

  console.log(
    `Falhas do controle de WhatsApp: ` +
    `${resumo.whatsapp.idempotenciaFalhas}`
  );

  console.log(
    `Duração: ` +
    `${resumo.duracaoMs} ms`
  );

  console.log(
    '========================================'
  );

  console.log(
    `[${agoraFormatado()}] ` +
    `Processamento diário concluído.`
  );

  console.log('');

  return resumo;
}

// ============================================================
// FUNÇÃO PÚBLICA COM TRAVA
// ============================================================

async function executarEnvioDiario(
  opcoes = {}
) {
  if (execucaoEmAndamento) {
    console.warn(
      `[${agoraFormatado()}] ` +
      `Disparo recusado: já existe uma execução em andamento.`
    );

    return {
      ok:
        false,

      executado:
        false,

      motivo:
        'execucao-ja-em-andamento',
    };
  }

  execucaoEmAndamento =
    executarInternamente(opcoes);

  try {
    return await execucaoEmAndamento;
  } finally {
    execucaoEmAndamento = null;
  }
}

function existeExecucaoEmAndamento() {
  return Boolean(
    execucaoEmAndamento
  );
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  executarEnvioDiario,
  existeExecucaoEmAndamento,
  CONFIG,
};

// ============================================================
// EXECUÇÃO DIRETA PELO TERMINAL
// ============================================================

if (require.main === module) {
  const ignorarData =
    process.argv.includes(
      '--ignorar-data'
    );

  const confirmarProducao =
    process.argv.includes(
      '--confirmar-producao'
    );

  const emailReal =
    CONFIG.emailAtivo &&
    !MODO_TESTE;

  const whatsappReal =
    WHATSAPP_CONFIG.ativo &&
    !WHATSAPP_CONFIG.simular &&
    !WHATSAPP_CONFIG.modoTeste;

  if (
    (emailReal || whatsappReal) &&
    !confirmarProducao
  ) {
    console.error(
      'ENVIO REAL BLOQUEADO: execução direta pelo terminal exige ' +
      '--confirmar-producao. Use somente após revisar o ambiente.'
    );

    process.exitCode = 3;
  } else {
    executarEnvioDiario({
    ignorarData,
    origem:
      'terminal',
    })
      .then(resultado => {
        if (
          resultado?.executado === false
        ) {
          process.exitCode = 2;
        }
      })
      .catch(erro => {
        console.error(
          'ERRO FATAL NO PROCESSAMENTO:',
          erro?.message || erro
        );

        process.exitCode = 1;
      });
  }
}
