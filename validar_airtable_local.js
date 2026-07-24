'use strict';

// ============================================================
// validar_airtable_local.js
// ============================================================
//
// Validação local e isolada das regras do airtable.js.
//
// Este arquivo:
//
// - NÃO consulta o Airtable;
// - NÃO envia e-mails;
// - NÃO chama a Meta;
// - NÃO utiliza dados reais de clientes;
// - NÃO altera o .env;
// - NÃO grava arquivos.
//
// Regras verificadas:
//
// 1. Histórico anterior ao marco não entra no fluxo operacional.
// 2. ignorarData=true não remove a trava de início.
// 3. Histórico só é acessível em auditoria explícita.
// 4. Data sem horário/fuso é recusada no fluxo operacional.
// 5. Mais de um número no mesmo cliente é permitido.
// 6. Telefone compartilhado entre clientes é bloqueado.
// 7. Número presente na lista de bloqueados é recusado.
// 8. Linhas duplicadas são consolidadas.
// 9. Contatos antigos podem complementar registros recentes.
// 10. Registros sem cliente ou sem OS são ignorados.
// 11. Status não permitido não entra no processamento.
//
// ============================================================

// As variáveis precisam ser definidas antes de carregar
// airtable.js, pois as configurações são lidas no require.

// ============================================================
// AMBIENTE ISOLADO DOS TESTES
// ============================================================

process.env.APP_TIMEZONE =
  'America/Sao_Paulo';

process.env.AUTOMACAO_INICIO_EM =
  '2026-08-01T00:00:00-03:00';

process.env.AIRTABLE_STATUS_PERMITIDOS =
  'Aguardando Preparação|Enviado ao Cliente';

process.env.WHATSAPP_COUNTRY_CODE =
  '55';

process.env.AIRTABLE_WHATSAPP_COUNTRY_CODE =
  '55';

process.env.AIRTABLE_CONTATOS_USAR_TODOS_REGISTROS =
  'true';

process.env.AIRTABLE_BLOQUEAR_WHATSAPP_COMPARTILHADO =
  'true';

process.env.AIRTABLE_LOG_DADOS_INVALIDOS =
  'false';

process.env.AIRTABLE_LOG_REGISTROS_IGNORADOS =
  'false';

process.env.AIRTABLE_FILTER_FORMULA =
  '';

process.env.AIRTABLE_PAGE_SIZE =
  '100';

process.env.AIRTABLE_MAX_PAGINAS =
  '1000';

// ============================================================
// MAPEAMENTO FIXO DOS CAMPOS FICTÍCIOS
// ============================================================

process.env.AIRTABLE_CAMPO_CLIENTE_LINK =
  'Cliente';

process.env.AIRTABLE_CAMPO_OS_LINK =
  'Ordem de Serviço';

process.env.AIRTABLE_CAMPO_CLIENTE_TEXTO =
  'Cliente Texto';

process.env.AIRTABLE_CAMPO_OS_TEXTO =
  'OS Texto';

process.env.AIRTABLE_CAMPO_EMAIL_CLIENTE =
  'Email do Cliente';

process.env.AIRTABLE_CAMPO_CNPJ_CLIENTE =
  'CNPJ do Cliente';

process.env.AIRTABLE_CAMPO_WHATSAPP_CLIENTE =
  'WhatsApp do Cliente';

process.env.AIRTABLE_CAMPO_ID_TRABALHO =
  'ID Trabalho';

process.env.AIRTABLE_CAMPO_NOME_TRABALHO =
  'Nome Trabalho';

process.env.AIRTABLE_CAMPO_AMOSTRA =
  'Link Amostras';

process.env.AIRTABLE_CAMPO_ENSAIO_SIGLA =
  'Link Ensaios';

// O espaço final é intencional.
process.env.AIRTABLE_CAMPO_ENSAIO_NOME =
  'Nome_Completo_Ensaios ';

process.env.AIRTABLE_CAMPO_STATUS_CLIENTE =
  'Status Cliente';

process.env.AIRTABLE_CAMPO_STATUS =
  'Status';

process.env.AIRTABLE_CAMPO_DATA_CONCLUSAO =
  'Data de Conclusão do Ensaio';

process.env.AIRTABLE_CAMPO_DATA_ENVIO_RELATORIO =
  'Data de Envio do Relatório';

process.env.AIRTABLE_CAMPO_DATA_ATUALIZACAO =
  'Data da Última Atualização Update';

// Número fictício usado apenas no teste local.
process.env.WHATSAPP_NUMEROS_BLOQUEADOS =
  '5561999998450';

const assert =
  require('node:assert/strict');

const {
  agruparPorClienteEOS,
  agruparPorClienteEOSDetalhado,
  analisarQualidadeContatos,
  normalizarTelefoneContato,
  instanteDoValor,
  ehPosteriorOuIgualAoInicioAutomacao,
  validarInicioAutomacaoConfigurado,
} = require('./airtable.js');

// ============================================================
// DADOS FICTÍCIOS
// ============================================================

let contadorRegistro = 0;

function criarRegistro({
  recordId,
  clienteId = 'recClienteA',
  osId = 'recOSA',
  clienteNome = 'Cliente A',
  osNome = 'OS A',
  email = 'cliente.a@example.com',
  whatsapp = '61999999999',
  idTrabalho,
  nomeTrabalho = 'Trabalho de teste',
  amostra = 'Amostra 01',
  ensaioSigla = 'MR-I',
  ensaioNome = 'Módulo de Resiliência',
  status = 'Enviado ao Cliente',
  statusCliente = '',
  dataAtualizacao =
    '2026-08-02T10:00:00-03:00',
  dataConclusao = '',
  dataEnvioRelatorio = '',
} = {}) {
  contadorRegistro += 1;

  const idFinal =
    recordId ||
    `recTeste${String(
      contadorRegistro
    ).padStart(4, '0')}`;

  const trabalhoFinal =
    idTrabalho ||
    `TRAB-${String(
      contadorRegistro
    ).padStart(4, '0')}`;

  const fields = {
    Cliente:
      clienteId
        ? [clienteId]
        : undefined,

    'Ordem de Serviço':
      osId
        ? [osId]
        : undefined,

    'Cliente Texto':
      clienteNome,

    'OS Texto':
      osNome,

    'Email do Cliente':
      email,

    'WhatsApp do Cliente':
      whatsapp,

    'ID Trabalho':
      trabalhoFinal,

    'Nome Trabalho':
      nomeTrabalho,

    'Link Amostras':
      amostra,

    'Link Ensaios':
      ensaioSigla,

    'Nome_Completo_Ensaios ':
      ensaioNome,

    'Status Cliente':
      statusCliente,

    Status:
      status,

    'Data de Conclusão do Ensaio':
      dataConclusao,

    'Data de Envio do Relatório':
      dataEnvioRelatorio,

    'Data da Última Atualização Update':
      dataAtualizacao,
  };

  for (
    const chave
    of Object.keys(fields)
  ) {
    if (fields[chave] === undefined) {
      delete fields[chave];
    }
  }

  return {
    id: idFinal,
    fields,
  };
}

function totalOrdens(clientes) {
  return clientes.reduce(
    (total, cliente) =>
      total +
      (
        Array.isArray(cliente.ordens)
          ? cliente.ordens.length
          : 0
      ),
    0
  );
}

function totalLinhas(clientes) {
  return clientes.reduce(
    (totalClientes, cliente) =>
      totalClientes +
      cliente.ordens.reduce(
        (totalOrdens, ordem) =>
          totalOrdens +
          ordem.linhas.length,
        0
      ),
    0
  );
}

// ============================================================
// TESTE 1 — CONFIGURAÇÃO DO MARCO
// ============================================================

function validarConfiguracaoDoMarco() {
  const resultado =
    validarInicioAutomacaoConfigurado();

  assert.equal(
    resultado.ok,
    true,
    'O marco de início deveria ser válido.'
  );

  assert.equal(
    resultado.bruto,
    '2026-08-01T00:00:00-03:00'
  );

  assert.ok(
    resultado.data instanceof Date
  );

  const semFuso =
    validarInicioAutomacaoConfigurado(
      '2026-08-01T00:00:00'
    );

  assert.equal(
    semFuso.ok,
    false
  );

  assert.equal(
    semFuso.motivo,
    'inicio-automacao-sem-fuso'
  );

  const invalido =
    validarInicioAutomacaoConfigurado(
      'data-invalida'
    );

  assert.equal(
    invalido.ok,
    false
  );
}

// ============================================================
// TESTE 2 — CONVERSÃO E COMPARAÇÃO DE DATAS
// ============================================================

function validarDatas() {
  const instante =
    instanteDoValor(
      '2026-08-01T00:00:00-03:00'
    );

  assert.ok(
    instante instanceof Date
  );

  assert.equal(
    instanteDoValor(
      '2026-08-01'
    ),
    null,
    'Data sem horário não pode provar o instante da mudança.'
  );

  assert.equal(
    instanteDoValor(
      '2026-08-01T10:00:00'
    ),
    null,
    'Data sem fuso explícito deve ser recusada.'
  );

  assert.equal(
    ehPosteriorOuIgualAoInicioAutomacao(
      '2026-07-31T23:59:59-03:00',
      '2026-08-01T00:00:00-03:00'
    ),
    false
  );

  assert.equal(
    ehPosteriorOuIgualAoInicioAutomacao(
      '2026-08-01T00:00:00-03:00',
      '2026-08-01T00:00:00-03:00'
    ),
    true
  );

  assert.equal(
    ehPosteriorOuIgualAoInicioAutomacao(
      '2026-08-01T00:00:01-03:00',
      '2026-08-01T00:00:00-03:00'
    ),
    true
  );
}

// ============================================================
// TESTE 3 — HISTÓRICO BLOQUEADO NO OPERACIONAL
// ============================================================

function validarHistoricoBloqueado() {
  const registros = [
    criarRegistro({
      clienteId:
        'recHistorico',

      osId:
        'recOSHistorica',

      clienteNome:
        'Cliente Histórico',

      osNome:
        'OS Histórica',

      dataAtualizacao:
        '2026-07-31T23:59:59-03:00',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    0
  );

  assert.equal(
    resultado.diagnostico
      .registrosAnterioresAoInicio,
    1
  );

  assert.equal(
    resultado.configuracao
      .ignorarCorteAutomacao,
    false
  );
}

// ============================================================
// TESTE 4 — AUDITORIA EXPLÍCITA PODE LER O HISTÓRICO
// ============================================================

function validarAuditoriaHistorica() {
  const registros = [
    criarRegistro({
      clienteId:
        'recAuditoria',

      osId:
        'recOSAuditoria',

      clienteNome:
        'Cliente Auditoria',

      osNome:
        'OS Auditoria',

      dataAtualizacao:
        '2025-01-01T10:00:00-03:00',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
        modoAuditoria: true,
        ignorarCorteAutomacao: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    1
  );

  assert.equal(
    totalOrdens(
      resultado.clientes
    ),
    1
  );

  assert.equal(
    resultado.configuracao
      .ignorarCorteAutomacao,
    true
  );
}

// ============================================================
// TESTE 5 — DATA INVÁLIDA NÃO ENTRA NO OPERACIONAL
// ============================================================

function validarDataSemInstante() {
  const registros = [
    criarRegistro({
      clienteId:
        'recDataInvalida',

      osId:
        'recOSDataInvalida',

      dataAtualizacao:
        '2026-08-02',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    0
  );

  assert.equal(
    resultado.diagnostico
      .registrosSemDataAtualizacaoValida,
    1
  );
}

// ============================================================
// TESTE 6 — MÚLTIPLOS TELEFONES NO MESMO CLIENTE
// ============================================================

function validarMultiplosTelefonesMesmoCliente() {
  const registros = [
    criarRegistro({
      clienteId:
        'recClienteMultiplos',

      osId:
        'recOSMultiplos',

      clienteNome:
        'Cliente com dois contatos',

      whatsapp:
        '61999999999; 61977776666',

      idTrabalho:
        'TRAB-MULTI-1',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    1
  );

  const cliente =
    resultado.clientes[0];

  assert.equal(
    cliente.whatsappsEncontrados.length,
    2
  );

  assert.equal(
    cliente.whatsappsParaEnvio.length,
    2
  );

  assert.equal(
    cliente.whatsappAmbiguo,
    false
  );

  assert.equal(
    cliente.whatsappSeguroParaEnvio,
    true
  );

  assert.equal(
    cliente.whatsappMotivosBloqueio.includes(
      'mais-de-um-numero-no-cliente'
    ),
    false
  );
}

// ============================================================
// TESTE 7 — TELEFONE REPETIDO NO MESMO CAMPO É DEDUPLICADO
// ============================================================

function validarTelefoneRepetidoNoMesmoCliente() {
  const registros = [
    criarRegistro({
      clienteId:
        'recClienteDuplicado',

      osId:
        'recOSDuplicado',

      clienteNome:
        'Cliente telefone repetido',

      whatsapp:
        '61999999999; (61) 99999-9999; +55 61 99999-9999',

      idTrabalho:
        'TRAB-DUP-TEL',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    1
  );

  const cliente =
    resultado.clientes[0];

  assert.equal(
    cliente.whatsappsEncontrados.length,
    1
  );

  assert.equal(
    cliente.whatsappsParaEnvio.length,
    1
  );

  assert.equal(
    cliente.whatsappSeguroParaEnvio,
    true
  );
}

// ============================================================
// TESTE 8 — TELEFONE COMPARTILHADO ENTRE CLIENTES
// ============================================================

function validarTelefoneCompartilhado() {
  const telefoneCompartilhado =
    '61988887777';

  const registros = [
    criarRegistro({
      clienteId:
        'recCompartilhadoA',

      osId:
        'recOSCompartilhadaA',

      clienteNome:
        'Empresa Compartilhada A',

      whatsapp:
        telefoneCompartilhado,

      idTrabalho:
        'TRAB-COMP-A',
    }),

    criarRegistro({
      clienteId:
        'recCompartilhadoB',

      osId:
        'recOSCompartilhadaB',

      clienteNome:
        'Empresa Compartilhada B',

      whatsapp:
        telefoneCompartilhado,

      idTrabalho:
        'TRAB-COMP-B',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    2
  );

  for (
    const cliente
    of resultado.clientes
  ) {
    assert.equal(
      cliente
        .whatsappDuplicadoEntreClientes,
      true
    );

    assert.equal(
      cliente.whatsappAmbiguo,
      true
    );

    assert.equal(
      cliente.whatsappSeguroParaEnvio,
      false
    );

    assert.ok(
      cliente
        .whatsappMotivosBloqueio
        .includes(
          'numero-compartilhado-entre-clientes'
        )
    );

    assert.equal(
      cliente
        .clientesComMesmoWhatsapp
        .length,
      1
    );
  }

  assert.equal(
    resultado.diagnostico
      .clientesComWhatsappCompartilhado,
    2
  );

  assert.equal(
    resultado.diagnostico
      .numerosCompartilhadosEntreClientes,
    1
  );
}

// ============================================================
// TESTE 9 — UM DOS NÚMEROS É COMPARTILHADO
// ============================================================

function validarUmDosNumerosCompartilhado() {
  const registros = [
    criarRegistro({
      clienteId:
        'recClienteDoisA',

      osId:
        'recOSDoisA',

      clienteNome:
        'Cliente Dois A',

      whatsapp:
        '61911112222; 61933334444',

      idTrabalho:
        'TRAB-DOIS-A',
    }),

    criarRegistro({
      clienteId:
        'recClienteDoisB',

      osId:
        'recOSDoisB',

      clienteNome:
        'Cliente Dois B',

      whatsapp:
        '61933334444',

      idTrabalho:
        'TRAB-DOIS-B',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  const clienteA =
    resultado.clientes.find(
      cliente =>
        cliente.clienteId ===
        'recClienteDoisA'
    );

  assert.ok(clienteA);

  assert.equal(
    clienteA.whatsappsEncontrados.length,
    2
  );

  assert.equal(
    clienteA
      .whatsappDuplicadoEntreClientes,
    true
  );

  assert.equal(
    clienteA.whatsappSeguroParaEnvio,
    false
  );
}

// ============================================================
// TESTE 10 — NÚMERO BLOQUEADO
// ============================================================

function validarNumeroBloqueado() {
  const registros = [
    criarRegistro({
      clienteId:
        'recBloqueado',

      osId:
        'recOSBloqueada',

      clienteNome:
        'Cliente Bloqueado',

      whatsapp:
        '61999998450',

      idTrabalho:
        'TRAB-BLOQUEADO',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  const cliente =
    resultado.clientes[0];

  assert.ok(cliente);

  assert.equal(
    cliente.whatsappBloqueado,
    true
  );

  assert.equal(
    cliente.whatsappSeguroParaEnvio,
    false
  );

  assert.ok(
    cliente
      .whatsappMotivosBloqueio
      .includes(
        'numero-bloqueado'
      )
  );

  assert.equal(
    resultado.diagnostico
      .clientesComWhatsappBloqueado,
    1
  );
}

// ============================================================
// TESTE 11 — UM DOS NÚMEROS ESTÁ BLOQUEADO
// ============================================================

function validarUmDosNumerosBloqueado() {
  const registros = [
    criarRegistro({
      clienteId:
        'recParcialBloqueado',

      osId:
        'recOSParcialBloqueado',

      clienteNome:
        'Cliente Parcialmente Bloqueado',

      whatsapp:
        '61977776666; 61999998450',

      idTrabalho:
        'TRAB-PARCIAL-BLOQ',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  const cliente =
    resultado.clientes[0];

  assert.ok(cliente);

  assert.equal(
    cliente.whatsappsEncontrados.length,
    2
  );

  assert.equal(
    cliente.whatsappBloqueado,
    true
  );

  assert.equal(
    cliente.whatsappSeguroParaEnvio,
    false
  );
}

// ============================================================
// TESTE 12 — DEDUPLICAÇÃO DAS LINHAS
// ============================================================

function validarDeduplicacao() {
  const dadosBase = {
    clienteId:
      'recDeduplicacao',

    osId:
      'recOSDeduplicacao',

    clienteNome:
      'Cliente Deduplicação',

    osNome:
      'OS Deduplicação',

    idTrabalho:
      'TRAB-DEDUP',

    amostra:
      'AMOSTRA-DEDUP',

    ensaioSigla:
      'MR-I',

    ensaioNome:
      'Módulo de Resiliência',

    status:
      'Enviado ao Cliente',

    dataAtualizacao:
      '2026-08-02T10:00:00-03:00',
  };

  const registros = [
    criarRegistro({
      ...dadosBase,

      recordId:
        'recLinhaDuplicada01',
    }),

    criarRegistro({
      ...dadosBase,

      recordId:
        'recLinhaDuplicada02',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    1
  );

  assert.equal(
    totalLinhas(
      resultado.clientes
    ),
    1
  );

  assert.equal(
    resultado.diagnostico
      .linhasDeduplicadas,
    1
  );

  assert.equal(
    resultado.diagnostico
      .linhasConsolidadas,
    1
  );
}

// ============================================================
// TESTE 13 — CONTATO ANTIGO COMPLEMENTA REGISTRO RECENTE
// ============================================================

function validarConsolidacaoGlobalDeContatos() {
  const registros = [
    criarRegistro({
      clienteId:
        'recContatoGlobal',

      osId:
        'recOSContatoAntiga',

      clienteNome:
        'Cliente Contato Global',

      whatsapp:
        '61977776666; 61988885555',

      email:
        'contato.global@example.com',

      idTrabalho:
        'TRAB-CONTATO-ANTIGO',

      dataAtualizacao:
        '2025-01-01T10:00:00-03:00',
    }),

    criarRegistro({
      clienteId:
        'recContatoGlobal',

      osId:
        'recOSContatoRecente',

      clienteNome:
        'Cliente Contato Global',

      whatsapp:
        '',

      email:
        '',

      idTrabalho:
        'TRAB-CONTATO-RECENTE',

      dataAtualizacao:
        '2026-08-02T10:00:00-03:00',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    1
  );

  const cliente =
    resultado.clientes[0];

  assert.equal(
    cliente.whatsappsEncontrados.length,
    2
  );

  assert.equal(
    cliente.emails.length,
    1
  );

  assert.equal(
    cliente.whatsappSeguroParaEnvio,
    true
  );

  assert.equal(
    cliente.ordens.length,
    1
  );

  assert.equal(
    cliente.ordens[0].osId,
    'recOSContatoRecente'
  );
}

// ============================================================
// TESTE 14 — REGISTROS INCOMPLETOS
// ============================================================

function validarRegistrosIncompletos() {
  const registros = [
    criarRegistro({
      clienteId:
        '',

      osId:
        'recOSSemCliente',

      recordId:
        'recSemCliente',
    }),

    criarRegistro({
      clienteId:
        'recClienteSemOS',

      osId:
        '',

      recordId:
        'recSemOS',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    0
  );

  assert.equal(
    resultado.diagnostico
      .registrosSemCliente,
    1
  );

  assert.equal(
    resultado.diagnostico
      .registrosSemOS,
    1
  );
}

// ============================================================
// TESTE 15 — STATUS NÃO PERMITIDO
// ============================================================

function validarStatusNaoPermitido() {
  const registros = [
    criarRegistro({
      clienteId:
        'recStatusNaoPermitido',

      osId:
        'recOSStatusNaoPermitido',

      status:
        'Cancelado',
    }),
  ];

  const resultado =
    agruparPorClienteEOSDetalhado(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.equal(
    resultado.clientes.length,
    0
  );

  assert.equal(
    resultado.diagnostico
      .registrosComStatusNaoPermitido,
    1
  );
}

// ============================================================
// TESTE 16 — COMPATIBILIDADE DO RETORNO ANTIGO
// ============================================================

function validarCompatibilidade() {
  const registros = [
    criarRegistro({
      clienteId:
        'recCompatibilidade',

      osId:
        'recOSCompatibilidade',
    }),
  ];

  const clientes =
    agruparPorClienteEOS(
      registros,
      {
        ignorarData: true,
      }
    );

  assert.ok(
    Array.isArray(clientes)
  );

  assert.equal(
    clientes.length,
    1
  );

  assert.equal(
    clientes[0].ordens.length,
    1
  );
}

// ============================================================
// TESTE 17 — QUALIDADE DOS CONTATOS
// ============================================================

function validarRelatorioDeQualidade() {
  const registros = [
    criarRegistro({
      clienteId:
        'recQualidade',

      osId:
        'recOSQualidade',

      clienteNome:
        'Cliente Qualidade',

      whatsapp:
        '61966665555; 61955554444',

      email:
        'qualidade@example.com',
    }),
  ];

  const clientes =
    agruparPorClienteEOS(
      registros,
      {
        ignorarData: true,
      }
    );

  const qualidade =
    analisarQualidadeContatos(
      clientes
    );

  assert.equal(
    qualidade.length,
    1
  );

  assert.equal(
    qualidade[0]
      .quantidadeEmails,
    1
  );

  assert.equal(
    qualidade[0]
      .quantidadeWhatsapps,
    2
  );

  assert.equal(
    qualidade[0]
      .whatsappSeguroParaEnvio,
    true
  );
}

// ============================================================
// TESTE 18 — NORMALIZAÇÃO DO TELEFONE
// ============================================================

function validarNormalizacaoTelefone() {
  const nacional =
    normalizarTelefoneContato(
      '(61) 99999-9999'
    );

  assert.equal(
    nacional.ok,
    true
  );

  assert.equal(
    nacional.numero,
    '5561999999999'
  );

  const internacional =
    normalizarTelefoneContato(
      '+55 61 98888-7777'
    );

  assert.equal(
    internacional.ok,
    true
  );

  assert.equal(
    internacional.numero,
    '5561988887777'
  );

  const invalido =
    normalizarTelefoneContato(
      '123'
    );

  assert.equal(
    invalido.ok,
    false
  );

  assert.equal(
    invalido.motivo,
    'telefone-invalido'
  );
}

// ============================================================
// EXECUÇÃO
// ============================================================

function executar() {
  validarConfiguracaoDoMarco();
  validarDatas();
  validarHistoricoBloqueado();
  validarAuditoriaHistorica();
  validarDataSemInstante();

  validarMultiplosTelefonesMesmoCliente();
  validarTelefoneRepetidoNoMesmoCliente();
  validarTelefoneCompartilhado();
  validarUmDosNumerosCompartilhado();
  validarNumeroBloqueado();
  validarUmDosNumerosBloqueado();

  validarDeduplicacao();
  validarConsolidacaoGlobalDeContatos();
  validarRegistrosIncompletos();
  validarStatusNaoPermitido();
  validarCompatibilidade();
  validarRelatorioDeQualidade();
  validarNormalizacaoTelefone();

  console.log(
    'VALIDAÇÃO AIRTABLE: OK'
  );

  console.log(
    'TESTES EXECUTADOS: 18'
  );

  console.log(
    'CONSULTA AO AIRTABLE: NÃO'
  );

  console.log(
    'ENVIO DE E-MAIL: NÃO'
  );

  console.log(
    'CHAMADA À META: NÃO'
  );

  console.log(
    'HISTÓRICO OPERACIONAL: BLOQUEADO'
  );

  console.log(
    'AUDITORIA HISTÓRICA: ISOLADA'
  );

  console.log(
    'MÚLTIPLOS NÚMEROS DO MESMO CLIENTE: PERMITIDOS'
  );

  console.log(
    'TELEFONES REPETIDOS: DEDUPLICADOS'
  );

  console.log(
    'TELEFONES COMPARTILHADOS ENTRE CLIENTES: BLOQUEADOS'
  );

  console.log(
    'NÚMEROS PROIBIDOS: BLOQUEADOS'
  );
}

try {
  executar();
} catch (erro) {
  console.error(
    'VALIDAÇÃO AIRTABLE: FALHOU'
  );

  console.error(
    erro?.stack ||
    erro?.message ||
    erro
  );

  process.exitCode = 1;
}