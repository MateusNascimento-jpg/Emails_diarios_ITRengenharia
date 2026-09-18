'use strict';

const assert = require('node:assert/strict');

// O perfil V3 é ativado somente neste processo de validação.
// Nenhum .env é alterado e nenhuma chamada externa é executada.
process.env.WHATSAPP_TEMPLATE_NAME = 'atualizacao_ordem_servico_v3';
process.env.WHATSAPP_TEMPLATE_LANGUAGE = 'pt_BR';
process.env.WHATSAPP_TEMPLATE_PARAMETER_MODE = 'named';
process.env.WHATSAPP_TEMPLATE_BODY_PARAMETERS = 'order_service,order_status';
process.env.WHATSAPP_TEMPLATE_HEADER_TYPE = 'none';
process.env.WHATSAPP_TEMPLATE_BUTTONS = '';

const {
  montarPayloadsTemplateWhatsApp,
} = require('./whatsapp_template.js');

const {
  montarEmailsIndividualizados,
} = require('./email_template.js');

const {
  avaliarControle,
  ESTADOS,
  CAMPOS,
} = require('./idempotencia_airtable.js');

function parametroCorpo(payload, nome) {
  const corpo = payload?.template?.components?.find(
    componente => componente?.type === 'body'
  );

  return corpo?.parameters?.find(
    parametro => parametro?.parameter_name === nome
  );
}

function clienteBase() {
  return {
    clienteId: 'cliente-v3',
    clienteNome: 'Cliente de Validação',
    cnpj: '17162983005124',

    // Simula um principal global antigo/incorreto para provar que
    // a OS passa a usar o primeiro e-mail do record da própria OS.
    emailPrincipal: 'global-antigo@exemplo.com.br',
    emails: [
      'primeiro.record@exemplo.com.br',
      'segundo@exemplo.com.br',
    ],
    email:
      'primeiro.record@exemplo.com.br;segundo@exemplo.com.br',
  };
}

function ordemBase() {
  return {
    osId: 'os-v3',
    osNome: 'Agregados - Aterpa',

    emails: [
      'primeiro.record@exemplo.com.br',
      'segundo@exemplo.com.br',
    ],

    emailPrincipal:
      'primeiro.record@exemplo.com.br',

    linhas: [
      {
        recordId: 'rec-a',
        amostra: 'A-01',
        ensaioNome: 'Módulo de Resiliência',
        ensaioSigla: 'MR-I',
        status: 'Aguardando Preparação',
        dataAtualizacao: '2026-09-16T12:00:00.000Z',
      },
      {
        recordId: 'rec-b',
        amostra: 'A-02',
        ensaioNome: 'Limite de Liquidez',
        ensaioSigla: 'LL',
        status: 'Enviado ao Cliente',
        dataAtualizacao: '2026-09-16T18:30:00.000Z',
      },
      // Duplicata de status não pode duplicar o texto do WhatsApp.
      {
        recordId: 'rec-c',
        amostra: 'A-03',
        ensaioNome: 'Granulometria',
        ensaioSigla: 'GR',
        status: 'Enviado ao Cliente',
        dataAtualizacao: '2026-09-16T17:00:00.000Z',
      },
    ],
  };
}

function validarWhatsapp() {
  const resultado = montarPayloadsTemplateWhatsApp({
    cliente: clienteBase(),
    ordem: ordemBase(),
    telefone: '5561999999999',
  });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.multipart, false);
  assert.equal(resultado.quantidadePartes, 1);
  assert.equal(resultado.partes.length, 1);

  const payload = resultado.partes[0].payload;

  assert.equal(
    payload.template.name,
    'atualizacao_ordem_servico_v3'
  );

  assert.equal(
    parametroCorpo(payload, 'order_service')?.text,
    'Agregados - Aterpa'
  );

  assert.equal(
    parametroCorpo(payload, 'order_status')?.text,
    'Amostra recebida e Relatório Pronto'
  );

  const corpo = payload.template.components.find(
    componente => componente.type === 'body'
  );

  assert.equal(corpo.parameters.length, 2);
}

function validarEmail() {
  const mensagens = montarEmailsIndividualizados(
    clienteBase(),
    ordemBase()
  );

  assert.equal(mensagens.length, 2);

  assert.deepEqual(
    mensagens.map(item => item.destinatario),
    [
      'primeiro.record@exemplo.com.br',
      'segundo@exemplo.com.br',
    ]
  );

  for (const mensagem of mensagens) {
    assert.doesNotMatch(
      mensagem.texto,
      /global-antigo@exemplo\.com\.br/
    );
    assert.equal(
      mensagem.emailPrincipal,
      'primeiro.record@exemplo.com.br'
    );

    assert.match(
      mensagem.assunto,
      /Atualização da ordem de serviço Agregados - Aterpa/
    );

    assert.match(
      mensagem.html,
      /Informamos que foram registradas novas atualizações na ordem de serviço/
    );

    assert.match(
      mensagem.html,
      /16 de setembro de 2026/
    );

    assert.match(
      mensagem.html,
      /Acompanhe suas amostras pelo Portal do Cliente ITR/
    );

    assert.match(
      mensagem.html,
      /17\.162\.983\/0051-24/
    );

    assert.match(
      mensagem.html,
      /primeiro\.record@exemplo\.com\.br/
    );

    assert.match(
      mensagem.html,
      /Permanecemos à disposição para qualquer esclarecimento\./
    );

    assert.match(
      mensagem.html,
      /margin-top:30px/
    );

    assert.match(
      mensagem.texto,
      /Atenciosamente,\n\nEquipe ITR Engenharia/
    );
  }
}

function validarMigracaoIdempotencia() {
  const hashAntigo = 'a'.repeat(64);
  const hashNovo = 'b'.repeat(64);

  const registro = {
    fields: {
      [CAMPOS.email.estado]: ESTADOS.enviado,
      [CAMPOS.email.hash]: hashAntigo,
      [CAMPOS.email.atualizadoEm]:
        '2026-09-16T20:00:00.000Z',
    },
  };

  const jaCoberto = avaliarControle({
    registro,
    canal: 'email',
    hash: hashNovo,
    agora: new Date('2026-09-17T10:00:00.000Z'),
    fonteAtualizadaEm:
      '2026-09-16T18:30:00.000Z',
  });

  assert.equal(jaCoberto.permitirReserva, false);
  assert.equal(jaCoberto.confirmadoAnteriormente, true);
  assert.equal(
    jaCoberto.motivo,
    'fonte-ja-enviada-hash-alterado'
  );

  const novaAtualizacao = avaliarControle({
    registro,
    canal: 'email',
    hash: hashNovo,
    agora: new Date('2026-09-17T10:00:00.000Z'),
    fonteAtualizadaEm:
      '2026-09-16T21:00:00.000Z',
  });

  assert.equal(novaAtualizacao.permitirReserva, true);
  assert.equal(
    novaAtualizacao.motivo,
    'conteudo-alterado'
  );
}

validarWhatsapp();
validarEmail();
validarMigracaoIdempotencia();

console.log('VALIDAÇÃO NOTIFICAÇÕES V3: OK');
console.log('WHATSAPP: 1 mensagem por OS por destino, 2 variáveis nomeadas');
console.log('STATUS MISTO: Amostra recebida e Relatório Pronto');
console.log('E-MAIL: primeiro e-mail da OS + CNPJ formatado + data real + assinatura');
console.log('IDEMPOTÊNCIA: deploy não reenvia fonte já notificada; nova atualização continua liberada');
console.log('CHAMADA À META: NÃO');
console.log('CONSULTA AO AIRTABLE: NÃO');
console.log('ENVIO DE E-MAIL: NÃO');
