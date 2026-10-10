'use strict';

function escape(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        (character) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
    );
}

function render(payload, origin) {
    const proposal = payload.snapshot.proposal;
    const title = {
        NEW: 'Nova proposta disponível',
        VERIFY: 'Confirme o aceite da proposta',
        ACCEPTED: 'Aceite da proposta confirmado',
    }[payload.type];
    const number = String(proposal.numero || '—');
    const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
        proposal.valor,
    );
    const copy = {
        NEW: 'Encaminhamos nossa proposta comercial. O documento original está anexado a este e-mail. Consulte as condições e registre sua decisão no Portal do Cliente.',
        VERIFY: 'Recebemos uma solicitação de aceite. Abra a página segura pelo botão abaixo, informe o código exibido no Portal e confirme expressamente sua decisão. O prazo de 30 minutos começa na solicitação. Se você não a reconhece, ignore este e-mail.',
        ACCEPTED:
            'O aceite foi confirmado e registrado com sucesso. A equipe dará continuidade aos procedimentos necessários. Agradecemos a confiança na ITR Engenharia.',
    }[payload.type];
    const portal = origin + '/login.html';
    const button = (url, label) =>
        `<a href="${escape(url)}" style="display:inline-block;padding:14px 24px;margin:8px 8px 0 0;background:#173651;color:#fff;text-decoration:none;border-radius:7px;font-weight:600;font-size:14px">${label}</a>`;
    const rows = [
        ['Proposta', number],
        ['Valor', money],
        ['Forma de pagamento', proposal.formaPagamento || 'Conforme proposta'],
        [
            'Prazo de pagamento',
            proposal.prazoPagamentoDias == null
                ? 'Conforme proposta'
                : `${proposal.prazoPagamentoDias} dias após emissão da NF`,
        ],
    ];
    const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#eef1f5;font-family:Arial,Helvetica,sans-serif;color:#273445">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e0e4e9;border-radius:12px;overflow:hidden">
<tr><td align="center" bgcolor="#000000" style="padding:26px;background:#000"><img src="cid:logoITR" width="200" alt="ITR Engenharia" style="display:block;width:200px;max-width:100%;height:auto"></td></tr>
<tr><td style="padding:28px"><h1 style="font-size:22px;line-height:1.3;margin:0 0 22px;color:#17283a">${title}</h1>
<p style="font-size:15px;line-height:1.6">Olá, <strong>${escape(proposal.nomeCliente)}</strong>.</p>
<p style="font-size:14px;line-height:1.7">${copy}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border-top:1px solid #e3e6eb">${rows.map(([label, value]) => `<tr><td style="padding:12px 4px;border-bottom:1px solid #e3e6eb;font-size:13px">${label}</td><td align="right" style="padding:12px 4px;border-bottom:1px solid #e3e6eb;font-size:14px;font-weight:600">${escape(value)}</td></tr>`).join('')}</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td bgcolor="#e5e8ed" style="padding:18px 20px;background:#e5e8ed;border:1px solid #d4dae2;border-radius:8px;font-size:14px;line-height:1.7"><strong>Acesso ao Portal do Cliente</strong><br>CNPJ: ${escape(proposal.cnpj)}<br>Utilize sua senha de acesso. Se necessário, solicite o reenvio pela página de login.</td></tr></table>
<p style="margin:20px 0">${payload.type === 'VERIFY' ? button(payload.actionUrl, 'Confirmar aceite') : ''}${button(portal, 'Portal do Cliente')}</p>
<p style="font-size:14px;line-height:1.7;margin:28px 0 0">Atenciosamente,<br><strong>Equipe ITR Engenharia</strong></p>
<p style="font-size:11px;color:#738091;border-top:1px solid #e3e6eb;padding-top:18px;margin-top:26px">Mensagem automática referente à proposta ${escape(number)}.</p>
</td></tr></table></td></tr></table></body></html>`;
    const texto = `${title}\n\nOlá, ${proposal.nomeCliente}.\n\n${copy}\n\n${rows.map((row) => row.join(': ')).join('\n')}\n\nCNPJ: ${proposal.cnpj}\n${payload.type === 'VERIFY' ? 'Confirmar aceite: ' + payload.actionUrl + '\n' : ''}Portal do Cliente: ${portal}\n\nEquipe ITR Engenharia`;
    return { assunto: `ITR Engenharia — ${title} — ${number}`, html, texto };
}

module.exports = { render };
