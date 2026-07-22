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
// 4. Gera um e-mail para cada OS.
// 5. Após o e-mail, gera uma mensagem de WhatsApp para a OS.
// 6. Todas as amostras, ensaios e status da mesma OS são
//    incluídos em uma única mensagem de WhatsApp.
// 7. Uma falha em um canal não encerra toda a execução.
// 8. Duas execuções simultâneas no mesmo processo são impedidas.
//
// Regra definitiva:
//
// UMA ORDEM DE SERVIÇO = UM E-MAIL
// UMA ORDEM DE SERVIÇO = UMA MENSAGEM DE WHATSAPP
//
// Os dados utilizados nos dois canais vêm do Airtable.
// ============================================================

require('dotenv').config();

const {
  buscarResumoDiario,
} = require('./airtable.js');

const {
  montarEmailDaOS,
} = require('./email_template.js');

const {
  enviar,
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
  // Permite desativar o canal de e-mail sem apagar código.
  emailAtivo: booleanoEnv(
    'EMAIL_ATIVO',
    true
  ),

  // Quando true, o WhatsApp somente será processado se o
  // e-mail da respectiva OS tiver sido enviado com sucesso.
  //
  // Isso preserva a veracidade da frase:
  // "A atualização também foi enviada por e-mail."
  whatsappExigirEmailEnviado: booleanoEnv(
    'WHATSAPP_EXIGIR_EMAIL_ENVIADO',
    true
  ),

  // Intervalo depois de uma tentativa real de e-mail.
  emailPausaMs: numeroInteiroNaoNegativo(
    process.env.EMAIL_PAUSA_MS,
    1500
  ),

  // Intervalo depois de um envio ou simulação do WhatsApp.
  whatsappPausaMs: numeroInteiroNaoNegativo(
    process.env.WHATSAPP_PAUSA_MS,
    1200
  ),

  // Intervalo adicional entre duas Ordens de Serviço.
  pausaEntreOsMs: numeroInteiroNaoNegativo(
    process.env.PAUSA_ENTRE_OS_MS,
    0
  ),
});

// ============================================================
// TRAVA DE EXECUÇÃO
// ============================================================
//
// Impede que o cron e o disparo manual processem os mesmos
// dados simultaneamente dentro da mesma instância Node.js.
//
// Exemplo protegido:
//
// 08:00:00 → cron inicia
// 08:00:10 → alguém aciona /disparar-agora
//
// A segunda execução será recusada enquanto a primeira estiver
// ativa.
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

function falhaWhatsappEhIncerta(resultado) {
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
    enviado: false,
    simulado: false,
    ignorado: true,
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
      falhas: 0,
      semDestino: 0,
      desativados: 0,
      idempotenciaIgnorados: 0,
      idempotenciaFalhas: 0,
    },

    whatsapp: {
      enviados: 0,
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

  // Em modo de teste, o endereço real pode estar ausente,
  // pois o enviar_email.js redirecionará para EMAIL_MODO_TESTE.
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
    const conteudo =
      montarEmailDaOS(
        cliente,
        ordem
      );

    if (
      !conteudo ||
      !conteudo.assunto ||
      !conteudo.html ||
      !conteudo.texto
    ) {
      throw new Error(
        'O template de e-mail retornou ' +
        'conteúdo incompleto.'
      );
    }

    const destino =
      destinoEmailDoCliente(
        cliente
      );

    if (idempotenciaAplicavelAoEmail()) {
      const hash = criarHashEnvio({
        canal: 'email',
        clienteId:
          cliente?.clienteId || '',
        osId:
          ordem?.osId || '',
        destino,
        conteudo: {
          assunto:
            conteudo.assunto,
          texto:
            conteudo.texto,
          html:
            conteudo.html,
        },
      });

      const controle =
        await reservarEnvio({
          canal: 'email',
          osId:
            ordem?.osId || '',
          hash,
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

    const resultado =
      await enviar({
        para:
          destino,

        assunto:
          conteudo.assunto,

        html:
          conteudo.html,

        texto:
          conteudo.texto,
      });

    if (!resultado?.ok) {
      await finalizarIdempotencia({
        reserva,
        estado: 'incerto',
        canal: 'email',
        clienteNome,
        osNome,
        resumo,
      });

      resumo.email.falhas += 1;

      console.error(
        `  [E-MAIL FALHA] ` +
        `${clienteNome} / ${osNome}: ` +
        `${resultado?.motivo || 'falha desconhecida'}`
      );

      return {
        ok: false,
        enviado: false,
        ignorado: false,
        motivo:
          resultado?.motivo ||
          'falha-email',
      };
    }

    const idempotencia =
      await finalizarIdempotencia({
        reserva,
        estado: 'enviado',
        canal: 'email',
        clienteNome,
        osNome,
        resumo,
      });

    resumo.email.enviados += 1;

    const destinoLog =
      Array.isArray(
        resultado.destino
      )
        ? resultado.destino.join(', ')
        : resultado.destino;

    console.log(
      `  [E-MAIL OK] ` +
      `${clienteNome} / ${osNome}` +
      `${destinoLog ? ` → ${destinoLog}` : ''}`
    );

    return {
      ok: true,
      enviado: true,
      ignorado: false,
      motivo: '',
      id:
        resultado.id || '',
      destino:
        resultado.destino,
      idempotenciaPersistida:
        idempotencia?.ok !== false,
    };
  } catch (erro) {
    await finalizarIdempotencia({
      reserva,
      estado: 'incerto',
      canal: 'email',
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
      ok: false,
      enviado: false,
      ignorado: false,
      motivo: 'erro-email',
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
    resumo.whatsapp.bloqueadosPorEmail += 1;

    console.warn(
      `  [WHATSAPP PULADO] ` +
      `${clienteNome} / ${osNome}: ` +
      `o e-mail da OS não foi confirmado.`
    );

    return {
      ok: true,
      enviado: false,
      simulado: false,
      ignorado: true,
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
        const hash = criarHashEnvio({
          canal: 'whatsapp',
          clienteId:
            cliente?.clienteId || '',
          osId:
            ordem?.osId || '',
          destino:
            preparado.payload?.to || '',
          conteudo:
            preparado.payload,
        });

        const controle =
          await reservarEnvio({
            canal: 'whatsapp',
            osId:
              ordem?.osId || '',
            hash,
          });

        if (
          controle?.bloqueado === true ||
          controle?.ok === false
        ) {
          const bloqueado =
            resultadoBloqueadoPorIdempotencia({
              controle,
              canal: 'whatsapp',
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

    if (resultado?.enviado === true) {
      resultado.idempotenciaPersistida =
        (
          await finalizarIdempotencia({
            reserva,
            estado: 'enviado',
            canal: 'whatsapp',
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
        canal: 'whatsapp',
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
      estado: 'incerto',
      canal: 'whatsapp',
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
      ok: false,
      enviado: false,
      simulado: false,
      ignorado: false,
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

      const emailResultado =
        await processarEmailDaOS({
          cliente,
          ordem,
          resumo,
        });

      if (
        CONFIG.emailAtivo &&
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
      // Portanto:
      // uma OS = uma única chamada ao enviarWhatsAppDaOS().
      // ------------------------------------------------------

      const whatsappResultado =
        await processarWhatsAppDaOS({
          cliente,
          ordem,
          emailResultado,
          resumo,
        });

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
  console.log('================ RESUMO ================');

  console.log(
    `Clientes: ${resumo.clientesEncontrados}`
  );

  console.log(
    `Ordens encontradas: ${resumo.ordensEncontradas}`
  );

  console.log(
    `Ordens processadas: ${resumo.ordensProcessadas}`
  );

  console.log(
    `Ordens sem linhas: ${resumo.ordensSemLinhas}`
  );

  console.log(
    `E-mails enviados: ${resumo.email.enviados}`
  );

  console.log(
    `E-mails com falha: ${resumo.email.falhas}`
  );

  console.log(
    `OS sem e-mail: ${resumo.email.semDestino}`
  );

  console.log(
    `E-mails desativados: ${resumo.email.desativados}`
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
    `WhatsApps enviados: ${resumo.whatsapp.enviados}`
  );

  console.log(
    `WhatsApps simulados: ${resumo.whatsapp.simulados}`
  );

  console.log(
    `WhatsApps com falha: ${resumo.whatsapp.falhas}`
  );

  console.log(
    `WhatsApps ignorados: ${resumo.whatsapp.ignorados}`
  );

  console.log(
    `WhatsApps desativados: ${resumo.whatsapp.desativados}`
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
    `Duração: ${resumo.duracaoMs} ms`
  );

  console.log('========================================');

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
      ok: false,
      executado: false,
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
//
// Normal:
// node enviar_todos.js
//
// Ignorando a data:
// node enviar_todos.js --ignorar-data
// ============================================================

if (require.main === module) {
  const ignorarData =
    process.argv.includes(
      '--ignorar-data'
    );

  executarEnvioDiario({
    ignorarData,
    origem: 'terminal',
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