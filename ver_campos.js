'use strict';

// ============================================================
// ver_campos.js — INSPEÇÃO SEGURA DOS CAMPOS DO AIRTABLE
// ============================================================
//
// Objetivos:
//
// 1. Consultar os registros reais do Airtable.
// 2. Identificar todos os nomes de campos retornados.
// 3. Verificar os campos exigidos pelo projeto.
// 4. Detectar nomes com espaços no começo ou no final.
// 5. Confirmar se o campo de WhatsApp existe.
// 6. Não exibir tokens, senhas ou dados completos dos clientes.
// 7. Não enviar e-mail.
// 8. Não realizar chamadas para a Meta.
//
// Comando:
//
// npm run inspecionar
//
// Saída JSON:
//
// node ver_campos.js --json
//
// Exibir uma amostra sanitizada dos tipos:
//
// node ver_campos.js --amostra
// ============================================================

require('dotenv').config({
  quiet: true,
});

const {
  buscarRegistrosDaView,
  CAMPOS,
  STATUS_PERMITIDOS,
  TIMEZONE,
} = require('./airtable.js');

// ============================================================
// ARGUMENTOS DO TERMINAL
// ============================================================

const ARGUMENTOS = new Set(
  process.argv.slice(2)
);

const SAIDA_JSON =
  ARGUMENTOS.has('--json');

const MOSTRAR_AMOSTRA =
  ARGUMENTOS.has('--amostra');

// ============================================================
// CAMPOS ESPERADOS
// ============================================================

const CAMPOS_OBRIGATORIOS = Object.freeze([
  {
    chave: 'clienteLink',
    finalidade: 'Vínculo do cliente',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
  {
    chave: 'osLink',
    finalidade: 'Vínculo da Ordem de Serviço',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
  {
    chave: 'clienteTexto',
    finalidade: 'Nome do cliente',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
  {
    chave: 'osTexto',
    finalidade: 'Número ou nome da OS',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
  {
    chave: 'emailCliente',
    finalidade: 'Destinatário do e-mail',
    obrigatorioPara: 'e-mail',
  },
  {
    chave: 'cnpjCliente',
    finalidade: 'Usuário do Portal do Cliente',
    obrigatorioPara: 'e-mail',
  },
  {
    chave: 'whatsappCliente',
    finalidade: 'Número do WhatsApp do cliente',
    obrigatorioPara: 'WhatsApp',
  },
  {
    chave: 'idTrabalho',
    finalidade: 'Identificação e deduplicação do trabalho',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
  {
    chave: 'nomeTrabalho',
    finalidade: 'Nome do trabalho',
    obrigatorioPara: 'diagnóstico',
  },
  {
    chave: 'amostra',
    finalidade: 'Identificação da amostra',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
  {
    chave: 'ensaioSigla',
    finalidade: 'Sigla do ensaio',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
  {
    chave: 'ensaioNome',
    finalidade: 'Nome completo do ensaio',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
  {
    chave: 'statusCliente',
    finalidade: 'Status direcionado ao cliente',
    obrigatorioPara: 'diagnóstico',
  },
  {
    chave: 'status',
    finalidade: 'Status interno usado no filtro',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
  {
    chave: 'dataConclusao',
    finalidade: 'Data de conclusão do ensaio',
    obrigatorioPara: 'diagnóstico',
  },
  {
    chave: 'dataEnvioRelatorio',
    finalidade: 'Data de envio do relatório',
    obrigatorioPara: 'diagnóstico',
  },
  {
    chave: 'dataAtualizacao',
    finalidade: 'Filtro de registros atualizados ontem',
    obrigatorioPara: 'e-mail e WhatsApp',
  },
]);

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function texto(valor, fallback = '') {
  const resultado = String(
    valor ?? ''
  ).trim();

  return resultado || fallback;
}

function linhaSeparadora(
  caractere = '=',
  tamanho = 78
) {
  return caractere.repeat(tamanho);
}

function ordenarTexto(a, b) {
  return a.localeCompare(
    b,
    'pt-BR',
    {
      sensitivity: 'base',
    }
  );
}

function possuiPropriedade(
  objeto,
  propriedade
) {
  return Object.prototype.hasOwnProperty.call(
    objeto,
    propriedade
  );
}

function nomeVisivelDoCampo(nome) {
  if (nome === '') {
    return '(nome vazio)';
  }

  const possuiEspacoInicial =
    /^\s/.test(nome);

  const possuiEspacoFinal =
    /\s$/.test(nome);

  let marcador = '';

  if (
    possuiEspacoInicial &&
    possuiEspacoFinal
  ) {
    marcador =
      ' [espaço no início e no final]';
  } else if (possuiEspacoInicial) {
    marcador =
      ' [espaço no início]';
  } else if (possuiEspacoFinal) {
    marcador =
      ' [espaço no final]';
  }

  return `"${nome}"${marcador}`;
}

function tipoDoValor(valor) {
  if (valor === null) {
    return 'null';
  }

  if (Array.isArray(valor)) {
    return 'array';
  }

  if (
    valor instanceof Date
  ) {
    return 'date';
  }

  return typeof valor;
}

function resumoSeguroDoValor(valor) {
  if (
    valor === undefined
  ) {
    return {
      tipo: 'undefined',
      preenchido: false,
    };
  }

  if (valor === null) {
    return {
      tipo: 'null',
      preenchido: false,
    };
  }

  if (Array.isArray(valor)) {
    return {
      tipo: 'array',
      preenchido:
        valor.length > 0,
      quantidade:
        valor.length,
    };
  }

  if (
    typeof valor === 'string'
  ) {
    return {
      tipo: 'string',
      preenchido:
        valor.trim().length > 0,
      caracteres:
        valor.length,
    };
  }

  if (
    typeof valor === 'number'
  ) {
    return {
      tipo: 'number',
      preenchido: true,
    };
  }

  if (
    typeof valor === 'boolean'
  ) {
    return {
      tipo: 'boolean',
      preenchido: true,
    };
  }

  if (
    typeof valor === 'object'
  ) {
    return {
      tipo: 'object',
      preenchido:
        Object.keys(valor).length > 0,
      propriedades:
        Object.keys(valor).length,
    };
  }

  return {
    tipo:
      tipoDoValor(valor),
    preenchido:
      Boolean(valor),
  };
}

// ============================================================
// COLETA DOS NOMES DE CAMPOS
// ============================================================

function coletarCampos(registros) {
  const nomes = new Set();
  const ocorrencias = new Map();
  const tipos = new Map();

  for (const registro of registros) {
    const campos =
      registro?.fields || {};

    for (
      const [nome, valor] of
      Object.entries(campos)
    ) {
      nomes.add(nome);

      ocorrencias.set(
        nome,
        (
          ocorrencias.get(nome) ||
          0
        ) + 1
      );

      if (!tipos.has(nome)) {
        tipos.set(
          nome,
          new Set()
        );
      }

      tipos.get(nome).add(
        tipoDoValor(valor)
      );
    }
  }

  return {
    nomes:
      [...nomes].sort(
        ordenarTexto
      ),

    ocorrencias,

    tipos,
  };
}

// ============================================================
// VERIFICAÇÃO DOS CAMPOS ESPERADOS
// ============================================================

function encontrarAlternativa(
  nomeEsperado,
  nomesDisponiveis
) {
  const normalizadoEsperado =
    nomeEsperado.trim().toLowerCase();

  return nomesDisponiveis.find(
    nome =>
      nome.trim().toLowerCase() ===
      normalizadoEsperado
  ) || '';
}

function verificarCampos(
  nomesDisponiveis
) {
  const conjunto =
    new Set(nomesDisponiveis);

  return CAMPOS_OBRIGATORIOS.map(
    definicao => {
      const nomeEsperado =
        CAMPOS[definicao.chave];

      const encontradoExato =
        conjunto.has(nomeEsperado);

      const alternativa =
        encontradoExato
          ? ''
          : encontrarAlternativa(
              nomeEsperado,
              nomesDisponiveis
            );

      return {
        chave:
          definicao.chave,

        nomeEsperado,

        finalidade:
          definicao.finalidade,

        obrigatorioPara:
          definicao.obrigatorioPara,

        encontrado:
          encontradoExato,

        alternativaEncontrada:
          alternativa,

        diferencaApenasEspacos:
          Boolean(alternativa),
      };
    }
  );
}

// ============================================================
// DETECÇÃO DE CAMPOS COM ESPAÇOS
// ============================================================

function detectarCamposComEspacos(
  nomesDisponiveis
) {
  return nomesDisponiveis
    .filter(nome =>
      nome !== nome.trim()
    )
    .map(nome => ({
      nome,
      semEspacosExternos:
        nome.trim(),

      espacoInicial:
        /^\s/.test(nome),

      espacoFinal:
        /\s$/.test(nome),
    }));
}

// ============================================================
// STATUS ENCONTRADOS
// ============================================================

function coletarStatus(registros) {
  const contagem = new Map();

  for (const registro of registros) {
    const campos =
      registro?.fields || {};

    const valor =
      campos[CAMPOS.status];

    const valores =
      Array.isArray(valor)
        ? valor
        : [valor];

    for (const item of valores) {
      const status =
        texto(item);

      if (!status) {
        continue;
      }

      contagem.set(
        status,
        (
          contagem.get(status) ||
          0
        ) + 1
      );
    }
  }

  return [...contagem.entries()]
    .map(
      ([status, quantidade]) => ({
        status,
        quantidade,
        permitido:
          STATUS_PERMITIDOS.includes(
            status
          ),
      })
    )
    .sort(
      (a, b) =>
        ordenarTexto(
          a.status,
          b.status
        )
    );
}

// ============================================================
// AMOSTRA SANITIZADA
// ============================================================

function montarAmostraSanitizada(
  registros
) {
  const primeiro =
    registros.find(
      registro =>
        registro &&
        registro.fields &&
        Object.keys(
          registro.fields
        ).length > 0
    );

  if (!primeiro) {
    return null;
  }

  const campos = {};

  for (
    const [nome, valor] of
    Object.entries(
      primeiro.fields
    )
  ) {
    campos[nome] =
      resumoSeguroDoValor(valor);
  }

  return {
    recordIdMascarado:
      primeiro.id
        ? (
            `${String(
              primeiro.id
            ).slice(0, 5)}***`
          )
        : '(sem id)',

    campos,
  };
}

// ============================================================
// CRIAÇÃO DO RELATÓRIO
// ============================================================

function gerarRelatorio(registros) {
  const coleta =
    coletarCampos(registros);

  const verificacao =
    verificarCampos(
      coleta.nomes
    );

  const ausentes =
    verificacao.filter(
      item => !item.encontrado
    );

  const presentes =
    verificacao.filter(
      item => item.encontrado
    );

  const alternativas =
    verificacao.filter(
      item =>
        !item.encontrado &&
        item.alternativaEncontrada
    );

  const camposDetalhados =
    coleta.nomes.map(nome => ({
      nome,

      ocorrencias:
        coleta.ocorrencias.get(
          nome
        ) || 0,

      tipos: [
        ...(
          coleta.tipos.get(nome) ||
          []
        ),
      ].sort(ordenarTexto),

      possuiEspacoInicial:
        /^\s/.test(nome),

      possuiEspacoFinal:
        /\s$/.test(nome),
    }));

  return {
    geradoEm:
      new Date().toISOString(),

    timezone:
      TIMEZONE,

    tabela:
      process.env
        .AIRTABLE_TABLE_ID ||
      'tblJAP4Av9sWm8SmL',

    viewConfigurada:
      Boolean(
        String(
          process.env
            .AIRTABLE_VIEW_ID || ''
        ).trim()
      ),

    totalRegistros:
      registros.length,

    totalCamposEncontrados:
      coleta.nomes.length,

    statusPermitidos:
      STATUS_PERMITIDOS,

    resumoValidacao: {
      esperados:
        verificacao.length,

      presentes:
        presentes.length,

      ausentes:
        ausentes.length,

      alternativasPorEspaco:
        alternativas.length,

      pronto:
        ausentes.length === 0,
    },

    verificacao,

    camposComEspacos:
      detectarCamposComEspacos(
        coleta.nomes
      ),

    statusEncontrados:
      coletarStatus(registros),

    camposEncontrados:
      camposDetalhados,

    amostraSanitizada:
      MOSTRAR_AMOSTRA
        ? montarAmostraSanitizada(
            registros
          )
        : null,
  };
}

// ============================================================
// SAÍDA EM TEXTO
// ============================================================

function mostrarCabecalho(
  relatorio
) {
  console.log('');
  console.log(
    linhaSeparadora()
  );

  console.log(
    'INSPEÇÃO DOS CAMPOS DO AIRTABLE — ITR ENGENHARIA'
  );

  console.log(
    linhaSeparadora()
  );

  console.log(
    `Registros consultados: ` +
    `${relatorio.totalRegistros}`
  );

  console.log(
    `Campos encontrados: ` +
    `${relatorio.totalCamposEncontrados}`
  );

  console.log(
    `Fuso: ${relatorio.timezone}`
  );

  console.log(
    `View configurada: ` +
    `${
      relatorio.viewConfigurada
        ? 'sim'
        : 'não'
    }`
  );

  console.log(
    `Status permitidos: ` +
    `${relatorio.statusPermitidos.join(' | ')}`
  );

  console.log(
    linhaSeparadora()
  );
}

function mostrarVerificacao(
  relatorio
) {
  console.log('');
  console.log(
    'VERIFICAÇÃO DOS CAMPOS NECESSÁRIOS'
  );

  console.log(
    linhaSeparadora('-', 78)
  );

  for (
    const item of
    relatorio.verificacao
  ) {
    const status =
      item.encontrado
        ? '[OK]'
        : '[FALTA]';

    console.log(
      `${status} ` +
      `${nomeVisivelDoCampo(
        item.nomeEsperado
      )}`
    );

    console.log(
      `      Uso: ` +
      `${item.finalidade}`
    );

    console.log(
      `      Necessário para: ` +
      `${item.obrigatorioPara}`
    );

    if (
      !item.encontrado &&
      item.alternativaEncontrada
    ) {
      console.log(
        `      Campo semelhante encontrado: ` +
        `${nomeVisivelDoCampo(
          item.alternativaEncontrada
        )}`
      );
    }
  }
}

function mostrarCamposComEspacos(
  relatorio
) {
  console.log('');
  console.log(
    'CAMPOS COM ESPAÇOS EXTERNOS'
  );

  console.log(
    linhaSeparadora('-', 78)
  );

  if (
    relatorio.camposComEspacos
      .length === 0
  ) {
    console.log(
      'Nenhum campo com espaço no início ou no final.'
    );

    return;
  }

  for (
    const campo of
    relatorio.camposComEspacos
  ) {
    console.log(
      `- ${nomeVisivelDoCampo(
        campo.nome
      )}`
    );

    console.log(
      `  Sem espaços externos: ` +
      `"${campo.semEspacosExternos}"`
    );
  }
}

function mostrarStatus(
  relatorio
) {
  console.log('');
  console.log(
    'STATUS ENCONTRADOS NOS REGISTROS CONSULTADOS'
  );

  console.log(
    linhaSeparadora('-', 78)
  );

  if (
    relatorio.statusEncontrados
      .length === 0
  ) {
    console.log(
      'Nenhum valor encontrado no campo de status.'
    );

    return;
  }

  for (
    const item of
    relatorio.statusEncontrados
  ) {
    console.log(
      `${item.permitido ? '[PERMITIDO]' : '[IGNORADO]'} ` +
      `${item.status} — ` +
      `${item.quantidade} registro(s)`
    );
  }
}

function mostrarTodosOsCampos(
  relatorio
) {
  console.log('');
  console.log(
    'TODOS OS CAMPOS RETORNADOS PELO AIRTABLE'
  );

  console.log(
    linhaSeparadora('-', 78)
  );

  for (
    const campo of
    relatorio.camposEncontrados
  ) {
    console.log(
      `- ${nomeVisivelDoCampo(
        campo.nome
      )}`
    );

    console.log(
      `  Ocorrências: ` +
      `${campo.ocorrencias}`
    );

    console.log(
      `  Tipo(s): ` +
      `${campo.tipos.join(', ')}`
    );
  }
}

function mostrarAmostra(
  relatorio
) {
  if (
    !relatorio.amostraSanitizada
  ) {
    return;
  }

  console.log('');
  console.log(
    'AMOSTRA SANITIZADA DOS TIPOS'
  );

  console.log(
    linhaSeparadora('-', 78)
  );

  console.log(
    JSON.stringify(
      relatorio.amostraSanitizada,
      null,
      2
    )
  );
}

function mostrarResultadoFinal(
  relatorio
) {
  console.log('');
  console.log(
    linhaSeparadora()
  );

  if (
    relatorio.resumoValidacao.pronto
  ) {
    console.log(
      'RESULTADO: TODOS OS CAMPOS ESPERADOS FORAM ENCONTRADOS.'
    );
  } else {
    console.log(
      'RESULTADO: EXISTEM CAMPOS AUSENTES OU COM NOME DIFERENTE.'
    );

    console.log(
      `Campos esperados: ` +
      `${relatorio.resumoValidacao.esperados}`
    );

    console.log(
      `Campos presentes: ` +
      `${relatorio.resumoValidacao.presentes}`
    );

    console.log(
      `Campos ausentes: ` +
      `${relatorio.resumoValidacao.ausentes}`
    );

    console.log(
      `Alternativas encontradas com diferença de espaço: ` +
      `${relatorio.resumoValidacao.alternativasPorEspaco}`
    );
  }

  console.log('');
  console.log(
    'Nenhum e-mail foi enviado.'
  );

  console.log(
    'Nenhuma chamada foi realizada para a Meta.'
  );

  console.log(
    linhaSeparadora()
  );

  console.log('');
}

// ============================================================
// EXECUÇÃO PRINCIPAL
// ============================================================

async function executar() {
  const registros =
    await buscarRegistrosDaView();

  const relatorio =
    gerarRelatorio(registros);

  if (SAIDA_JSON) {
    process.stdout.write(
      JSON.stringify(
        relatorio,
        null,
        2
      ) + '\n'
    );

    return relatorio;
  }

  mostrarCabecalho(relatorio);
  mostrarVerificacao(relatorio);
  mostrarCamposComEspacos(relatorio);
  mostrarStatus(relatorio);
  mostrarTodosOsCampos(relatorio);
  mostrarAmostra(relatorio);
  mostrarResultadoFinal(relatorio);

  return relatorio;
}

// ============================================================
// EXECUÇÃO DIRETA
// ============================================================

if (require.main === module) {
  executar()
    .then(relatorio => {
      if (
        !relatorio
          .resumoValidacao
          .pronto
      ) {
        process.exitCode = 2;
      }
    })
    .catch(erro => {
      console.error('');
      console.error(
        linhaSeparadora()
      );

      console.error(
        'ERRO AO INSPECIONAR O AIRTABLE'
      );

      console.error(
        linhaSeparadora()
      );

      console.error(
        erro?.stack ||
        erro?.message ||
        erro
      );

      console.error('');

      process.exitCode = 1;
    });
}

// ============================================================
// EXPORTAÇÕES
// ============================================================

module.exports = {
  executar,
  gerarRelatorio,
  coletarCampos,
  verificarCampos,
};  