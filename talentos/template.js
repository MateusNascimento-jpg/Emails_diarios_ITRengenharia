'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function build(payload) {
  const c = payload.candidate;
  const fields = [
    ['Protocolo', payload.protocol],
    ['Cadastro (UTC)', payload.createdAt],
    ['Nome', c.name],
    ['E-mail', c.email],
    ['Telefone', c.phone],
    ['Cidade/UF', `${c.city}/${c.state}`],
    ['Área de interesse', c.area],
    ['Momento profissional', c.level],
    ['Formação', c.education || 'Não informada'],
    ['LinkedIn / portfólio', c.portfolio || 'Não informado'],
    ['Apresentação', c.summary || 'Não informada'],
  ];
  const assunto = `Banco de Talentos ITR | Novo currículo | ${c.name}`;
  const texto = ['Novo currículo recebido — ITR Engenharia', '',
    ...fields.map(([label, value]) => `${label}: ${value}`), '',
    'O currículo PDF segue anexado.'].join('\n');
  const rows = fields.map(([label, value]) =>
    `<tr><th align="left" style="padding:9px;border-bottom:1px solid #e4eaf2;color:#496078;vertical-align:top">${escapeHtml(label)}</th>` +
    `<td style="padding:9px;border-bottom:1px solid #e4eaf2;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;background:#f1f5fa;font-family:Arial,sans-serif;color:#1c2937">` +
    `<div style="max-width:660px;margin:24px auto;background:white;border-radius:12px;padding:25px">` +
    `<img src="cid:logoITR" alt="ITR Engenharia" style="max-width:190px;height:auto"/>` +
    `<h1 style="font-size:23px">Novo currículo recebido</h1>` +
    `<p>Uma candidatura foi registrada no Banco de Talentos da ITR Engenharia.</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` +
    `<p style="font-size:13px;color:#496078">Currículo original em PDF anexado. Este conteúdo contém dados pessoais; encaminhe apenas a pessoas autorizadas.</p>` +
    `</div></body></html>`;
  return { assunto, texto, html };
}

module.exports = { build, escapeHtml };
