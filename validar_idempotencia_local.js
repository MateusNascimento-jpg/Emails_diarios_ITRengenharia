'use strict';

// ============================================================
// validar_idempotencia_local.js
// ============================================================
//
// Testes locais e isolados do controle persistente.
//
// Este arquivo:
//
// - NÃO consulta o Airtable real;
// - NÃO envia e-mail;
// - NÃO chama a Meta;
// - NÃO utiliza dados reais;
// - NÃO altera o .env;
// - usa um fetch totalmente simulado em memória.
// ============================================================

process.env.IDEMPOTENCIA_ATIVA =
  'true';

process.env.IDEMPOTENCIA_FALHAR_FECHADO =
  'true';

process.env.IDEMPOTENCIA_RESERVA_TTL_MINUTOS =
  '30';

process.env.AIRTABLE_TOKEN =
  'TOKEN_LOCAL_NAO_USADO';

process.env.AIRTABLE_BASE_ID =
  'appBaseTeste';

process.env.AIRTABLE_OS_TABLE_ID =
  'tblOrdemServicoTeste';

process.env.AIRTABLE_TIMEOUT_MS =
  '2000';

process.env.AIRTABLE_MAX_TENTATIVAS =
  '1';

const assert =
  require('node:assert/strict');

const registros =
  new Map();

let falharFetch = false;
let quantidadeGet = 0;
let quantidadePatch = 0;

function respostaJson(
  dados,
  status = 200
) {
  return new Response(
    JSON.stringify(dados),
    {
      status,
      headers: {
        'Content-Type':
          'application/json',
      },
    }
  );
}

function idDaUrl(url) {
  const partes = new URL(url)
    .pathname
    .split('/')
    .filter(Boolean);

  return decodeURIComponent(
    partes.at(-1) || ''
  );
}

global.fetch = async (
  url,
  opcoes = {}
) => {
  if (falharFetch) {
    throw new Error(
      'Falha simulada de rede.'
    );
  }

  const metodo = String(
    opcoes.method || 'GET'
  ).toUpperCase();

  const id = idDaUrl(url);

  if (!registros.has(id)) {
    return respostaJson(
      {
        error: {
          type:
            'NOT_FOUND',
          message:
            'Registro não encontrado.',
        },
      },
      404
    );
  }

  if (metodo === 'GET') {
    quantidadeGet += 1;

    return respostaJson(
      registros.get(id)
    );
  }

  if (metodo === 'PATCH') {
    quantidadePatch += 1;

    const corpo = JSON.parse(
      String(opcoes.body || '{}')
    );

    const atual =
      registros.get(id);

    const atualizado = {
      ...atual,
      fields: {
        ...(atual.fields || {}),
        ...(corpo.fields || {}),
      },
    };

    registros.set(
      id,
      atualizado
    );

    return respostaJson(
      atualizado
    );
  }

  return respostaJson(
    {
      error: {
        type:
          'METHOD_NOT_ALLOWED',
      },
    },
    405
  );
};

const {
  criarHashEnvio,
  criarHashDeReserva,
  decomporHashArmazenado,
  reservaAindaValida,
  lerControleDoRegistro,
  avaliarControle,
  reservarEnvio,
  finalizarReserva,
  marcarComoEnviado,
  marcarComoFalhou,
  marcarComoIncerto,
  ESTADOS,
  CAMPOS,
  CONFIG,
} = require('./idempotencia_airtable.js');

function limpar() {
  registros.clear();

  registros.set(
    'recOSA',
    {
      id:
        'recOSA',
      fields:
        {},
    }
  );

  falharFetch = false;
  quantidadeGet = 0;
  quantidadePatch = 0;
}

function hashTeste(
  alteracoes = {}
) {
  return criarHashEnvio({
    canal:
      'email',
    clienteId:
      'recClienteA',
    osId:
      'recOSA',
    destino: [
      'cliente@example.com',
    ],
    conteudo: {
      assunto:
        'Atualização OS A',
      texto:
        'Conteúdo A',
      ...alteracoes,
    },
  });
}

function definirControle({
  canal = 'email',
  estado,
  hash,
  atualizadoEm,
}) {
  const nomes =
    CAMPOS[canal];

  registros.set(
    'recOSA',
    {
      id:
        'recOSA',
      fields: {
        [nomes.estado]:
          estado,
        [nomes.hash]:
          hash,
        [nomes.atualizadoEm]:
          atualizadoEm,
      },
    }
  );
}

async function validarHashDeterministico() {
  limpar();

  const primeiro =
    criarHashEnvio({
      canal:
        'email',
      clienteId:
        'recClienteA',
      osId:
        'recOSA',
      destino: [
        'B@example.com',
        'a@example.com',
      ],
      conteudo: {
        z:
          'fim',
        a:
          'início',
      },
    });

  const segundo =
    criarHashEnvio({
      conteudo: {
        a:
          'início',
        z:
          'fim',
      },
      destino: [
        'a@example.com',
        'b@example.com',
      ],
      osId:
        'recOSA',
      clienteId:
        'recClienteA',
      canal:
        'email',
    });

  assert.equal(
    primeiro,
    segundo
  );

  assert.match(
    primeiro,
    /^[a-f0-9]{64}$/
  );
}

async function validarHashMudaComConteudo() {
  limpar();

  assert.notEqual(
    hashTeste(),
    hashTeste({
      texto:
        'Conteúdo B',
    })
  );
}

async function validarComposicaoDaReserva() {
  limpar();

  const hash = hashTeste();
  const armazenado =
    criarHashDeReserva(
      hash,
      'token-teste'
    );

  const resultado =
    decomporHashArmazenado(
      armazenado
    );

  assert.equal(
    resultado.hashConteudo,
    hash
  );

  assert.equal(
    resultado.tokenReserva,
    'token-teste'
  );

  assert.equal(
    resultado.reservado,
    true
  );
}

async function validarTtlDaReserva() {
  limpar();

  const agora = new Date(
    '2026-08-02T12:00:00.000Z'
  );

  assert.equal(
    reservaAindaValida(
      '2026-08-02T11:45:00.000Z',
      agora
    ),
    true
  );

  assert.equal(
    reservaAindaValida(
      '2026-08-02T11:00:00.000Z',
      agora
    ),
    false
  );
}

async function validarReservaNova() {
  limpar();

  const resultado =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash:
        hashTeste(),
      agora:
        new Date(
          '2026-08-02T12:00:00.000Z'
        ),
    });

  assert.equal(
    resultado.ok,
    true
  );

  assert.equal(
    resultado.reservado,
    true
  );

  assert.equal(
    quantidadePatch,
    1
  );

  assert.equal(
    quantidadeGet,
    2
  );

  const controle =
    lerControleDoRegistro(
      registros.get('recOSA'),
      'email'
    );

  assert.equal(
    controle.estado,
    ESTADOS.reservado
  );

  assert.equal(
    controle.hashConteudo,
    resultado.reserva.hash
  );

  assert.ok(
    controle.tokenReserva
  );
}

async function validarFinalizacaoComoEnviado() {
  limpar();

  const reserva =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash:
        hashTeste(),
    });

  const final =
    await marcarComoEnviado(
      reserva.reserva
    );

  assert.equal(
    final.ok,
    true
  );

  const controle =
    lerControleDoRegistro(
      registros.get('recOSA'),
      'email'
    );

  assert.equal(
    controle.estado,
    ESTADOS.enviado
  );

  assert.equal(
    controle.hashBruto,
    reserva.reserva.hash
  );

  assert.equal(
    controle.reservado,
    false
  );
}

async function validarBloqueioDeEnviado() {
  limpar();

  const hash = hashTeste();

  definirControle({
    estado:
      ESTADOS.enviado,
    hash,
    atualizadoEm:
      '2026-08-02T12:00:00.000Z',
  });

  const resultado =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash,
    });

  assert.equal(
    resultado.reservado,
    false
  );

  assert.equal(
    resultado.bloqueado,
    true
  );

  assert.equal(
    resultado.confirmadoAnteriormente,
    true
  );

  assert.equal(
    resultado.motivo,
    'envio-ja-registrado'
  );
}

async function validarConteudoNovoPodeReservar() {
  limpar();

  definirControle({
    estado:
      ESTADOS.enviado,
    hash:
      hashTeste(),
    atualizadoEm:
      '2026-08-02T12:00:00.000Z',
  });

  const novoHash =
    hashTeste({
      texto:
        'Conteúdo atualizado',
    });

  const resultado =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash:
        novoHash,
    });

  assert.equal(
    resultado.reservado,
    true
  );

  assert.equal(
    resultado.reserva.hash,
    novoHash
  );
}

async function validarReservaAtivaBloqueia() {
  limpar();

  const hash = hashTeste();

  definirControle({
    estado:
      ESTADOS.reservado,
    hash:
      criarHashDeReserva(
        hash,
        'outra-execucao'
      ),
    atualizadoEm:
      '2026-08-02T11:50:00.000Z',
  });

  const resultado =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash,
      agora:
        new Date(
          '2026-08-02T12:00:00.000Z'
        ),
    });

  assert.equal(
    resultado.bloqueado,
    true
  );

  assert.equal(
    resultado.motivo,
    'envio-ja-reservado'
  );
}

async function validarReservaExpiradaViraIncerta() {
  limpar();

  const hash = hashTeste();

  definirControle({
    estado:
      ESTADOS.reservado,
    hash:
      criarHashDeReserva(
        hash,
        'execucao-antiga'
      ),
    atualizadoEm:
      '2026-08-02T10:00:00.000Z',
  });

  const resultado =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash,
      agora:
        new Date(
          '2026-08-02T12:00:00.000Z'
        ),
    });

  assert.equal(
    resultado.bloqueado,
    true
  );

  assert.equal(
    resultado.motivo,
    'reserva-expirada-resultado-incerto'
  );

  const controle =
    lerControleDoRegistro(
      registros.get('recOSA'),
      'email'
    );

  assert.equal(
    controle.estado,
    ESTADOS.incerto
  );

  assert.equal(
    controle.hashBruto,
    hash
  );
}

async function validarIncertoBloqueia() {
  limpar();

  const hash = hashTeste();

  definirControle({
    estado:
      ESTADOS.incerto,
    hash,
    atualizadoEm:
      '2026-08-02T12:00:00.000Z',
  });

  const resultado =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash,
    });

  assert.equal(
    resultado.bloqueado,
    true
  );

  assert.equal(
    resultado.motivo,
    'envio-com-resultado-incerto'
  );
}

async function validarFalhaPermiteNovaTentativa() {
  limpar();

  const hash = hashTeste();

  definirControle({
    estado:
      ESTADOS.falhou,
    hash,
    atualizadoEm:
      '2026-08-02T12:00:00.000Z',
  });

  const resultado =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash,
    });

  assert.equal(
    resultado.reservado,
    true
  );
}

async function validarFinalizacoesDeFalhaEIncerteza() {
  limpar();

  const primeira =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash:
        hashTeste(),
    });

  const falhou =
    await marcarComoFalhou(
      primeira.reserva
    );

  assert.equal(
    falhou.ok,
    true
  );

  assert.equal(
    lerControleDoRegistro(
      registros.get('recOSA'),
      'email'
    ).estado,
    ESTADOS.falhou
  );

  const segunda =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash:
        hashTeste(),
    });

  const incerto =
    await marcarComoIncerto(
      segunda.reserva
    );

  assert.equal(
    incerto.ok,
    true
  );

  assert.equal(
    lerControleDoRegistro(
      registros.get('recOSA'),
      'email'
    ).estado,
    ESTADOS.incerto
  );
}

async function validarReservaAlheiaNaoEhFinalizada() {
  limpar();

  const resultado =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash:
        hashTeste(),
    });

  definirControle({
    estado:
      ESTADOS.reservado,
    hash:
      criarHashDeReserva(
        resultado.reserva.hash,
        'token-substituto'
      ),
    atualizadoEm:
      new Date().toISOString(),
  });

  const final =
    await finalizarReserva({
      reserva:
        resultado.reserva,
      estado:
        ESTADOS.enviado,
    });

  assert.equal(
    final.ok,
    false
  );

  assert.equal(
    final.motivo,
    'reserva-nao-pertence-a-execucao'
  );

  assert.equal(
    lerControleDoRegistro(
      registros.get('recOSA'),
      'email'
    ).estado,
    ESTADOS.reservado
  );
}

async function validarCanaisIndependentes() {
  limpar();

  const hashEmail =
    criarHashEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      conteudo:
        'email',
    });

  const hashWhatsapp =
    criarHashEnvio({
      canal:
        'whatsapp',
      osId:
        'recOSA',
      conteudo:
        'whatsapp',
    });

  const email =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash:
        hashEmail,
    });

  await marcarComoEnviado(
    email.reserva
  );

  const whatsapp =
    await reservarEnvio({
      canal:
        'whatsapp',
      osId:
        'recOSA',
      hash:
        hashWhatsapp,
    });

  assert.equal(
    whatsapp.reservado,
    true
  );

  assert.equal(
    lerControleDoRegistro(
      registros.get('recOSA'),
      'email'
    ).estado,
    ESTADOS.enviado
  );

  assert.equal(
    lerControleDoRegistro(
      registros.get('recOSA'),
      'whatsapp'
    ).estado,
    ESTADOS.reservado
  );
}

async function validarFalhaFechada() {
  limpar();
  falharFetch = true;

  const resultado =
    await reservarEnvio({
      canal:
        'email',
      osId:
        'recOSA',
      hash:
        hashTeste(),
    });

  assert.equal(
    resultado.ok,
    false
  );

  assert.equal(
    resultado.bloqueado,
    true
  );

  assert.equal(
    resultado.motivo,
    'falha-controle-idempotencia'
  );
}

async function executar() {
  const testes = [
    validarHashDeterministico,
    validarHashMudaComConteudo,
    validarComposicaoDaReserva,
    validarTtlDaReserva,
    validarReservaNova,
    validarFinalizacaoComoEnviado,
    validarBloqueioDeEnviado,
    validarConteudoNovoPodeReservar,
    validarReservaAtivaBloqueia,
    validarReservaExpiradaViraIncerta,
    validarIncertoBloqueia,
    validarFalhaPermiteNovaTentativa,
    validarFinalizacoesDeFalhaEIncerteza,
    validarReservaAlheiaNaoEhFinalizada,
    validarCanaisIndependentes,
    validarFalhaFechada,
  ];

  for (const teste of testes) {
    await teste();
  }

  assert.equal(
    CONFIG.ativo,
    true
  );

  assert.equal(
    CONFIG.falharFechado,
    true
  );

  console.log(
    'VALIDAÇÃO IDEMPOTÊNCIA: OK'
  );

  console.log(
    `TESTES EXECUTADOS: ${testes.length}`
  );

  console.log(
    'CONSULTA AO AIRTABLE REAL: NÃO'
  );

  console.log(
    'ESCRITA NO AIRTABLE REAL: NÃO'
  );

  console.log(
    'ENVIO DE E-MAIL: NÃO'
  );

  console.log(
    'CHAMADA À META: NÃO'
  );

  console.log(
    'FALHA DE CONTROLE: BLOQUEIA O ENVIO'
  );

  console.log(
    'RESERVA EXPIRADA: CONVERTIDA EM INCERTO'
  );
}

executar().catch(erro => {
  console.error(
    'VALIDAÇÃO IDEMPOTÊNCIA: FALHOU'
  );

  console.error(
    erro?.stack ||
    erro
  );

  process.exitCode = 1;
});
