'use strict';

// CTA "Portal do Cliente": faixa azul-marinho em PNG 3x, com texto incorporado.
const FAIXA = Object.freeze({ largura: 464, altura: 52 });

function dataBR(valor) {
    const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ''));
    return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : valor;
}

// Validade exibida no fuso da ITR, independentemente do fuso do servidor.
function validade(expiresAt) {
    if (!Number.isFinite(expiresAt)) return null;
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(expiresAt)).replace(',', ' às');
}

function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g,
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function render(payload, origin, { password = null } = {}) {
    const p = payload.snapshot.proposal;
    const title = {
        NEW: 'Nova proposta comercial disponível',
        VERIFY: 'Código de confirmação de aceite',
        ACCEPTED: 'Confirmação de aceite da proposta',
        INVOICE: 'Nota fiscal disponível',
    }[payload.type];
    if (!title) throw new Error('UNSUPPORTED_COMMERCIAL_EVENT');
    const number = String(p.numero ?? '—');
    // Sem valor confiável não se exibe "R$ 0,00".
    const money = typeof p.valor === 'number' && Number.isFinite(p.valor) && p.valor >= 0
        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valor)
        : 'Conforme proposta';
    const portal = origin + '/login.html';
    const copy = {
        NEW: 'Encaminhamos nossa proposta comercial para análise. Consulte as condições e registre sua decisão no Portal do Cliente.',
        VERIFY: 'Recebemos uma solicitação para confirmar o aceite desta proposta. Digite este código no Portal do Cliente, na área de Propostas, e confirme expressamente sua decisão. O código é válido por 2 horas (120 minutos), tem uso único e não é sua senha de acesso. Se não reconhece a solicitação, ignore esta mensagem.',
        ACCEPTED: 'O aceite da proposta foi registrado com sucesso em nosso sistema. Agradecemos a confiança na ITR Engenharia! Nossa equipe dará continuidade aos procedimentos de contratação e entrará em contato para alinhar as próximas etapas, conforme as condições previstas na proposta.',
        INVOICE: `Informamos que a nota fiscal referente ao Contrato ${escape(payload.invoice?.contractName || '')} já está disponível no Portal do Cliente. Acompanhe o prazo de vencimento indicado no documento.`,
    }[payload.type];
    const rows = [
        ['Número da proposta', number],
        ['Valor total', money],
        ['Condição de pagamento', p.formaPagamento || 'Conforme proposta'],
        ['Prazo de pagamento', p.prazoPagamentoDias == null ? 'Conforme proposta' : `${p.prazoPagamentoDias} dias após a emissão da respectiva nota fiscal`],
    ];
    if(payload.type === 'INVOICE') {
        rows.unshift(['Contrato', payload.invoice.contractName || 'Contrato']);
        rows.push(['Parcela', payload.invoice.parcela || 'Conforme contrato']);
        rows.push(['Vencimento', payload.invoice.vencimento ? dataBR(payload.invoice.vencimento) : 'Consulte no Portal']);
    }
    const contactName = typeof p.nomeContato === 'string' && p.nomeContato.trim() ? p.nomeContato.trim().slice(0, 120) : null;
    const greeting = contactName ? `Olá, <strong>${escape(contactName)}</strong>!` : 'Olá!';
    const description = typeof p.descricao === 'string' && p.descricao.trim() ? p.descricao.trim() : 'Conforme a proposta comercial anexa';
    const acceptedRows = [['Descrição', description], ...rows];
    const displayedRows = payload.type === 'ACCEPTED' ? acceptedRows : rows;
    const introHtml = payload.type === 'ACCEPTED'
      ? `<p style="font-size:14px;line-height:1.75">O aceite da <strong>Proposta nº ${escape(number)}</strong> foi registrado com sucesso em nosso sistema.</p><p style="font-size:14px;line-height:1.75">Agradecemos a confiança na <strong>ITR Engenharia</strong>! Nossa equipe dará continuidade aos procedimentos de contratação e entrará em contato para alinhar as próximas etapas, conforme as condições previstas na proposta.</p>`
      : `<p style="font-size:14px;line-height:1.7">${copy}</p>`;
    const followUp = payload.type === 'ACCEPTED' ? `<p style="font-size:14px;line-height:1.75;margin-top:18px">Você pode consultar a proposta aceita e acompanhar as informações da contratação pelo Portal do Cliente.</p>` : '';
    // A faixa PNG inteira é um único link; mantém proporção em telas estreitas.
    const button = `<a href="${escape(portal)}" title="Acessar Portal do Cliente" target="_blank" style="display:block;width:100%;max-width:${FAIXA.largura}px;margin:0 auto;text-decoration:none"><img src="cid:portalCta" width="${FAIXA.largura}" height="${FAIXA.altura}" alt="Acessar Portal do Cliente" style="display:block;width:100%;max-width:${FAIXA.largura}px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#1B364F" /></a>`;
    const buttonHtml = `<table role="presentation" align="center" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:14px auto 18px"><tr><td align="center" style="padding:0;text-align:center">${button}</td></tr></table>`;
    // Bloco de acesso: CNPJ e, quando confirmada pelas bases, a senha vigente
    // do Portal. Sem confirmação, apenas o CNPJ (sem texto de recuperação).
    const credentialsHtml = payload.type === 'VERIFY' ? '' :
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td bgcolor="#e5e8ed" style="padding:18px 20px;background:#e5e8ed;border:1px solid #d4dae2;border-radius:8px;font-size:14px;line-height:1.7"><strong>${payload.type === 'ACCEPTED' ? 'Dados de acesso' : 'Acesso ao Portal do Cliente'}</strong><br>CNPJ: ${escape(p.cnpj)}${password ? `<br><strong>Senha:</strong> ${escape(password)}<br>Mantenha estes dados protegidos.` : ''}</td></tr></table>`;
    const until = payload.type === 'VERIFY' ? validade(payload.expiresAt) : null;
    const codeHtml = payload.type === 'VERIFY' ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="#e5e8ed" style="background:#e5e8ed;padding:20px;border:1px solid #d4dae2;border-radius:8px"><div style="font-size:12px;color:#526071;font-weight:700">SEU CÓDIGO DE ACEITE · VÁLIDO POR 2 HORAS</div><div style="font-family:Arial,sans-serif;letter-spacing:7px;font-weight:700;font-size:32px;color:#17283a;padding-top:10px">${escape(payload.code)}</div>${until ? `<div style="font-size:12px;color:#526071;padding-top:8px">Válido até ${escape(until)} (horário de Brasília)</div>` : ''}</td></tr></table>` : '';
    // O Gmail controla a posição dos anexos MIME. Os links autenticados
    // aparecem dentro da mensagem, e os PDFs também vão em anexo.
    const docUrl = origin + '/api/propostas/' + encodeURIComponent(p.id) + '/documento/' + encodeURIComponent(payload.snapshot.attachmentId);
    const acceptedOriginal = origin + '/api/propostas/' + encodeURIComponent(p.id) + '/proposta-aceita';
    const acceptedProof = origin + '/api/propostas/' + encodeURIComponent(p.id) + '/comprovante';
    const docs = payload.type === 'VERIFY' ? '' : payload.type === 'INVOICE'
        ? `<div style="margin-top:24px;border-top:1px solid #e3e6eb;padding-top:15px"><strong style="font-size:13px;color:#173651">Documentos desta comunicação</strong>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border:1px solid #dce4ee;border-radius:8px">${payload.invoice.attachments.map(a=>
                `<tr><td style="padding:13px;border-bottom:1px solid #edf0f3"><a style="color:#095dd7;text-decoration:none;font-weight:700" href="${escape(origin+'/api/financeiro/documentos/'+a.tipo+'/'+payload.invoice.id+'/'+a.id)}">${a.tipo==='boleto'?'Boleto':'Nota fiscal'} — ${escape(a.filename)}</a></td></tr>`).join('')}</table>
            <p style="font-size:12px;color:#526071">Abertura mediante login no Portal do Cliente. Arquivos anexados a esta mensagem.</p></div>`
        : `<div style="margin-top:24px;border-top:1px solid #e3e6eb;padding-top:15px"><strong style="font-size:13px;color:#173651">Documentos Integrais</strong>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:10px;border:1px solid #dce4ee;border-radius:8px"><tr><td style="padding:14px"><a style="color:#095dd7;text-decoration:none;font-weight:700" href="${escape(payload.type==='ACCEPTED'?acceptedOriginal:docUrl)}">📄 Proposta comercial — abrir documento</a></td></tr>
        ${payload.type==='ACCEPTED'?`<tr><td style="padding:14px;border-top:1px solid #e3e6eb"><a href="${escape(acceptedProof)}" style="color:#095dd7;text-decoration:none;font-weight:700">📄 Comprovante de Contrato — abrir PDF</a></td></tr>`:''}</table>
        <p style="font-size:12px;color:#526071">Os documentos exigem autenticação no Portal e também acompanham esta mensagem em anexo.</p></div>`;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#eef1f5;font-family:Arial,Helvetica,sans-serif;color:#273445"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#fff;border:1px solid #e0e4e9;border-radius:12px"><tr><td align="center" bgcolor="#000" style="padding:26px;background:#000;border-radius:11px 11px 0 0"><img src="cid:logoITR" width="200" alt="ITR Engenharia" style="display:block;width:200px;max-width:100%;height:auto"></td></tr><tr><td style="padding:28px 30px 32px"><h1 style="font-size:22px;line-height:1.3;margin:0 0 22px;color:#17283a">${title}</h1><p style="font-size:15px;line-height:1.6">${greeting}</p>${introHtml}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border-top:1px solid #e3e6eb">${displayedRows.map(([label,value])=>`<tr><td style="padding:12px 4px;border-bottom:1px solid #e3e6eb;font-size:13px">${escape(label)}</td><td align="right" style="padding:12px 4px;border-bottom:1px solid #e3e6eb;font-size:14px;font-weight:600">${escape(value)}</td></tr>`).join('')}</table>${codeHtml}${followUp}${payload.type === 'ACCEPTED' ? buttonHtml + credentialsHtml : credentialsHtml + buttonHtml}<p style="font-size:14px;line-height:1.7">Permanecemos à disposição para esclarecer dúvidas e apoiar você nas próximas etapas.</p><p style="font-size:14px;line-height:1.7;margin:28px 0 0">Atenciosamente,<br><strong>Equipe ITR Engenharia</strong></p>${docs}<p style="font-size:11px;color:#738091;border-top:1px solid #e3e6eb;padding-top:18px;margin-top:26px">${payload.type === 'INVOICE'
        ? `Mensagem automática de disponibilização da nota fiscal referente ao Contrato ${escape(payload.invoice?.contractName || '')}.`
        : `Mensagem automática ${payload.type === 'ACCEPTED' ? 'de confirmação do aceite da Proposta nº ' : 'referente à proposta '}${escape(number)}.`}</p></td></tr></table></td></tr></table></body></html>`;
    const acceptedText = `O aceite da Proposta nº ${number} foi registrado com sucesso em nosso sistema.\n\nAgradecemos a confiança na ITR Engenharia! Nossa equipe dará continuidade aos procedimentos de contratação e entrará em contato para alinhar as próximas etapas, conforme as condições previstas na proposta.`;
    const text = [title, '', contactName ? `Olá, ${contactName}!` : 'Olá!', '', payload.type === 'ACCEPTED' ? acceptedText : copy, '', ...displayedRows.map((r)=>`${r[0]}: ${r[1]}`), '', ...(payload.type === 'ACCEPTED' ? ['Você pode consultar a proposta aceita e acompanhar as informações da contratação pelo Portal do Cliente.', 'Acessar Portal do Cliente: '+portal] : []),
        payload.type === 'VERIFY' ? `Seu código de aceite: ${payload.code}\nVálido por 2 horas (120 minutos)${until ? `, até ${until} (horário de Brasília)` : ''}; uso único.` : `CNPJ: ${p.cnpj}${password ? '\nSenha: '+password : ''}`,
        `Portal do Cliente: ${portal}`, '', 'Permanecemos à disposição para esclarecer dúvidas e apoiar você nas próximas etapas.', '', 'Atenciosamente,', 'Equipe ITR Engenharia', '', ...(payload.type === 'ACCEPTED' ? [`Proposta aceita: ${acceptedOriginal}`, `Comprovante de Contrato: ${acceptedProof}`] : payload.type === 'NEW' ? [`Proposta comercial: ${docUrl}`] : []), '', `Mensagem automática ${payload.type === 'ACCEPTED' ? 'de confirmação do aceite da Proposta nº ' : 'referente à proposta '}${number}.`].join('\n');
    return { assunto: `ITR Engenharia — ${title} — ${number}`, html, texto: text };
}

module.exports = { render };
