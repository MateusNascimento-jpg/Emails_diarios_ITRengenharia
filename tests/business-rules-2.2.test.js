'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AIRTABLE_BLOQUEAR_WHATSAPP_COMPARTILHADO = 'false';
process.env.WHATSAPP_COUNTRY_CODE = '55';
process.env.AIRTABLE_WHATSAPP_COUNTRY_CODE = '55';
process.env.WHATSAPP_NUMEROS_BLOQUEADOS = '5561988887777|556195648450|5561995648450';
process.env.WHATSAPP_BLOQUEIO_RIGIDO_NUMEROS = 'false';
process.env.WHATSAPP_MODO_TESTE = 'false';
process.env.WHATSAPP_SIMULAR = 'true';
process.env.WHATSAPP_ATIVO = 'true';
process.env.WHATSAPP_TEMPLATE_NAME = 'atualizacao_ordem_servico';
process.env.WHATSAPP_TEMPLATE_LANGUAGE = 'pt_BR';
process.env.WHATSAPP_TEMPLATE_PARAMETER_MODE = 'named';
process.env.WHATSAPP_TEMPLATE_BODY_PARAMETERS = 'ordem_servico,detalhes';
process.env.WHATSAPP_FORMATO_DETALHES = 'auto';
process.env.WHATSAPP_DETALHES_MAX_CHARS = '800';
process.env.WHATSAPP_TEMPLATE_BODY_MAX_CHARS = '1024';
process.env.WHATSAPP_TEMPLATE_BODY_FIXED_CHARS = '306';
process.env.WHATSAPP_TEMPLATE_BODY_SAFETY_MARGIN = '20';

const {
  separarEmailsDetalhado,
  separarTelefonesDetalhado,
  normalizarTelefoneContato,
  CONFIG: AIRTABLE_CONFIG,
} = require('../airtable.js');

const {
  validarSegurancaWhatsappCliente,
  prepararEnvioWhatsAppDaOS,
} = require('../enviar_whatsapp.js');

const {
  montarEmailsIndividualizados,
  obterEmailsCliente,
} = require('../email_template.js');

const {
  CONFIG: WHATSAPP_TEMPLATE_CONFIG,
} = require('../whatsapp_template.js');

test('três telefones separados por ponto e vírgula são preservados', () => {
  const r = separarTelefonesDetalhado(
    '5548988101706;5567998535699;5561981558001'
  );

  assert.equal(r.validos.size, 3);
  assert.deepEqual([...r.validos.keys()], [
    '5548988101706',
    '5567998535699',
    '5561981558001',
  ]);
});

test('normalização aceita formatos brasileiros e internacionais plausíveis', () => {
  assert.equal(
    normalizarTelefoneContato('+55 (61) 98155-8001').numero,
    '5561981558001'
  );

  assert.equal(
    normalizarTelefoneContato('0 61 98155-8001').numero,
    '5561981558001'
  );

  assert.equal(
    normalizarTelefoneContato('0055 61 98155-8001').numero,
    '5561981558001'
  );

  assert.equal(
    normalizarTelefoneContato('556798535699').numero,
    '556798535699'
  );

  assert.equal(
    normalizarTelefoneContato('5567998535699').numero,
    '5567998535699'
  );
});

test('telefone compartilhado é auditado mas não bloqueado por padrão', () => {
  assert.equal(AIRTABLE_CONFIG.bloquearWhatsappCompartilhado, false);

  const r = validarSegurancaWhatsappCliente({
    clienteId: 'cliente-a',
    clienteNome: 'Cliente A',
    whatsappsEncontrados: ['5561999999999'],
    whatsappsParaEnvio: ['5561999999999'],
    whatsappDuplicadoEntreClientes: true,
    whatsappCompartilhadoBloqueante: false,
    whatsappAmbiguo: false,
    whatsappSeguroParaEnvio: true,
    whatsappMotivosBloqueio: [],
    clientesComMesmoWhatsapp: ['Cliente B'],
  }, { modoTeste: false });

  assert.equal(r.ok, true);
  assert.equal(r.numeroCompartilhado, true);
});

test('lista legada de números não bloqueia destinatários por padrão', () => {
  const r = validarSegurancaWhatsappCliente({
    clienteId: 'cliente-a',
    clienteNome: 'Cliente A',
    whatsappsEncontrados: [
      '5561988887777',
      '556195648450',
      '5561995648450',
      '5561999999999',
    ],
    whatsappsParaEnvio: [
      '5561988887777',
      '556195648450',
      '5561995648450',
      '5561999999999',
    ],
    whatsappSeguroParaEnvio: true,
    whatsappMotivosBloqueio: [],
  }, { modoTeste: false });

  assert.equal(r.ok, true);
  assert.equal(r.telefonesCliente.length, 4);
  assert.deepEqual(
    r.telefonesCliente.map(item => item.telefone),
    [
      '5561988887777',
      '556195648450',
      '5561995648450',
      '5561999999999',
    ]
  );
});

test('e-mails são individualizados e só o principal recebe a senha inicial', () => {
  const cliente = {
    clienteNome: 'Empresa Exemplo',
    cnpj: '12345678000190',
    emails: [
      'principal@empresa.com.br',
      'engenharia@empresa.com.br',
      'obras@empresa.com.br',
    ],
    emailPrincipal: 'principal@empresa.com.br',
  };

  const ordem = {
    osNome: 'OS-TESTE',
    linhas: [{
      amostra: 'A-01',
      ensaioNome: 'CBR',
      status: 'Enviado ao Cliente',
    }],
  };

  const mensagens = montarEmailsIndividualizados(cliente, ordem);

  assert.equal(mensagens.length, 3);
  assert.equal(mensagens[0].ehContatoPrincipal, true);
  assert.equal(mensagens[1].ehContatoPrincipal, false);

  assert.match(
    mensagens[0].texto,
    /Senha inicial \(somente no primeiro acesso\): principal@empresa\.com\.br/
  );

  assert.doesNotMatch(
    mensagens[1].texto,
    /Senha inicial \(somente no primeiro acesso\):/
  );

  assert.doesNotMatch(
    mensagens[1].texto,
    /principal@empresa\.com\.br/
  );

  assert.match(
    mensagens[1].texto,
    /E-mail destinatário: engenharia@empresa\.com\.br/
  );
});


test('Airtable preserva todos os e-mails válidos mesmo com formatação variada', () => {
  const r = separarEmailsDetalhado([
    'Principal <principal@empresa.com.br>; engenharia@empresa.com.br',
    'obras@empresa.com.br / laboratorio@empresa.com.br',
    'financeiro@empresa.com.br contato@empresa.com.br',
  ]);

  assert.deepEqual(
    r.validos.map(item => item.toLowerCase()),
    [
      'principal@empresa.com.br',
      'engenharia@empresa.com.br',
      'obras@empresa.com.br',
      'laboratorio@empresa.com.br',
      'financeiro@empresa.com.br',
      'contato@empresa.com.br',
    ]
  );
});

test('e-mails válidos são extraídos de fontes e separadores variados sem duplicação', () => {
  const emails = obterEmailsCliente({
    emailPrincipal: 'Principal@Empresa.com.br',
    emails: [
      'principal@empresa.com.br; engenharia@empresa.com.br',
      'obras@empresa.com.br / laboratorio@empresa.com.br',
    ],
    email: 'financeiro@empresa.com.br, contato@empresa.com.br outro@empresa.com.br',
  });

  assert.deepEqual(
    emails.map(item => item.toLowerCase()),
    [
      'principal@empresa.com.br',
      'engenharia@empresa.com.br',
      'obras@empresa.com.br',
      'laboratorio@empresa.com.br',
      'financeiro@empresa.com.br',
      'contato@empresa.com.br',
      'outro@empresa.com.br',
    ]
  );
});

function parametroNomeado(payload, nome) {
  const corpo = payload?.template?.components?.find(
    componente => componente.type === 'body'
  );

  return corpo?.parameters?.find(
    parametro => parametro.parameter_name === nome
  );
}

test('OS grande é dividida e todas as partes são preparadas para todos os telefones', () => {
  const telefones = [
    '5548988101706',
    '5567998535699',
    '5561981558001',
  ];

  const linhas = Array.from({ length: 84 }, (_, indice) => ({
    recordId: `rec-${indice + 1}`,
    idTrabalho: `trab-${indice + 1}`,
    amostra: `REG ${1500 + indice} (ST-TCV-TPS-G21-${1000 + indice})`,
    ensaioNome: indice % 3 === 0
      ? 'Índice de Suporte Califórnia - Energia Normal'
      : indice % 3 === 1
        ? 'Compactação Proctor Normal'
        : 'Granulometria por Peneiramento',
    ensaioSigla: indice % 3 === 0 ? 'CBR-N' : indice % 3 === 1 ? 'CP-N' : 'GRAN',
    status: indice % 2 === 0
      ? 'Aguardando Preparação'
      : 'Enviado ao Cliente',
  }));

  const preparado = prepararEnvioWhatsAppDaOS({
    cliente: {
      clienteId: 'cliente-grupo-aterpa',
      clienteNome: 'Grupo Aterpa',
      cnpj: '00000000000100',
      emailPrincipal: 'principal@aterpa.com.br',
      emails: ['principal@aterpa.com.br', 'obra@aterpa.com.br'],
      whatsappsEncontrados: telefones,
      whatsappsParaEnvio: telefones,
      whatsappDuplicadoEntreClientes: true,
      whatsappCompartilhadoBloqueante: false,
      whatsappAmbiguo: false,
      whatsappSeguroParaEnvio: true,
      whatsappMotivosBloqueio: [],
      clientesComMesmoWhatsapp: ['ITR Engenharia - Externo'],
    },
    ordem: {
      osId: 'os-45-2026',
      osNome: '45-2026',
      linhas,
    },
  });

  assert.equal(preparado.ok, true, preparado.mensagem || preparado.motivo);
  assert.equal(preparado.quantidadeDestinos, 3);
  assert.ok(preparado.quantidadePartes > 1);
  assert.equal(
    preparado.quantidadeMensagens,
    preparado.quantidadeDestinos * preparado.quantidadePartes
  );

  const partesPorDestino = new Map();

  for (const envio of preparado.envios) {
    assert.ok(envio.indiceDestino >= 1 && envio.indiceDestino <= 3);
    assert.ok(envio.indiceParte >= 1 && envio.indiceParte <= preparado.quantidadePartes);
    assert.ok(envio.tamanhoDetalhes <= WHATSAPP_TEMPLATE_CONFIG.detailsMaxChars);
    assert.ok(envio.tamanhoCorpoEstimado <= envio.limiteCorpo);

    const ordemServico = parametroNomeado(envio.payload, 'ordem_servico')?.text || '';
    const detalhes = parametroNomeado(envio.payload, 'detalhes')?.text || '';

    assert.match(
      ordemServico,
      new RegExp(`parte ${envio.indiceParte}/${preparado.quantidadePartes}`)
    );
    assert.ok(detalhes.length > 0);

    if (!partesPorDestino.has(envio.indiceDestino)) {
      partesPorDestino.set(envio.indiceDestino, new Set());
    }
    partesPorDestino.get(envio.indiceDestino).add(envio.indiceParte);
  }

  assert.equal(partesPorDestino.size, 3);
  for (const partes of partesPorDestino.values()) {
    assert.equal(partes.size, preparado.quantidadePartes);
  }
});

test('lista legada não remove destinos da preparação quando bloqueio rígido está desligado', () => {
  const preparado = prepararEnvioWhatsAppDaOS({
    cliente: {
      clienteId: 'cliente-misto',
      clienteNome: 'Cliente Misto',
      whatsappsEncontrados: [
        '5561988887777',
        '5561999999999',
        '5548988101706',
      ],
      whatsappsParaEnvio: [
        '5561988887777',
        '5561999999999',
        '5548988101706',
      ],
      whatsappSeguroParaEnvio: true,
      whatsappMotivosBloqueio: [],
    },
    ordem: {
      osId: 'os-mista',
      osNome: 'OS MISTA',
      linhas: [{
        amostra: 'A-01',
        ensaioNome: 'CBR',
        status: 'Enviado ao Cliente',
      }],
    },
  });

  assert.equal(preparado.ok, true);
  assert.equal(preparado.quantidadeDestinos, 3);
  assert.equal(preparado.quantidadeMensagens, 3);
});
