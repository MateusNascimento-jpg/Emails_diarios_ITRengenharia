'use strict';

// ============================================================
// idempotencia_airtable.js
// ============================================================
//
// Controle persistente de idempotência por Ordem de Serviço.
//
// Objetivos:
//
// - impedir o reenvio do mesmo conteúdo depois de reinício,
//   deploy ou nova execução manual;
// - permitir novo envio quando o conteúdo efetivamente mudar;
// - controlar e-mail e WhatsApp de forma independente;
// - falhar de forma fechada quando o controle persistente estiver
//   ativo e o Airtable não puder ser consultado ou atualizado;
// - nunca expor token, destinatário completo ou conteúdo sensível
//   nos resultados do módulo.
//
// A tabela utilizada é "Ordem de Serviço". O osId recebido pelo
// fluxo é o Record ID do registro vinculado no Airtable.
// ============================================================

require('dotenv').config({
  quiet: true,
});

const {
  createHash,
  randomUUID,
} = require('node:crypto');

// ============================================================
// CONFIGURAÇÃO
// ============================================================

function textoEnv(nome, padrao = '') {
  const valor = process.env[nome];

  if (
    valor === undefined ||
    valor === null ||
    valor === ''
  ) {
    return padrao;
  }

  return String(valor).trim();
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

function inteiroPositivo(valor, padrao) {
  const numero = Number.parseInt(
    String(valor ?? ''),
    10
  );

  return (
    Number.isInteger(numero) &&
    numero > 0
  )
    ? numero
    : padrao;
}

const DELIMITADOR_RESERVA =
  '::reserva::';

const ESTADOS = Object.freeze({
  reservado: 'reservado',
  enviado: 'enviado',
  falhou: 'falhou',
  incerto: 'incerto',
});

const CAMPOS = Object.freeze({
  email: Object.freeze({
    estado: textoEnv(
      'AIRTABLE_CAMPO_IDEMPOTENCIA_EMAIL_ESTADO',
      'Automação Email - Estado'
    ),

    hash: textoEnv(
      'AIRTABLE_CAMPO_IDEMPOTENCIA_EMAIL_HASH',
      'Automação Email - Hash'
    ),

    atualizadoEm: textoEnv(
      'AIRTABLE_CAMPO_IDEMPOTENCIA_EMAIL_ATUALIZADO_EM',
      'Automação Email - Atualizado Em'
    ),
  }),

  whatsapp: Object.freeze({
    estado: textoEnv(
      'AIRTABLE_CAMPO_IDEMPOTENCIA_WHATSAPP_ESTADO',
      'Automação WhatsApp - Estado'
    ),

    hash: textoEnv(
      'AIRTABLE_CAMPO_IDEMPOTENCIA_WHATSAPP_HASH',
      'Automação WhatsApp - Hash'
    ),

    atualizadoEm: textoEnv(
      'AIRTABLE_CAMPO_IDEMPOTENCIA_WHATSAPP_ATUALIZADO_EM',
      'Automação WhatsApp - Atualizado Em'
    ),
  }),
});

const CONFIG = Object.freeze({
  ativo: booleanoEnv(
    'IDEMPOTENCIA_ATIVA',
    false
  ),

  falharFechado: booleanoEnv(
    'IDEMPOTENCIA_FALHAR_FECHADO',
    true
  ),

  token: textoEnv(
    'AIRTABLE_TOKEN'
  ),

  baseId: textoEnv(
    'AIRTABLE_BASE_ID'
  ),

  tabelaOsId: textoEnv(
    'AIRTABLE_OS_TABLE_ID',
    'tblg3yHLdrpYVUNPv'
  ),

  timeoutMs: inteiroPositivo(
    process.env.AIRTABLE_TIMEOUT_MS,
    20000
  ),

  maxTentativas: inteiroPositivo(
    process.env.AIRTABLE_MAX_TENTATIVAS,
    3
  ),

  reservaTtlMs:
    inteiroPositivo(
      process.env
        .IDEMPOTENCIA_RESERVA_TTL_MINUTOS,
      30
    ) * 60 * 1000,

  campos: CAMPOS,
});

// ============================================================
// FUNÇÕES PURAS
// ============================================================

function canalNormalizado(canal) {
  const valor = String(
    canal ?? ''
  )
    .trim()
    .toLowerCase();

  if (
    valor !== 'email' &&
    valor !== 'whatsapp'
  ) {
    throw new Error(
      'Canal de idempotência inválido.'
    );
  }

  return valor;
}

function normalizarTexto(valor) {
  return String(
    valor ?? ''
  )
    .normalize('NFKC')
    .trim();
}

function normalizarDestino(valor) {
  const lista = Array.isArray(valor)
    ? valor.flat(Infinity)
    : [valor];

  return lista
    .map(item =>
      normalizarTexto(item)
        .toLowerCase()
    )
    .filter(Boolean)
    .sort((a, b) =>
      a.localeCompare(
        b,
        'pt-BR',
        {
          sensitivity: 'base',
          numeric: true,
        }
      )
    );
}

function normalizarEstrutura(valor) {
  if (
    valor === null ||
    valor === undefined
  ) {
    return null;
  }

  if (Array.isArray(valor)) {
    return valor.map(
      normalizarEstrutura
    );
  }

  if (
    typeof valor === 'object' &&
    !(valor instanceof Date)
  ) {
    const resultado = {};

    for (
      const chave
      of Object.keys(valor).sort()
    ) {
      resultado[chave] =
        normalizarEstrutura(
          valor[chave]
        );
    }

    return resultado;
  }

  if (valor instanceof Date) {
    return valor.toISOString();
  }

  if (typeof valor === 'string') {
    return valor
      .normalize('NFKC')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  return valor;
}

function serializarEstavel(valor) {
  return JSON.stringify(
    normalizarEstrutura(valor)
  );
}

function criarHashEnvio({
  canal,
  clienteId = '',
  osId = '',
  destino = '',
  conteudo = null,
} = {}) {
  const canalFinal =
    canalNormalizado(canal);

  const material = {
    versao:
      'itr-idempotencia-v1',

    canal:
      canalFinal,

    clienteId:
      normalizarTexto(clienteId),

    osId:
      normalizarTexto(osId),

    destino:
      normalizarDestino(destino),

    conteudo:
      normalizarEstrutura(conteudo),
  };

  return createHash('sha256')
    .update(
      serializarEstavel(material),
      'utf8'
    )
    .digest('hex');
}

function decomporHashArmazenado(valor) {
  const texto = normalizarTexto(valor);
  const indice = texto.indexOf(
    DELIMITADOR_RESERVA
  );

  if (indice < 0) {
    return {
      hashConteudo: texto,
      tokenReserva: '',
      reservado: false,
    };
  }

  return {
    hashConteudo:
      texto.slice(0, indice),

    tokenReserva:
      texto.slice(
        indice +
        DELIMITADOR_RESERVA.length
      ),

    reservado: true,
  };
}

function criarHashDeReserva(
  hashConteudo,
  tokenReserva
) {
  return (
    `${normalizarTexto(hashConteudo)}` +
    `${DELIMITADOR_RESERVA}` +
    `${normalizarTexto(tokenReserva)}`
  );
}

function dataValida(valor) {
  const data = new Date(
    String(valor ?? '')
  );

  return Number.isNaN(
    data.getTime()
  )
    ? null
    : data;
}

function reservaAindaValida(
  atualizadoEm,
  agora = new Date(),
  ttlMs = CONFIG.reservaTtlMs
) {
  const dataAtualizacao =
    dataValida(atualizadoEm);

  const dataAgora =
    agora instanceof Date
      ? agora
      : dataValida(agora);

  if (
    !dataAtualizacao ||
    !dataAgora
  ) {
    return false;
  }

  const idade =
    dataAgora.getTime() -
    dataAtualizacao.getTime();

  return (
    idade >= 0 &&
    idade < ttlMs
  );
}

function camposDoCanal(canal) {
  return CAMPOS[
    canalNormalizado(canal)
  ];
}

function lerControleDoRegistro(
  registro,
  canal
) {
  const nomes =
    camposDoCanal(canal);

  const fields =
    registro?.fields || {};

  const estado = normalizarTexto(
    fields[nomes.estado]
  ).toLowerCase();

  const hashBruto = normalizarTexto(
    fields[nomes.hash]
  );

  const atualizadoEm =
    normalizarTexto(
      fields[nomes.atualizadoEm]
    );

  return {
    estado,
    hashBruto,
    atualizadoEm,
    ...decomporHashArmazenado(
      hashBruto
    ),
  };
}

function avaliarControle({
  registro,
  canal,
  hash,
  agora = new Date(),
} = {}) {
  const controle =
    lerControleDoRegistro(
      registro,
      canal
    );

  if (
    !controle.hashConteudo ||
    controle.hashConteudo !== hash
  ) {
    return {
      permitirReserva: true,
      motivo:
        controle.hashConteudo
          ? 'conteudo-alterado'
          : 'sem-registro-anterior',
      controle,
    };
  }

  if (
    controle.estado ===
    ESTADOS.enviado
  ) {
    return {
      permitirReserva: false,
      bloqueado: true,
      confirmadoAnteriormente: true,
      motivo: 'envio-ja-registrado',
      controle,
    };
  }

  if (
    controle.estado ===
    ESTADOS.incerto
  ) {
    return {
      permitirReserva: false,
      bloqueado: true,
      confirmadoAnteriormente: false,
      motivo:
        'envio-com-resultado-incerto',
      controle,
    };
  }

  if (
    controle.estado ===
    ESTADOS.reservado
  ) {
    const ativa = reservaAindaValida(
      controle.atualizadoEm,
      agora
    );

    return {
      permitirReserva: false,
      bloqueado: true,
      confirmadoAnteriormente: false,
      motivo: ativa
        ? 'envio-ja-reservado'
        : 'reserva-expirada-resultado-incerto',
      reservaExpirada:
        !ativa,
      controle,
    };
  }

  // Falha confirmada pode ser tentada novamente com o mesmo
  // conteúdo. Estado ausente ou desconhecido também pode ser
  // substituído por uma nova reserva.
  return {
    permitirReserva: true,
    motivo:
      controle.estado ===
        ESTADOS.falhou
        ? 'falha-anterior-reprocessavel'
        : 'estado-anterior-ausente-ou-desconhecido',
    controle,
  };
}

// ============================================================
// COMUNICAÇÃO COM O AIRTABLE
// ============================================================

function validarConfiguracao() {
  if (!CONFIG.ativo) {
    return {
      ok: true,
      ativo: false,
      mensagem: '',
    };
  }

  const ausentes = [];

  if (!CONFIG.token) {
    ausentes.push(
      'AIRTABLE_TOKEN'
    );
  }

  if (!CONFIG.baseId) {
    ausentes.push(
      'AIRTABLE_BASE_ID'
    );
  }

  if (!CONFIG.tabelaOsId) {
    ausentes.push(
      'AIRTABLE_OS_TABLE_ID'
    );
  }

  for (
    const [canal, campos]
    of Object.entries(CAMPOS)
  ) {
    for (
      const [tipo, nome]
      of Object.entries(campos)
    ) {
      if (!nome) {
        ausentes.push(
          `${canal}.${tipo}`
        );
      }
    }
  }

  if (ausentes.length > 0) {
    return {
      ok: false,
      ativo: true,
      motivo:
        'configuracao-idempotencia-incompleta',
      mensagem:
        'Configuração de idempotência incompleta: ' +
        ausentes.join(', '),
    };
  }

  return {
    ok: true,
    ativo: true,
    mensagem: '',
  };
}

function erroTemporario(status) {
  return (
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

async function requisitarAirtable({
  metodo,
  url,
  corpo,
} = {}) {
  let ultimoErro = null;

  for (
    let tentativa = 1;
    tentativa <= CONFIG.maxTentativas;
    tentativa += 1
  ) {
    const controlador =
      new AbortController();

    const temporizador = setTimeout(
      () => controlador.abort(),
      CONFIG.timeoutMs
    );

    try {
      const resposta = await fetch(
        url,
        {
          method: metodo,
          headers: {
            Authorization:
              `Bearer ${CONFIG.token}`,
            'Content-Type':
              'application/json; charset=utf-8',
          },
          body:
            corpo === undefined
              ? undefined
              : JSON.stringify(corpo),
          signal:
            controlador.signal,
        }
      );

      const textoResposta =
        await resposta.text();

      let dados = {};

      if (textoResposta) {
        try {
          dados = JSON.parse(
            textoResposta
          );
        } catch {
          throw new Error(
            'O Airtable retornou uma resposta que não é JSON.'
          );
        }
      }

      if (resposta.ok) {
        return {
          ok: true,
          statusHttp:
            resposta.status,
          dados,
          tentativa,
        };
      }

      const mensagem =
        dados?.error?.message ||
        dados?.error?.type ||
        textoResposta ||
        `HTTP ${resposta.status}`;

      const erro = new Error(
        `Airtable respondeu HTTP ` +
        `${resposta.status}: ` +
        `${String(mensagem).slice(0, 1000)}`
      );

      erro.statusHttp =
        resposta.status;

      ultimoErro = erro;

      if (
        !erroTemporario(
          resposta.status
        ) ||
        tentativa ===
          CONFIG.maxTentativas
      ) {
        throw erro;
      }

      const retryAfter = Number(
        resposta.headers.get(
          'retry-after'
        )
      );

      const espera =
        Number.isFinite(retryAfter) &&
        retryAfter > 0
          ? retryAfter * 1000
          : 500 * tentativa;

      await new Promise(resolve => {
        setTimeout(resolve, espera);
      });
    } catch (erro) {
      ultimoErro =
        erro?.name === 'AbortError'
          ? Object.assign(
              new Error(
                'Tempo limite excedido ao acessar o Airtable.'
              ),
              {
                statusHttp: 408,
              }
            )
          : erro;

      const status = Number(
        ultimoErro?.statusHttp || 0
      );

      const podeRepetir =
        erro?.name === 'AbortError' ||
        !status ||
        erroTemporario(status);

      if (
        !podeRepetir ||
        tentativa ===
          CONFIG.maxTentativas
      ) {
        throw ultimoErro;
      }

      await new Promise(resolve => {
        setTimeout(
          resolve,
          500 * tentativa
        );
      });
    } finally {
      clearTimeout(
        temporizador
      );
    }
  }

  throw (
    ultimoErro ||
    new Error(
      'Falha desconhecida ao acessar o Airtable.'
    )
  );
}

function urlDoRegistro(osId) {
  const id = normalizarTexto(osId);

  if (!/^rec[a-zA-Z0-9]+$/.test(id)) {
    throw new Error(
      'O osId não é um Record ID válido do Airtable.'
    );
  }

  return (
    'https://api.airtable.com/v0/' +
    `${encodeURIComponent(CONFIG.baseId)}/` +
    `${encodeURIComponent(CONFIG.tabelaOsId)}/` +
    `${encodeURIComponent(id)}`
  );
}

async function buscarRegistroOs(osId) {
  const resposta =
    await requisitarAirtable({
      metodo: 'GET',
      url: urlDoRegistro(osId),
    });

  return resposta.dados;
}

async function atualizarRegistroOs(
  osId,
  fields
) {
  const resposta =
    await requisitarAirtable({
      metodo: 'PATCH',
      url: urlDoRegistro(osId),
      corpo: {
        fields,
        typecast: true,
      },
    });

  return resposta.dados;
}

function camposParaEstado({
  canal,
  estado,
  hash,
  atualizadoEm,
}) {
  const nomes =
    camposDoCanal(canal);

  return {
    [nomes.estado]: estado,
    [nomes.hash]: hash,
    [nomes.atualizadoEm]:
      atualizadoEm,
  };
}

function resultadoDeFalha(
  erro,
  etapa
) {
  const mensagem =
    erro?.message ||
    String(erro);

  if (CONFIG.falharFechado) {
    return {
      ok: false,
      reservado: false,
      bloqueado: true,
      ignorado: true,
      bypass: false,
      motivo:
        'falha-controle-idempotencia',
      etapa,
      mensagem,
    };
  }

  return {
    ok: true,
    reservado: false,
    bloqueado: false,
    ignorado: false,
    bypass: true,
    motivo:
      'idempotencia-indisponivel-bypass',
    etapa,
    mensagem,
  };
}

// ============================================================
// RESERVA E FINALIZAÇÃO
// ============================================================

async function reservarEnvio({
  canal,
  osId,
  hash,
  agora = new Date(),
} = {}) {
  const configuracao =
    validarConfiguracao();

  if (!configuracao.ok) {
    return resultadoDeFalha(
      new Error(
        configuracao.mensagem
      ),
      'configuracao'
    );
  }

  if (!CONFIG.ativo) {
    return {
      ok: true,
      reservado: false,
      bloqueado: false,
      ignorado: false,
      bypass: true,
      motivo:
        'idempotencia-desativada',
    };
  }

  const canalFinal =
    canalNormalizado(canal);

  const hashFinal =
    normalizarTexto(hash);

  if (!/^[a-f0-9]{64}$/.test(hashFinal)) {
    return resultadoDeFalha(
      new Error(
        'Hash de idempotência inválido.'
      ),
      'validacao-hash'
    );
  }

  const dataAgora =
    agora instanceof Date
      ? agora
      : dataValida(agora);

  if (!dataAgora) {
    return resultadoDeFalha(
      new Error(
        'Data da reserva inválida.'
      ),
      'validacao-data'
    );
  }

  try {
    const registro =
      await buscarRegistroOs(osId);

    const avaliacao =
      avaliarControle({
        registro,
        canal: canalFinal,
        hash: hashFinal,
        agora: dataAgora,
      });

    if (!avaliacao.permitirReserva) {
      if (
        avaliacao.reservaExpirada
      ) {
        await atualizarRegistroOs(
          osId,
          camposParaEstado({
            canal: canalFinal,
            estado:
              ESTADOS.incerto,
            hash:
              hashFinal,
            atualizadoEm:
              dataAgora.toISOString(),
          })
        );
      }

      return {
        ok: true,
        reservado: false,
        bloqueado: true,
        ignorado: true,
        bypass: false,
        confirmadoAnteriormente:
          avaliacao
            .confirmadoAnteriormente ===
          true,
        motivo:
          avaliacao.motivo,
      };
    }

    const tokenReserva =
      randomUUID();

    const hashReserva =
      criarHashDeReserva(
        hashFinal,
        tokenReserva
      );

    await atualizarRegistroOs(
      osId,
      camposParaEstado({
        canal: canalFinal,
        estado:
          ESTADOS.reservado,
        hash:
          hashReserva,
        atualizadoEm:
          dataAgora.toISOString(),
      })
    );

    // Verificação otimista: impede que uma reserva sobrescreva
    // silenciosamente outra reserva feita quase ao mesmo tempo.
    const confirmacao =
      await buscarRegistroOs(osId);

    const controleConfirmado =
      lerControleDoRegistro(
        confirmacao,
        canalFinal
      );

    if (
      controleConfirmado.estado !==
        ESTADOS.reservado ||
      controleConfirmado.hashBruto !==
        hashReserva
    ) {
      return {
        ok: false,
        reservado: false,
        bloqueado: true,
        ignorado: true,
        bypass: false,
        motivo:
          'reserva-concorrente',
        mensagem:
          'Outra execução alterou a reserva antes da confirmação.',
      };
    }

    return {
      ok: true,
      reservado: true,
      bloqueado: false,
      ignorado: false,
      bypass: false,
      motivo: '',
      reserva: Object.freeze({
        canal:
          canalFinal,
        osId:
          normalizarTexto(osId),
        hash:
          hashFinal,
        hashReserva,
        tokenReserva,
        reservadoEm:
          dataAgora.toISOString(),
      }),
    };
  } catch (erro) {
    return resultadoDeFalha(
      erro,
      'reserva'
    );
  }
}

async function finalizarReserva({
  reserva,
  estado,
  agora = new Date(),
} = {}) {
  if (!reserva) {
    return {
      ok: true,
      atualizado: false,
      bypass: true,
      motivo:
        'reserva-ausente',
    };
  }

  const estadoFinal =
    normalizarTexto(estado)
      .toLowerCase();

  if (
    ![
      ESTADOS.enviado,
      ESTADOS.falhou,
      ESTADOS.incerto,
    ].includes(estadoFinal)
  ) {
    return {
      ok: false,
      atualizado: false,
      bypass: false,
      motivo:
        'estado-final-invalido',
      mensagem:
        'Estado final de idempotência inválido.',
    };
  }

  if (!CONFIG.ativo) {
    return {
      ok: true,
      atualizado: false,
      bypass: true,
      motivo:
        'idempotencia-desativada',
    };
  }

  const dataAgora =
    agora instanceof Date
      ? agora
      : dataValida(agora);

  if (!dataAgora) {
    return {
      ok: false,
      atualizado: false,
      bypass: false,
      motivo:
        'data-finalizacao-invalida',
    };
  }

  try {
    const atual =
      await buscarRegistroOs(
        reserva.osId
      );

    const controle =
      lerControleDoRegistro(
        atual,
        reserva.canal
      );

    if (
      controle.estado !==
        ESTADOS.reservado ||
      controle.hashBruto !==
        reserva.hashReserva
    ) {
      return {
        ok: false,
        atualizado: false,
        bypass: false,
        motivo:
          'reserva-nao-pertence-a-execucao',
        mensagem:
          'A reserva foi alterada antes da finalização.',
      };
    }

    await atualizarRegistroOs(
      reserva.osId,
      camposParaEstado({
        canal:
          reserva.canal,
        estado:
          estadoFinal,
        hash:
          reserva.hash,
        atualizadoEm:
          dataAgora.toISOString(),
      })
    );

    return {
      ok: true,
      atualizado: true,
      bypass: false,
      motivo: '',
      estado:
        estadoFinal,
    };
  } catch (erro) {
    const falha = resultadoDeFalha(
      erro,
      'finalizacao'
    );

    return {
      ...falha,
      atualizado: false,
    };
  }
}

function marcarComoEnviado(
  reserva,
  opcoes = {}
) {
  return finalizarReserva({
    reserva,
    estado:
      ESTADOS.enviado,
    ...opcoes,
  });
}

function marcarComoFalhou(
  reserva,
  opcoes = {}
) {
  return finalizarReserva({
    reserva,
    estado:
      ESTADOS.falhou,
    ...opcoes,
  });
}

function marcarComoIncerto(
  reserva,
  opcoes = {}
) {
  return finalizarReserva({
    reserva,
    estado:
      ESTADOS.incerto,
    ...opcoes,
  });
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  criarHashEnvio,
  decomporHashArmazenado,
  criarHashDeReserva,
  reservaAindaValida,
  lerControleDoRegistro,
  avaliarControle,

  validarConfiguracao,
  buscarRegistroOs,
  atualizarRegistroOs,
  reservarEnvio,
  finalizarReserva,
  marcarComoEnviado,
  marcarComoFalhou,
  marcarComoIncerto,

  ESTADOS,
  CAMPOS,
  CONFIG,
};
