'use strict';
function montarEmailIntegridade(url) {
  const link = String(url).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return {
    assunto: 'ITR | Novo registro no Portal de Integridade',
    texto: `Um novo registro foi recebido no Portal de Integridade e Atendimento da ITR.\n\nAcesse o painel administrativo para consultar os detalhes:\n${url}\n\nEsta mensagem não contém dados do solicitante nem o conteúdo do registro.`,
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:Arial,Helvetica,sans-serif;color:#0f2543">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef1f5"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce2eb;border-radius:14px;overflow:hidden">
<tr><td align="center" bgcolor="#0f2543" style="padding:26px;background:#0f2543"><img src="cid:logoITR" width="200" alt="ITR Engenharia" style="display:block;width:200px;max-width:100%;height:auto"></td></tr>
<tr><td style="padding:32px 28px">
<p style="margin:0 0 12px;font-size:11px;font-weight:bold;letter-spacing:1px;color:#62748b">INTEGRIDADE E ATENDIMENTO</p>
<h1 style="margin:0 0 18px;font-size:25px;line-height:1.3;color:#0f2543">Um novo registro foi recebido</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">Há um novo registro no Portal de Integridade e Atendimento da ITR. Acesse o painel administrativo para consultar os detalhes e acompanhar o atendimento.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#0f2543" style="background:#0f2543;border-radius:8px;padding:15px 22px"><a href="${link}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;display:inline-block">Acessar painel administrativo</a></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px"><tr><td bgcolor="#f1f3f6" style="padding:16px 18px;border:1px solid #dce2eb;border-radius:10px;font-size:12px;line-height:1.7;color:#526174"><strong>Privacidade preservada</strong><br>Esta mensagem não contém dados do solicitante nem o conteúdo do registro.</td></tr></table>
<p style="margin:24px 0 0;font-size:11px;line-height:1.7;color:#64748b">Se o botão não abrir, acesse:<br><a href="${link}" style="color:#475569;word-break:break-all">${link}</a></p>
</td></tr><tr><td style="padding:18px 28px;border-top:1px solid #e6e9ef;font-size:11px;line-height:1.6;color:#64748b">ITR Engenharia · Notificação automática</td></tr></table>
</td></tr></table></body></html>`
  };
}
module.exports = { montarEmailIntegridade };
