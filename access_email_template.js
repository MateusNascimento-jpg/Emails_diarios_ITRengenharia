"use strict";
function esc(v) { return String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function montarEmailAcesso(client, portalOrigin) {
  const cnpj = String(client.cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const url = `${portalOrigin}/login.html`;
  const paragraphs = [
    `Olá, ${client.name}.`,
    'Conforme solicitado, seguem os dados para acesso ao Portal do Cliente ITR:',
    `CNPJ: ${cnpj}\nSenha: ${client.accessPassword}`,
    'Acessar o Portal ITR',
    'Por segurança, mantenha seus dados de acesso em local seguro e não compartilhe sua senha com terceiros.',
    'Em caso de dúvidas ou dificuldades de acesso, entre em contato com a ITR Engenharia.',
    'Atenciosamente,\nITR Engenharia',
    'Esta é uma mensagem automática. Por favor, não responda a este e-mail.'
  ];
  const content = paragraphs.map((s,i) => i === 3 ? `<p><a href="${esc(url)}">Acessar o Portal ITR</a></p>` : `<p style="line-height:1.65">${esc(s).replace(/\n/g, '<br>')}</p>`).join('');
  return { assunto: 'Dados de acesso ao Portal ITR', texto: paragraphs.map((s,i) => i === 3 ? s+'\n'+url : s).join('\n\n'),
    html: `<!doctype html><html lang="pt-BR"><body style="background:#eef1f5;font-family:Arial,sans-serif;color:#1f2937"><table role="presentation" width="100%"><tr><td><table role="presentation" width="620" style="max-width:100%;margin:auto;background:white;border:1px solid #e6e9ef" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="#0f2543" style="background:#0f2543;padding:26px"><img src="cid:logoITR" alt="ITR Engenharia" width="200" style="display:block;max-width:100%;height:auto"></td></tr><tr><td style="padding:28px">${content}</td></tr></table></td></tr></table></body></html>` };
}
module.exports = { montarEmailAcesso };
