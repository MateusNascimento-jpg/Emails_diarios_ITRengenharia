'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AIRTABLE_BLOQUEAR_WHATSAPP_COMPARTILHADO = 'false';
process.env.WHATSAPP_COUNTRY_CODE = '55';
process.env.AIRTABLE_WHATSAPP_COUNTRY_CODE = '55';
process.env.WHATSAPP_NUMEROS_BLOQUEADOS = '5561988887777';
process.env.WHATSAPP_MODO_TESTE = 'false';
process.env.WHATSAPP_SIMULAR = 'true';
process.env.WHATSAPP_ATIVO = 'true';

const {
  separarTelefonesDetalhado,
  normalizarTelefoneContato,
  CONFIG: AIRTABLE_CONFIG,
} = require('../airtable.js');

const {
  validarSegurancaWhatsappCliente,
} = require('../enviar_whatsapp.js');

const {
  montarEmailsIndividualizados,
} = require('../email_template.js');

test('três telefones separados por ponto e vírgula são preservados', () => {
  const r = separarTelefonesDetalhado(
    '5548988101706;556798535699;5561981558001'
  );

  assert.equal(r.validos.size, 3);
  assert.deepEqual([...r.validos.keys()], [
    '5548988101706',
    '556798535699',
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

test('número bloqueado individualmente não derruba outro número válido', () => {
  const r = validarSegurancaWhatsappCliente({
    clienteId: 'cliente-a',
    clienteNome: 'Cliente A',
    whatsappsEncontrados: ['5561988887777', '5561999999999'],
    whatsappsParaEnvio: ['5561988887777', '5561999999999'],
    whatsappSeguroParaEnvio: true,
    whatsappMotivosBloqueio: [],
  }, { modoTeste: false });

  assert.equal(r.ok, true);
  assert.equal(r.telefonesCliente.length, 1);
  assert.equal(r.telefonesCliente[0].telefone, '5561999999999');
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
