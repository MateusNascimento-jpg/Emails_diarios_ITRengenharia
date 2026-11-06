'use strict';
const { valid, today, validAccess, email } = require('./contract');
const escape = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const COPY = Object.freeze({
    BOLETO_AVAILABLE: ['Boleto disponível', 'Informamos que o boleto desta parcela está disponível e segue anexo em PDF. Confira os dados do documento e, em caso de dúvida, entre em contato com a equipe financeira antes de efetuar o pagamento.'],
    BOLETO_D_MINUS_1: ['Boleto vence amanhã', 'Lembramos que o boleto desta parcela vence amanhã. O PDF vigente segue anexo. Se já efetuou o pagamento, desconsidere este aviso; a identificação pode depender do prazo de processamento.'],
    BOLETO_DUE_TODAY: ['Boleto com vencimento hoje', 'Informamos que o boleto desta parcela vence hoje. O documento vigente segue anexo. Caso já tenha efetuado o pagamento, desconsidere este lembrete.'],
    BOLETO_OVERDUE_REMINDER: ['Acompanhamento de pagamento', 'Até o momento deste envio, o pagamento ainda não foi identificado em nossos registros. Caso já tenha pago, agradecemos e solicitamos que desconsidere este comunicado, pois a atualização pode depender da compensação bancária. O boleto segue anexo em PDF. O pagamento após o vencimento está sujeito aos acréscimos previstos em contrato; em caso de dúvida, consulte a equipe financeira.'],
    BOLETO_UPDATED: ['Boleto atualizado', 'Informamos que o boleto referente à sua parcela foi atualizado.\n\nA versão vigente segue anexa em PDF e substitui o documento anteriormente encaminhado. Utilize exclusivamente o documento atualizado para pagamento.\n\nCaso o vencimento já tenha ocorrido, aplicam-se os acréscimos previstos em contrato.\n\nSe o pagamento já foi realizado, desconsidere esta comunicação. Em caso de dúvidas, entre em contato com nossa equipe financeira.'],
    BOLETO_PAYMENT_RECORDED: ['Pagamento registrado', 'Informamos que o pagamento desta parcela foi registrado em nosso sistema. Agradecemos e permanecemos à disposição. Esta comunicação informa o registro e não constitui comprovante de quitação bancária definitiva.'],
    NFSE_AVAILABLE: ['Nota fiscal disponível', 'A Nota Fiscal de Serviços Eletrônica (NFSe) desta parcela está disponível. O PDF fiscal segue anexo e poderá ser consultado, mediante acesso, no Portal do Cliente.'],
});
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const civil = day => day.split('-').reverse().join('/');
// Same PDF bytes: only the data changed. The document is not announced as new, and only what changed is listed.
function dataCorrection(p) {
    const b = p.previous, changes = [];
    if (b.dueDate !== null && b.dueDate !== p.dueDate) changes.push(`Vencimento: de ${civil(b.dueDate)} para ${civil(p.dueDate)}.`);
    if (b.amountCents !== null && b.amountCents !== p.amountCents) changes.push(`Valor da parcela: de ${money(b.amountCents)} para ${money(p.amountCents)}.`);
    return ['Dados do boleto atualizados', ['Informamos que os dados financeiros desta parcela foram atualizados.', ...changes,
        'O boleto cadastrado para esta parcela segue anexo em PDF, sem alteração do arquivo. Se as informações impressas no documento divergirem dos dados acima, entre em contato com nossa equipe financeira antes de efetuar o pagamento.',
        'Caso o vencimento já tenha ocorrido, aplicam-se os acréscimos previstos em contrato.',
        'Se o pagamento já foi realizado, desconsidere esta comunicação. Em caso de dúvidas, entre em contato com nossa equipe financeira.'].join('\n\n')];
}
function render(p, now = Date.now(), access = null, contact = null) {
    if (!valid(p)) throw new Error('INVALID_EVENT');
    if (contact !== null && !email(contact)) throw new Error('INVALID_BILLING_CONFIGURATION');
    if (access !== null && !validAccess(access, p)) throw new Error('ACCESS_SCOPE_INVALID');
    const [title, base] = p.type === 'BOLETO_UPDATED' && p.previous.sha256 === p.document.sha256 ? dataCorrection(p) : COPY[p.type];
    // Availability may stand in for that day's reminder, so it states an elapsed due date itself.
    const overdue = p.type === 'BOLETO_AVAILABLE' && p.dueDate && p.dueDate < today(now);
    const copy = overdue ? `${base}\n\nO vencimento desta parcela ocorreu em ${civil(p.dueDate)}. Aplicam-se os acréscimos previstos em contrato.` : base;
    const rows = [['Contrato', p.contractName], ['Parcela', p.installment]];
    if (p.amountCents !== null) rows.push(['Valor da parcela', money(p.amountCents)]);
    if (p.dueDate) rows.push(['Vencimento', civil(p.dueDate)]);
    const days = p.dueDate ? (Date.parse(p.dueDate) - Date.parse(today(now))) / 86400000 : null;
    if (p.type === 'BOLETO_AVAILABLE' && days !== null && days >= 0) rows.push(['Prazo restante nesta data', days === 0 ? 'Vence hoje' : `${days} dia(s)`]);
    const portal = 'https://portal.itr.eng.br/login.html';
    const accessHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:16px;background:#e5e8ed;border:1px solid #d4dae2;border-radius:8px;font-size:14px;line-height:1.7"><strong>Acesso ao Portal do Cliente</strong><br><a href="${portal}" style="color:#095dd7">Portal do Cliente</a></td></tr></table>`;
    const contactHtml = contact ? `<p style="font-size:14px;line-height:1.7">Contato financeiro: <a href="mailto:${escape(encodeURIComponent(contact))}" style="color:#095dd7">${escape(contact)}</a></p>` : '';
    const texto = [title, 'Prezado(a),', copy, ...rows.map(([k, v]) => `${k}: ${v}`), 'Acesso ao Portal do Cliente', `Portal do Cliente: ${portal}`, ...(contact ? [`Contato financeiro: ${contact}`] : []), 'Atenciosamente,', 'Equipe ITR Engenharia', 'Mensagem automática.'].join('\n\n');
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef1f5;font-family:Arial,Helvetica,sans-serif;color:#273445"><div style="display:none;max-height:0;overflow:hidden">${title}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#fff;border:1px solid #e0e4e9;border-radius:12px"><tr><td align="center" bgcolor="#000000" style="padding:26px;background:#000;border-radius:11px 11px 0 0"><img src="cid:logoITR" width="200" alt="ITR Engenharia" style="display:block;width:200px;max-width:100%;height:auto"></td></tr><tr><td style="padding:28px 24px 32px;overflow-wrap:anywhere"><h1 style="font-size:22px;line-height:1.3;color:#17283a">${title}</h1><p>Prezado(a),</p>${copy.split('\n\n').map(part => `<p style="font-size:15px;line-height:1.7">${part}</p>`).join('')}<table width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border-top:1px solid #e3e6eb">${rows.map(([k, v]) => `<tr><th scope="row" align="left" style="padding:12px 4px;border-bottom:1px solid #e3e6eb;font-size:13px;font-weight:400">${escape(k)}</th><td align="right" style="padding:12px 4px;border-bottom:1px solid #e3e6eb;font-size:14px;font-weight:600">${escape(v)}</td></tr>`).join('')}</table>${accessHtml}<a href="${portal}" title="Portal do Cliente" style="display:block;width:100%;max-width:464px;margin:14px auto 18px"><img src="cid:portalCta" width="464" height="52" alt="Portal do Cliente" style="display:block;width:100%;max-width:464px;height:auto;border:0"></a>${contactHtml}<p style="font-size:14px;line-height:1.7">Atenciosamente,<br><strong>Equipe ITR Engenharia</strong></p><p style="font-size:11px;color:#738091;border-top:1px solid #e3e6eb;padding-top:18px">Mensagem automática${p.document ? '. Documento desta comunicação: ' + (p.document.kind === 'nfse' ? 'NFSe' : 'Boleto') + ' em PDF anexo' : ''}.</p></td></tr></table></td></tr></table></body></html>`;
    return { assunto: `ITR Engenharia | ${title} | ${p.contractName} — ${p.installment}`, html, texto };
}
module.exports = { render };
