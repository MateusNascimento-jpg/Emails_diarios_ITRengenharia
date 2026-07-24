'use strict';

// ============================================================
// previsualizar_whatsapp.js
// ============================================================
//
// Este arquivo é exclusivamente de auditoria e pré-visualização.
//
// Ele não envia e-mails e não chama a Meta.
//
// Regras:
//
// npm run preview:whatsapp
// - respeita o marco AUTOMACAO_INICIO_EM;
// - considera somente atualizações de ontem.
//
// npm run preview:whatsapp:tudo
// - ignora o filtro de ontem;
// - ignora o marco AUTOMACAO_INICIO_EM;
// - consulta o histórico apenas para auditoria;
// - nunca transforma o histórico em fila de envio.
// ============================================================

require('dotenv').config({
  quiet: true,
});

const {
  buscarResumoDiario,
  STATUS_PERMITIDOS,
  TIMEZONE,
  AUTOMACAO_INICIO_EM,
} = require('./airtable.js');

const {
  montarVariaveisDaOS,
  CONFIG: TEMPLATE_CONFIG,
} = require('./whatsapp_template.js');

// ============================================================
// ARGUMENTOS DO TERMINAL
// ============================================================

const ARGUMENTOS = new Set(
  process.argv.slice(2)
);

const IGNORAR_DATA =
  ARGUMENTOS.has('--ignorar-data');

const SAIDA_JSON =
  ARGUMENTOS.has('--json');

const MOSTRAR_ITENS =
  !ARGUMENTOS.has('--sem-itens');

// Este arquivo já é, por definição, uma ferramenta de
// auditoria.
//
// O corte da automação somente será ignorado quando também
// houver --ignorar-data.
//
// Assim:
//
// preview:whatsapp
// respeita o corte.
//
// preview:whatsapp:tudo
// acessa o histórico para teste e auditoria.
const IGNORAR_CORTE_AUTOMACAO =
  IGNORAR_DATA;

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function texto(valor, fallback = '') {
  const resultado = String(
    valor ?? ''
  ).trim();

  return resultado || fallback;
}

function somenteDigitos(valor) {
  return String(
    valor ?? ''
  ).replace(/\D/g, '');
}

function mascararTelefone(valor) {
  const digitos =
    somenteDigitos(valor);

  if (!digitos) {
    return '(não cadastrado)';
  }

  if (digitos.length <= 4) {
    return '*'.repeat(
      digitos.length
    );
  }

  const inicio =
    digitos.slice(0, 4);

  const final =
    digitos.slice(-4);

  const quantidadeOculta =
    Math.max(
      digitos.length - 8,
      3
    );

  return (
    inicio +
    '*'.repeat(quantidadeOculta) +
    final
  );
}

function linhaSeparadora(
  caractere = '=',
  tamanho = 72
) {
  return caractere.repeat(
    tamanho
  );
}

function contarLinhas(clientes) {
  return clientes.reduce(
    (totalClientes, cliente) => {
      const ordens = Array.isArray(
        cliente?.ordens
      )
        ? cliente.ordens
        : [];

      return (
        totalClientes +
        ordens.reduce(
          (totalOrdens, ordem) => {
            const linhas = Array.isArray(
              ordem?.linhas
            )
              ? ordem.linhas
              : [];

            return (
              totalOrdens +
              linhas.length
            );
          },
          0
        )
      );
    },
    0
  );
}

// ============================================================
// CRIAÇÃO DO RESULTADO DE UMA OS
// ============================================================

function analisarOrdem(
  cliente,
  ordem
) {
  const resultado =
    montarVariaveisDaOS(
      cliente,
      ordem
    );

  const telefonesEncontrados =
    Array.isArray(
      cliente?.whatsappsEncontrados
    ) &&
    cliente.whatsappsEncontrados.length > 0
      ? cliente.whatsappsEncontrados
      : (
          cliente?.whatsapp
            ? [cliente.whatsapp]
            : []
        );

  const telefonesMascarados =
    telefonesEncontrados.map(
      mascararTelefone
    );

  const base = {
    clienteId:
      texto(cliente?.clienteId),

    clienteNome:
      texto(
        cliente?.clienteNome,
        '(cliente sem nome)'
      ),

    telefoneMascarado:
      telefonesMascarados.join(' | ') ||
      '(não informado)',

    telefonesMascarados,

    whatsappAmbiguo:
      cliente?.whatsappAmbiguo === true,

    quantidadeTelefonesEncontrados:
      telefonesEncontrados.length,

    osId:
      texto(ordem?.osId),

    osNome:
      texto(
        ordem?.osNome ||
          ordem?.osId,
        '(OS sem identificação)'
      ),

    quantidadeLinhasOriginais:
      Array.isArray(
        ordem?.linhas
      )
        ? ordem.linhas.length
        : 0,
  };

  if (!resultado.ok) {
    return {
      ...base,

      ok: false,

      motivo:
        resultado.motivo ||
        'falha-na-montagem',

      mensagem:
        resultado.mensagem || '',

      limite:
        resultado.limite,

      tamanho:
        resultado.tamanho,

      limiteCorpo:
        resultado.limiteCorpo,

      tamanhoCorpoEstimado:
        resultado.tamanhoCorpoEstimado,

      formatoTentado:
        resultado.formatoTentado,

      quantidadeItens:
        resultado.quantidadeItens || 0,
    };
  }

  return {
    ...base,

    ok: true,

    motivo: '',

    quantidadeItens:
      resultado.quantidadeItens,

    formatoDetalhes:
      resultado.formatoDetalhes,

    tamanhoDetalhes:
      resultado.tamanhoDetalhes,

    tamanhoCorpoEstimado:
      resultado.tamanhoCorpoEstimado,

    limiteCorpo:
      resultado.limiteCorpo,

    ordemServico:
      resultado.contexto
        .ordem_servico,

    detalhes:
      resultado.contexto
        .detalhes,

    contexto:
      resultado.contexto,

    itens:
      resultado.itens,
  };
}

// ============================================================
// CONVERSÃO PARA RESULTADO ESTRUTURADO
// ============================================================

function gerarRelatorio(
  clientes
) {
  const mensagens = [];

  for (const cliente of clientes) {
    const ordens = Array.isArray(
      cliente?.ordens
    )
      ? cliente.ordens
      : [];

    for (const ordem of ordens) {
      mensagens.push(
        analisarOrdem(
          cliente,
          ordem
        )
      );
    }
  }

  const validas =
    mensagens.filter(
      item => item.ok
    );

  const bloqueadas =
    mensagens.filter(
      item => !item.ok
    );

  return {
    geradoEm:
      new Date().toISOString(),

    timezone:
      TIMEZONE,

    modoAuditoria:
      true,

    ignorarData:
      IGNORAR_DATA,

    ignorarCorteAutomacao:
      IGNORAR_CORTE_AUTOMACAO,

    inicioAutomacao:
      AUTOMACAO_INICIO_EM || null,

    statusPermitidos:
      STATUS_PERMITIDOS,

    configuracaoDetalhes: {
      formato:
        TEMPLATE_CONFIG.detailsFormat,

      limiteCaracteres:
        TEMPLATE_CONFIG.detailsMaxChars,

      limiteCorpo:
        TEMPLATE_CONFIG.templateBodyMaxChars,

      margemSeguranca:
        TEMPLATE_CONFIG.templateBodySafetyMargin,
    },

    totais: {
      clientes:
        clientes.length,

      ordens:
        mensagens.length,

      mensagensValidas:
        validas.length,

      mensagensBloqueadas:
        bloqueadas.length,

      notificacoesPrevistas:
        validas.reduce(
          (total, item) =>
            total +
            item.quantidadeTelefonesEncontrados,
          0
        ),

      linhasRecebidas:
        contarLinhas(clientes),

      itensConsolidados:
        validas.reduce(
          (total, item) =>
            total +
            item.quantidadeItens,
          0
        ),
    },

    mensagens,
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
    'PRÉ-VISUALIZAÇÃO DO WHATSAPP — ITR ENGENHARIA'
  );

  console.log(
    linhaSeparadora()
  );

  console.log(
    `Fuso: ${relatorio.timezone}`
  );

  console.log(
    'Modo: AUDITORIA — nenhum envio será realizado'
  );

  console.log(
    `Filtro de data: ${
      relatorio.ignorarData
        ? 'IGNORADO'
        : 'somente atualizações de ontem'
    }`
  );

  console.log(
    `Marco da automação: ${
      relatorio.inicioAutomacao ||
      '(não configurado)'
    }`
  );

  console.log(
    `Corte da automação: ${
      relatorio.ignorarCorteAutomacao
        ? 'IGNORADO SOMENTE NESTA AUDITORIA HISTÓRICA'
        : 'ATIVO'
    }`
  );

  console.log(
    `Status permitidos: ` +
    `${relatorio.statusPermitidos.join(' | ')}`
  );

  console.log(
    `Formato dos detalhes: ` +
    `${relatorio.configuracaoDetalhes.formato}`
  );

  console.log(
    `Limite interno dos detalhes: ` +
    `${relatorio.configuracaoDetalhes.limiteCaracteres} caracteres`
  );

  console.log(
    `Limite do corpo do template: ` +
    `${relatorio.configuracaoDetalhes.limiteCorpo} caracteres`
  );

  console.log(
    `Margem preventiva: ` +
    `${relatorio.configuracaoDetalhes.margemSeguranca} caracteres`
  );

  console.log(
    linhaSeparadora()
  );

  console.log(
    `Clientes encontrados: ` +
    `${relatorio.totais.clientes}`
  );

  console.log(
    `Ordens encontradas: ` +
    `${relatorio.totais.ordens}`
  );

  console.log(
    `Mensagens válidas: ` +
    `${relatorio.totais.mensagensValidas}`
  );

  console.log(
    `Mensagens bloqueadas: ` +
    `${relatorio.totais.mensagensBloqueadas}`
  );

  console.log(
    `Notificações previstas: ` +
    `${relatorio.totais.notificacoesPrevistas}`
  );

  console.log(
    `Linhas recebidas do agrupamento: ` +
    `${relatorio.totais.linhasRecebidas}`
  );

  console.log(
    `Itens consolidados: ` +
    `${relatorio.totais.itensConsolidados}`
  );

  console.log(
    linhaSeparadora()
  );
}

function mostrarMensagem(
  mensagem,
  indice
) {
  console.log('');
  console.log(
    linhaSeparadora('-', 72)
  );

  console.log(
    `MENSAGEM ${indice + 1}`
  );

  console.log(
    linhaSeparadora('-', 72)
  );

  console.log(
    `Cliente: ${mensagem.clienteNome}`
  );

  console.log(
    `Cliente ID: ${
      mensagem.clienteId ||
      '(não informado)'
    }`
  );

  console.log(
    `WhatsApp: ${
      mensagem.telefoneMascarado
    }`
  );

  console.log(
    `Destinos previstos: ${mensagem.quantidadeTelefonesEncontrados}`
  );

  if (mensagem.whatsappAmbiguo) {
    console.log(
      'ATENÇÃO: existe ambiguidade de contato entre clientes.'
    );
  }

  console.log(
    `Ordem de Serviço: ${
      mensagem.osNome
    }`
  );

  console.log(
    `OS ID: ${
      mensagem.osId ||
      '(não informado)'
    }`
  );

  console.log(
    `Linhas originais da OS: ${
      mensagem.quantidadeLinhasOriginais
    }`
  );

  if (!mensagem.ok) {
    console.log('');
    console.log(
      'RESULTADO: MENSAGEM BLOQUEADA'
    );

    console.log(
      `Motivo: ${mensagem.motivo}`
    );

    if (mensagem.mensagem) {
      console.log(
        `Descrição: ${mensagem.mensagem}`
      );
    }

    if (
      mensagem.tamanho !== undefined &&
      mensagem.limite !== undefined
    ) {
      console.log(
        `Detalhes: ${mensagem.tamanho}/${mensagem.limite} caractere(s)`
      );
    }

    if (
      mensagem.tamanhoCorpoEstimado !== undefined &&
      mensagem.limiteCorpo !== undefined
    ) {
      console.log(
        `Corpo final estimado: ${mensagem.tamanhoCorpoEstimado}/${mensagem.limiteCorpo} caractere(s)`
      );
    }

    if (mensagem.formatoTentado) {
      console.log(
        `Formato tentado: ${mensagem.formatoTentado}`
      );
    }

    return;
  }

  console.log(
    `Itens consolidados: ${
      mensagem.quantidadeItens
    }`
  );

  console.log(
    `Formato usado: ${
      mensagem.formatoDetalhes
    }`
  );

  console.log(
    `Detalhes: ${mensagem.tamanhoDetalhes}/${TEMPLATE_CONFIG.detailsMaxChars} caractere(s)`
  );

  console.log(
    `Corpo final estimado: ${mensagem.tamanhoCorpoEstimado}/${mensagem.limiteCorpo} caractere(s)`
  );

  console.log('');
  console.log(
    'RESULTADO: MESMA MENSAGEM PARA TODOS OS NÚMEROS DESTA OS'
  );

  console.log('');
  console.log(
    '[VARIÁVEL: ordem_servico]'
  );

  console.log(
    mensagem.ordemServico
  );

  console.log('');
  console.log(
    '[VARIÁVEL: detalhes]'
  );

  console.log(
    mensagem.detalhes
  );

  if (
    MOSTRAR_ITENS &&
    Array.isArray(
      mensagem.itens
    )
  ) {
    console.log('');
    console.log(
      '[ASSOCIAÇÕES PRESERVADAS]'
    );

    mensagem.itens.forEach(
      (item, itemIndice) => {
        console.log('');
        console.log(
          `Item ${itemIndice + 1}:`
        );

        console.log(
          `  Amostra: ${item.amostra}`
        );

        console.log(
          `  Ensaio: ${item.ensaio}`
        );

        console.log(
          `  Status: ${item.status}`
        );
      }
    );
  }
}

function mostrarRodape(
  relatorio
) {
  console.log('');
  console.log(
    linhaSeparadora()
  );

  if (
    relatorio.totais.ordens === 0
  ) {
    console.log(
      'Nenhuma Ordem de Serviço passou pelos filtros.'
    );

    if (!IGNORAR_DATA) {
      console.log(
        'Para auditar todo o histórico com status permitido, execute:'
      );

      console.log(
        'npm run preview:whatsapp:tudo'
      );
    }
  } else {
    console.log(
      'Pré-visualização concluída.'
    );

    console.log(
      'Nenhum e-mail foi enviado.'
    );

    console.log(
      'Nenhuma chamada foi realizada para a Meta.'
    );

    if (
      relatorio.ignorarCorteAutomacao
    ) {
      console.log(
        'ATENÇÃO: o histórico apareceu somente porque esta execução é uma auditoria.'
      );

      console.log(
        'Esses registros não poderão entrar em uma execução operacional.'
      );
    }
  }

  console.log(
    linhaSeparadora()
  );

  console.log('');
}

// ============================================================
// EXECUÇÃO PRINCIPAL
// ============================================================

async function executar() {
  const clientes =
    await buscarResumoDiario({
      ignorarData:
        IGNORAR_DATA,

      modoAuditoria:
        true,

      ignorarCorteAutomacao:
        IGNORAR_CORTE_AUTOMACAO,
    });

  const relatorio =
    gerarRelatorio(clientes);

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

  mostrarCabecalho(
    relatorio
  );

  relatorio.mensagens.forEach(
    (mensagem, indice) => {
      mostrarMensagem(
        mensagem,
        indice
      );
    }
  );

  mostrarRodape(
    relatorio
  );

  return relatorio;
}

// ============================================================
// EXECUÇÃO DIRETA
// ============================================================

if (require.main === module) {
  executar()
    .then(relatorio => {
      if (
        relatorio.totais
          .mensagensBloqueadas > 0
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
        'ERRO NA PRÉ-VISUALIZAÇÃO'
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
  analisarOrdem,
};