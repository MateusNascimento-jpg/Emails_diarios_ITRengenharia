'use strict';

function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const DEFINICOES = Object.freeze({
  FIRST_ACCESS: {
    assunto: 'Crie sua senha do Portal ITR',
    titulo: 'Seu primeiro acesso ao Portal ITR',
    descricao: 'Recebemos uma solicitação para ativar a senha pessoal da sua empresa no Portal do Cliente.',
    botao: 'Criar minha senha',
    aviso: 'Este link é temporário e funciona uma única vez. Se você não solicitou este acesso, ignore esta mensagem.'
  },
  PASSWORD_RESET: {
    assunto: 'Redefinição de senha do Portal ITR',
    titulo: 'Redefina sua senha do Portal ITR',
    descricao: 'Recebemos uma solicitação para redefinir a senha da sua empresa no Portal do Cliente.',
    botao: 'Redefinir minha senha',
    aviso: 'Este link é temporário e funciona uma única vez. Se você não fez esta solicitação, ignore a mensagem e sua senha atual continuará válida.'
  },
  PASSWORD_CREATED: {
    assunto: 'Senha do Portal ITR criada com sucesso',
    titulo: 'Sua senha pessoal foi criada',
    descricao: 'A ativação da senha do Portal do Cliente foi concluída. Nos próximos acessos, use seu CNPJ e a senha pessoal que você criou.',
    botao: null,
    aviso: 'A ITR nunca solicita sua senha por telefone, e-mail ou WhatsApp.'
  },
  PASSWORD_CHANGED: {
    assunto: 'Senha do Portal ITR alterada',
    titulo: 'Sua senha foi alterada',
    descricao: 'A senha do Portal do Cliente foi alterada e as outras sessões da conta foram encerradas por segurança.',
    botao: null,
    aviso: 'Se você não realizou esta alteração, solicite imediatamente uma nova senha pelo Portal e entre em contato com a ITR.'
  }
});

function montarEmailSeguranca({ type, client, actionUrl = null, portalOrigin = 'https://portal.itr.eng.br' }) {
  const def = DEFINICOES[type];
  if (!def) throw new Error('Tipo de e-mail de segurança não suportado.');
  const nome = client?.name || 'Cliente';
  const cnpj = client?.cnpj || '-';
  if (def.botao && !actionUrl) throw new Error('A notificação precisa de link de ação.');

  const blocoBotao = def.botao
    ? `<p style="margin:24px 0;text-align:center"><a href="${esc(actionUrl)}" style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">${esc(def.botao)}</a></p>`
    : `<p style="margin:22px 0 0"><a href="${esc(portalOrigin)}/login.html" style="color:#0f4c81;font-weight:700">Acessar o Portal ITR</a></p>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f7;font-family:Arial,sans-serif;color:#1f2937"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:26px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px"><tr><td bgcolor="#0f2543" style="padding:24px 28px;background:#0f2543;border-bottom:1px solid #e5e7eb;border-radius:12px 12px 0 0"><img src="cid:logoITR" alt="ITR Engenharia" width="150" style="display:block;width:150px;max-width:100%;height:auto"></td></tr><tr><td style="padding:28px"><div style="font-size:12px;color:#55708d;font-weight:700;letter-spacing:.6px;text-transform:uppercase">Segurança do Portal</div><h1 style="font-size:22px;line-height:1.25;margin:8px 0 14px;color:#0f2543">${esc(def.titulo)}</h1><p style="font-size:14px;line-height:1.65;margin:0 0 12px">Olá, <strong>${esc(nome)}</strong>.</p><p style="font-size:14px;line-height:1.65;margin:0">${esc(def.descricao)}</p><div style="margin:18px 0;padding:13px 15px;background:#f7f8fa;border:1px solid #e6e9ef;border-radius:9px;font-size:13px;line-height:1.55"><strong>CNPJ:</strong> ${esc(cnpj)}</div>${blocoBotao}<p style="font-size:12.5px;line-height:1.6;color:#6b7280;margin:22px 0 0">${esc(def.aviso)}</p></td></tr><tr><td style="padding:17px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11.5px;color:#6b7280">ITR Engenharia · Esta é uma mensagem automática de segurança.</td></tr></table></td></tr></table></body></html>`;

  const texto = [
    `ITR Engenharia — Segurança do Portal`,
    '',
    def.titulo,
    `Olá, ${nome}.`,
    def.descricao,
    `CNPJ: ${cnpj}`,
    def.botao ? `Acesse o link para continuar: ${actionUrl}` : `Portal: ${portalOrigin}/login.html`,
    '',
    def.aviso
  ].join('\n');

  return { assunto: def.assunto, html, texto };
}

module.exports = { montarEmailSeguranca, DEFINICOES };
