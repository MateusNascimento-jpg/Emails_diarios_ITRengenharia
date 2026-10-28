'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function formatarData(iso) {
  const data = new Date(iso);

  if (Number.isNaN(data.getTime())) {
    return String(iso ?? '');
  }

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(data);
}

function build(payload) {
  const c = payload.candidate;

  const arquivoPdf = payload.pdf?.filename || 'curriculo.pdf';

  const fields = [
    ['Protocolo', payload.protocol],
    ['Cadastro (horário de Brasília)', formatarData(payload.createdAt)],
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

  // Protege o assunto contra quebras de linha.
  const nomeAssunto = String(c.name).replace(/[\r\n]+/g, ' ').trim();
  const areaAssunto = String(c.area).replace(/[\r\n]+/g, ' ').trim();

  const assunto =
    `ITR Engenharia | Novo currículo: ${nomeAssunto} | ${areaAssunto}`;

  // Versão em texto para clientes que não exibem HTML.
  const texto = [
    'ITR ENGENHARIA — BANCO DE TALENTOS',
    'Nova candidatura recebida',
    '',
    ...fields.map(([label, value]) => `${label}: ${value}`),
    '',
    `Arquivo: ${arquivoPdf}`,
    'O currículo PDF segue anexado.',
    'Para contatar o candidato, responda diretamente a este e-mail.',
    '',
    'Mensagem confidencial. Compartilhe apenas com pessoas autorizadas.',
  ].join('\n');

  // Monta automaticamente a tabela com os dados do candidato.
  const rows = fields.map(([label, value], index) =>
    `<tr style="background-color:${index % 2 === 0 ? '#f5f8fc' : '#ffffff'}">` +
    `<th align="left" valign="top" style="width:38%;padding:12px;border-bottom:1px solid #e4eaf2;color:#39536f;font-size:13px">${escapeHtml(label)}</th>` +
    `<td valign="top" style="padding:12px;border-bottom:1px solid #e4eaf2;font-size:14px;line-height:21px;overflow-wrap:anywhere">${escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>')}</td></tr>`
  ).join('');

  // O logotipo e o PDF são anexados por enviar_email.js.
  const html =
    `<!doctype html>` +
    `<html lang="pt-BR">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `</head>` +

    `<body style="margin:0;padding:0;background:#edf2f7;font-family:Arial,sans-serif;color:#172b42">` +

    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf2f7">` +
    `<tr><td align="center" style="padding:24px 12px">` +

    `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff">` +

    // Logotipo
    `<tr><td style="padding:22px 28px;background:#123a70;border-bottom:3px solid #205dc0">` +
    `<img src="cid:logoITR" alt="ITR Engenharia" width="180" style="display:block;max-width:100%;height:auto;border:0">` +
    `</td></tr>` +

    // Cabeçalho
    `<tr><td style="padding:28px;background:#123a70;color:#ffffff">` +
    `<p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;color:#bed8ff;font-weight:bold">BANCO DE TALENTOS</p>` +
    `<h1 style="margin:0;font-size:26px;line-height:33px;color:#ffffff">Nova candidatura recebida</h1>` +
    `<p style="margin:12px 0 0;font-size:15px;color:#e3edfb">Um profissional cadastrou seu currículo na ITR Engenharia.</p>` +
    `</td></tr>` +

    // Destaque do candidato
    `<tr><td style="padding:25px 28px 10px">` +
    `<p style="margin:0;font-size:22px;color:#123a70;font-weight:bold">${escapeHtml(c.name)}</p>` +
    `<p style="margin:7px 0 0;font-size:15px;color:#496078">${escapeHtml(c.area)}</p>` +
    `</td></tr>` +

    // Dados preenchidos no formulário
    `<tr><td style="padding:14px 28px 22px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
    rows +
    `</table></td></tr>` +

    // Currículo anexado
    `<tr><td style="padding:0 28px 24px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eaf2ff;border-left:4px solid #205dc0">` +
    `<tr><td style="padding:16px">` +
    `<strong style="color:#123a70">Currículo em PDF anexado</strong>` +
    `<p style="margin:6px 0 0;font-size:13px;color:#496078;overflow-wrap:anywhere">${escapeHtml(arquivoPdf)}</p>` +
    `</td></tr></table></td></tr>` +

    // Instrução para responder ao candidato
    `<tr><td style="padding:0 28px 25px;font-size:13px;line-height:20px;color:#496078">` +
    `Para falar com o candidato, basta responder a este e-mail.` +
    `</td></tr>` +

    // Rodapé
    `<tr><td style="padding:18px 28px;background:#f5f8fc;border-top:1px solid #e4eaf2;font-size:12px;line-height:19px;color:#58708b">` +
    `Mensagem automática do Banco de Talentos da ITR Engenharia.<br>` +
    `Contém dados pessoais: compartilhe apenas com pessoas autorizadas.` +
    `</td></tr>` +

    `</table>` +
    `</td></tr></table>` +
    `</body></html>`;

  return {
    assunto,
    texto,
    html,
  };
}

module.exports = {
  build,
  escapeHtml,
};