// ============================================================
// email_template.js — MONTAGEM DO E-MAIL DIÁRIO
// ============================================================
// Regra de negócio:
// - Uma OS pode gerar um e-mail individual por destinatário válido.
// - O primeiro e-mail válido do record da própria OS define o primeiro acesso.
// - Todos os destinatários recebem o mesmo conteúdo completo da atualização.
// - O e-mail de primeiro acesso é exibido de forma consistente para o cliente.
// ============================================================

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const STATUS_EXIBICAO = {
  'Aguardando Preparação': 'Amostra recebida',
  'Enviado ao Cliente': 'Relatório Pronto',
};

function statusExibido(statusReal) {
  return STATUS_EXIBICAO[statusReal] || statusReal || '-';
}

function corDoStatus(statusExib) {
  const s = (statusExib || '').toLowerCase();

  if (s.includes('relatório pronto') || s.includes('relatorio pronto')) {
    return { fundo: '#dcfce7', texto: '#166534' };
  }

  if (s.includes('amostra recebida')) {
    return { fundo: '#dbeafe', texto: '#1e40af' };
  }

  if (s.includes('andamento')) {
    return { fundo: '#fef3c7', texto: '#92400e' };
  }

  return { fundo: '#f3f4f6', texto: '#374151' };
}

function pilulaStatus(statusReal) {
  const exib = statusExibido(statusReal);
  const c = corDoStatus(exib);

  return `<span style="display:inline-block;padding:3px 10px;border-radius:9999px;`
    + `background:${c.fundo};color:${c.texto};font-size:12px;font-weight:600;white-space:nowrap;">${esc(exib)}</span>`;
}

function linhaTabela(l) {
  const cel = 'padding:10px 14px;border-bottom:1px solid #eef0f3;font-size:14px;color:#111827;vertical-align:middle;';

  return `<tr>`
    + `<td style="${cel}">${esc(l.amostra || '-')}</td>`
    + `<td style="${cel}">${esc(l.ensaioNome || l.ensaioSigla || '-')}</td>`
    + `<td style="${cel}">${pilulaStatus(l.status)}</td>`
    + `</tr>`;
}

function emailValidoBasico(valor) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(valor || '').trim());
}

function obterEmailsCliente(cliente) {
  // Consolida todas as fontes conhecidas. Isso evita perder um contato
  // quando uma integração antiga preenche `email` e a nova preenche
  // `emails`/`emailPrincipal` (ou vice-versa).
  const fontes = [
    cliente?.emailPrincipal || '',
    ...(Array.isArray(cliente?.emails) ? cliente.emails.flat(Infinity) : []),
    cliente?.email || '',
  ];

  const vistos = new Set();
  const emails = [];

  for (const fonte of fontes) {
    const texto = String(fonte || '').trim();
    if (!texto) continue;

    // Extrai endereços mesmo quando o Airtable recebe separadores variados
    // (ponto e vírgula, vírgula, barra, pipe, quebra de linha ou espaço).
    // O campo é destinado exclusivamente a contatos de e-mail, então a
    // extração é mais tolerante sem inventar ou corrigir endereços inválidos.
    const extraidos = texto.match(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
    ) || [];

    const candidatos = extraidos.length > 0
      ? extraidos
      : texto
          .split(/[;,|/\n\r\s]+/)
          .map(item => item.trim())
          .filter(Boolean);

    for (const candidato of candidatos) {
      const email = String(candidato || '').trim();
      const chave = email.toLowerCase();

      if (
        !emailValidoBasico(email) ||
        vistos.has(chave)
      ) {
        continue;
      }

      vistos.add(chave);
      emails.push(email);
    }
  }

  return emails;
}

function emailPrincipalDoCliente(cliente, emails = obterEmailsCliente(cliente)) {
  const configurado = String(cliente?.emailPrincipal || '').trim();

  if (emailValidoBasico(configurado)) {
    return configurado;
  }

  return emails[0] || '';
}

function emailPrincipalDaOrdem(
  cliente,
  ordem,
  emails = obterEmailsCliente(cliente)
) {
  const daOrdem = String(
    ordem?.emailPrincipal || ''
  ).trim();

  if (emailValidoBasico(daOrdem)) {
    return daOrdem;
  }

  return emailPrincipalDoCliente(
    cliente,
    emails
  );
}

function formatarCnpj(valor) {
  const original = String(valor || '').trim();
  const digitos = original.replace(/\D/g, '');

  if (digitos.length !== 14) {
    return original || '-';
  }

  return digitos.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5'
  );
}

function dataAtualizacaoDaOrdem(ordem) {
  const linhas = Array.isArray(ordem?.linhas)
    ? ordem.linhas
    : [];

  let maisRecente = null;

  for (const linha of linhas) {
    const bruto = String(
      linha?.dataAtualizacao || ''
    ).trim();

    if (!bruto) {
      continue;
    }

    let data;

    if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) {
      const [ano, mes, dia] = bruto
        .split('-')
        .map(Number);

      data = new Date(
        Date.UTC(ano, mes - 1, dia, 12, 0, 0)
      );
    } else {
      data = new Date(bruto);
    }

    if (Number.isNaN(data.getTime())) {
      continue;
    }

    if (
      !maisRecente ||
      data.getTime() > maisRecente.getTime()
    ) {
      maisRecente = data;
    }
  }

  const dataFinal = maisRecente ||
    new Date(Date.now() - 24 * 60 * 60 * 1000);

  return dataFinal.toLocaleDateString(
    'pt-BR',
    {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone:
        process.env.APP_TIMEZONE ||
        'America/Sao_Paulo',
    }
  );
}

function montarBlocoAcessoHtml({
  usuarioLogin,
  emailPrincipal,
}) {
  const portalUrl = String(
    process.env.PORTAL_CLIENTE_URL ||
    'https://portal.itr.eng.br/login.html'
  ).trim();

  return `
        <div style="margin:28px 0 0;padding-top:24px;border-top:1px solid #eef0f3;">
          <p style="margin:0 0 10px;font-size:15px;line-height:1.5;color:#0f2543;font-weight:700;">
            Acompanhe suas amostras pelo Portal do Cliente ITR
          </p>

          <p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#374151;">
            Acesse o portal para consultar o andamento dos ensaios e acompanhar as atualizações das suas ordens de serviço:
          </p>

          <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">
            <a href="${esc(portalUrl)}" style="color:#0f2543;font-weight:600;text-decoration:underline;">${esc(portalUrl)}</a>
          </p>

          <div style="margin:0 0 20px;padding:14px 16px;background:#f7f8fa;border:1px solid #e6e9ef;border-radius:10px;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#374151;">
              <strong style="color:#0f2543;">CNPJ para acesso:</strong> ${esc(formatarCnpj(usuarioLogin))}
            </p>
          </div>

          <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#0f2543;font-weight:700;">
            Primeiro acesso
          </p>

          <p style="margin:0 0 14px;font-size:13px;line-height:1.65;color:#374151;">
            Utilize seu e-mail cadastrado como senha inicial. No primeiro acesso, o Portal solicitará a criação de uma senha pessoal. Após a definição da nova senha, o e-mail não poderá mais ser utilizado como senha de acesso.
          </p>

          <div style="margin:0;padding:14px 16px;background:#f7f8fa;border:1px solid #e6e9ef;border-radius:10px;">
            <p style="margin:0 0 4px;font-size:12px;line-height:1.5;color:#6b7280;">
              E-mail cadastrado para primeiro acesso:
            </p>
            <p style="margin:0;font-size:13px;line-height:1.5;color:#111827;font-weight:700;word-break:break-word;">
              ${esc(emailPrincipal || '-')}
            </p>
          </div>
        </div>`;
}

function montarBlocoAcessoTexto({
  usuarioLogin,
  emailPrincipal,
}) {
  const portalUrl = String(
    process.env.PORTAL_CLIENTE_URL ||
    'https://portal.itr.eng.br/login.html'
  ).trim();

  return `\n\nAcompanhe suas amostras pelo Portal do Cliente ITR`
    + `\n\nAcesse o portal para consultar o andamento dos ensaios e acompanhar as atualizações das suas ordens de serviço:`
    + `\n${portalUrl}`
    + `\n\nCNPJ para acesso: ${formatarCnpj(usuarioLogin)}`
    + `\n\nPrimeiro acesso`
    + `\nUtilize seu e-mail cadastrado como senha inicial. No primeiro acesso, o Portal solicitará a criação de uma senha pessoal. Após a definição da nova senha, o e-mail não poderá mais ser utilizado como senha de acesso.`
    + `\n\nE-mail cadastrado para primeiro acesso:`
    + `\n${emailPrincipal || '-'}`;
}

function montarEmailDaOS(cliente, ordem, contexto = {}) {
  const nomeCliente = cliente?.clienteNome || 'Cliente';
  const os = ordem?.osNome || 'Ordem de Serviço';
  const usuarioLogin = cliente?.cnpj || '-';

  const emails = obterEmailsCliente(cliente);
  const emailPrincipal = String(
    contexto.emailPrincipal ||
    emailPrincipalDaOrdem(cliente, ordem, emails) ||
    ''
  ).trim();

  const destinatarioEmail = String(
    contexto.destinatarioEmail ||
    emailPrincipal ||
    emails[0] ||
    ''
  ).trim();

  const ehContatoPrincipal = typeof contexto.ehContatoPrincipal === 'boolean'
    ? contexto.ehContatoPrincipal
    : Boolean(
        emailPrincipal &&
        destinatarioEmail &&
        emailPrincipal.toLowerCase() === destinatarioEmail.toLowerCase()
      );

  const dataAlteracoes =
    dataAtualizacaoDaOrdem(ordem);

  const assunto =
    `ITR Engenharia — Atualização da ordem de serviço ${os}`;

  const linhas = Array.isArray(ordem?.linhas)
    ? ordem.linhas
    : [];

  const linhasHtml = linhas
    .map(linhaTabela)
    .join('');

  const blocoAcessoHtml = montarBlocoAcessoHtml({
    usuarioLogin,
    emailPrincipal,
  });

  const blocoAcessoTexto = montarBlocoAcessoTexto({
    usuarioLogin,
    emailPrincipal,
  });

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08);border:1px solid #e6e9ef;">
      <div style="background:#0f2543;padding:26px 28px;text-align:center;">
        <img src="cid:logoITR" alt="ITR Engenharia" width="200"
             style="display:inline-block;max-width:200px;height:auto;" />
      </div>

      <div style="padding:28px;">
        <p style="margin:0 0 16px;font-size:16px;color:#111827;">
          Olá, <strong>${esc(nomeCliente)}</strong>.
        </p>

        <p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#374151;">
          Informamos que foram registradas novas atualizações na ordem de serviço
          <strong style="color:#0f2543;">${esc(os)}</strong>, em ${esc(dataAlteracoes)}.
        </p>

        <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#374151;">
          Confira abaixo os ensaios atualizados:
        </p>

        <table style="width:100%;border-collapse:collapse;border:1px solid #e6e9ef;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#f7f8fa;">
              <th style="padding:11px 14px;text-align:left;font-size:11px;letter-spacing:.04em;color:#8a94a6;text-transform:uppercase;">Amostra</th>
              <th style="padding:11px 14px;text-align:left;font-size:11px;letter-spacing:.04em;color:#8a94a6;text-transform:uppercase;">Ensaios</th>
              <th style="padding:11px 14px;text-align:left;font-size:11px;letter-spacing:.04em;color:#8a94a6;text-transform:uppercase;">Status</th>
            </tr>
          </thead>
          <tbody>${linhasHtml}</tbody>
        </table>

${blocoAcessoHtml}

        <p style="margin:24px 0 0;font-size:14px;line-height:1.65;color:#374151;">
          Permanecemos à disposição para qualquer esclarecimento.
        </p>

        <div style="margin-top:30px;">
          <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#374151;">
            Atenciosamente,
          </p>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#111827;font-weight:700;">
            Equipe ITR Engenharia
          </p>
        </div>

        <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#98a2b3;border-top:1px solid #eef0f3;padding-top:16px;">
          Este é um e-mail automático enviado pela ITR Engenharia — Laboratório de Geotecnia.
        </p>
      </div>
    </div>

    <p style="text-align:center;margin:16px 0 0;font-size:11px;color:#b0b7c3;">
      © ITR Engenharia · Brasília/DF
    </p>
  </div>
</body>
</html>`;

  const texto =
    `ITR Engenharia — Atualização da ordem de serviço ${os}\n\n`
    + `Olá, ${nomeCliente}.\n\n`
    + `Informamos que foram registradas novas atualizações na ordem de serviço ${os}, em ${dataAlteracoes}.\n\n`
    + `Confira abaixo os ensaios atualizados:\n\n`
    + linhas.map(l =>
        `- Amostra ${l.amostra || '-'} | ${l.ensaioNome || l.ensaioSigla || '-'} | ${statusExibido(l.status)}`
      ).join('\n')
    + blocoAcessoTexto
    + `\n\nPermanecemos à disposição para qualquer esclarecimento.`
    + `\n\n\nAtenciosamente,\n\nEquipe ITR Engenharia`;

  return {
    assunto,
    html,
    texto,
    destinatarioEmail,
    emailPrincipal,
    ehContatoPrincipal,
  };
}

function montarEmailsIndividualizados(cliente, ordem) {
  const emailsCliente =
    obterEmailsCliente(cliente);

  const emailsDaOrdem = [];
  const vistosDaOrdem = new Set();

  for (
    const candidato
    of Array.isArray(ordem?.emails)
      ? ordem.emails.flat(Infinity)
      : []
  ) {
    const email = String(
      candidato || ''
    ).trim();

    const chave =
      email.toLowerCase();

    if (
      !emailValidoBasico(email) ||
      vistosDaOrdem.has(chave)
    ) {
      continue;
    }

    vistosDaOrdem.add(chave);
    emailsDaOrdem.push(email);
  }

  const emailPrincipal =
    emailPrincipalDaOrdem(
      cliente,
      ordem,
      emailsCliente
    );

  // Havendo contatos válidos nos records da própria OS, eles formam
  // a lista de destinatários. O perfil global do cliente só é fallback
  // quando nenhum record desta OS possui e-mail válido.
  const fontesDestinatarios =
    emailsDaOrdem.length > 0
      ? [
          emailPrincipal,
          ...emailsDaOrdem,
        ]
      : [
          emailPrincipal,
          ...emailsCliente,
        ];

  const vistos = new Set();
  const emails = [];

  for (const candidato of fontesDestinatarios) {
    const email = String(
      candidato || ''
    ).trim();

    const chave =
      email.toLowerCase();

    if (
      !emailValidoBasico(email) ||
      vistos.has(chave)
    ) {
      continue;
    }

    vistos.add(chave);
    emails.push(email);
  }

  if (emails.length === 0) {
    return [];
  }

  return emails.map(destinatarioEmail => {
    const ehContatoPrincipal =
      Boolean(emailPrincipal) &&
      destinatarioEmail.toLowerCase() ===
        emailPrincipal.toLowerCase();

    return {
      destinatario: destinatarioEmail,
      ehContatoPrincipal,
      ...montarEmailDaOS(
        cliente,
        ordem,
        {
          destinatarioEmail,
          emailPrincipal,
          ehContatoPrincipal,
        }
      ),
    };
  });
}

module.exports = {
  montarEmailDaOS,
  montarEmailsIndividualizados,
  obterEmailsCliente,
  emailPrincipalDoCliente,
  statusExibido,
  STATUS_EXIBICAO,
};
