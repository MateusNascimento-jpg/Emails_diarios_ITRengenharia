// ============================================================
// email_template.js — MONTAGEM DO E-MAIL DIÁRIO
// ============================================================
// Regra de negócio:
// - Uma OS pode gerar um e-mail individual por destinatário.
// - O primeiro e-mail do cliente é o contato principal.
// - Somente o contato principal recebe a credencial inicial legada.
// - Os demais destinatários recebem a mesma atualização da empresa,
//   sem exposição da senha inicial do contato principal.
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

function montarBlocoAcessoHtml({
  usuarioLogin,
  destinatarioEmail,
  emailPrincipal,
  ehContatoPrincipal,
}) {
  if (ehContatoPrincipal) {
    return `
        <div style="margin:14px 0 18px;padding:14px 16px;background:#f7f8fa;border:1px solid #e6e9ef;border-radius:10px;">
          <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#374151;">
            <strong style="color:#0f2543;">CNPJ de acesso:</strong> ${esc(usuarioLogin)}
          </p>
          <p style="margin:0;font-size:13px;line-height:1.5;color:#374151;">
            <strong style="color:#0f2543;">Senha inicial (somente no primeiro acesso):</strong> ${esc(emailPrincipal || destinatarioEmail || '-')}
          </p>
        </div>

        <p style="margin:0 0 16px;font-size:12.5px;line-height:1.6;color:#6b7280;">
          No primeiro acesso, o Portal solicitará a criação de uma senha pessoal. Depois disso, use CNPJ + sua senha pessoal.
        </p>`;
  }

  return `
        <div style="margin:14px 0 18px;padding:14px 16px;background:#f7f8fa;border:1px solid #e6e9ef;border-radius:10px;">
          <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#374151;">
            <strong style="color:#0f2543;">CNPJ do cliente:</strong> ${esc(usuarioLogin)}
          </p>
          <p style="margin:0;font-size:13px;line-height:1.5;color:#374151;">
            <strong style="color:#0f2543;">E-mail destinatário:</strong> ${esc(destinatarioEmail || '-')}
          </p>
        </div>

        <p style="margin:0 0 16px;font-size:12.5px;line-height:1.6;color:#6b7280;">
          Este endereço recebe as mesmas atualizações do cadastro da empresa. O primeiro acesso ao Portal permanece vinculado ao contato principal cadastrado; nenhuma senha inicial é exibida neste e-mail.
        </p>`;
}

function montarBlocoAcessoTexto({
  usuarioLogin,
  destinatarioEmail,
  emailPrincipal,
  ehContatoPrincipal,
}) {
  if (ehContatoPrincipal) {
    return `\n\nCNPJ de acesso: ${usuarioLogin}`
      + `\nSenha inicial (somente no primeiro acesso): ${emailPrincipal || destinatarioEmail || '-'}`
      + `\nNo primeiro acesso, crie sua senha pessoal. Depois disso, use CNPJ + sua senha pessoal.`;
  }

  return `\n\nCNPJ do cliente: ${usuarioLogin}`
    + `\nE-mail destinatário: ${destinatarioEmail || '-'}`
    + `\nEste endereço recebe as mesmas atualizações do cadastro da empresa. O primeiro acesso ao Portal permanece vinculado ao contato principal cadastrado; nenhuma senha inicial é exibida neste e-mail.`;
}

function montarEmailDaOS(cliente, ordem, contexto = {}) {
  const nomeCliente = cliente?.clienteNome || 'Cliente';
  const os = ordem?.osNome || 'Ordem de Serviço';
  const usuarioLogin = cliente?.cnpj || '-';

  const emails = obterEmailsCliente(cliente);
  const emailPrincipal = emailPrincipalDoCliente(cliente, emails);
  const destinatarioEmail = String(
    contexto.destinatarioEmail || emailPrincipal || emails[0] || ''
  ).trim();

  const ehContatoPrincipal = typeof contexto.ehContatoPrincipal === 'boolean'
    ? contexto.ehContatoPrincipal
    : Boolean(
        emailPrincipal &&
        destinatarioEmail &&
        emailPrincipal.toLowerCase() === destinatarioEmail.toLowerCase()
      );

  const dataAlteracoes = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    });

  const assunto = `ITR Engenharia — Atualização nas amostras da ordem de serviço ${os}`;
  const linhas = Array.isArray(ordem?.linhas) ? ordem.linhas : [];
  const linhasHtml = linhas.map(linhaTabela).join('');

  const blocoAcessoHtml = montarBlocoAcessoHtml({
    usuarioLogin,
    destinatarioEmail,
    emailPrincipal,
    ehContatoPrincipal,
  });

  const blocoAcessoTexto = montarBlocoAcessoTexto({
    usuarioLogin,
    destinatarioEmail,
    emailPrincipal,
    ehContatoPrincipal,
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

        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
          Passamos para informar que houve atualizações na ordem de serviço
          <strong style="color:#0f2543;">${esc(os)}</strong> em ${dataAlteracoes}. Seguem as alterações:
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

        <p style="margin:24px 0 4px;font-size:14px;line-height:1.6;color:#374151;">
          Segue link para o acompanhamento de suas amostras:<br>
          <a href="https://portal.itr.eng.br/login.html" style="color:#0f2543;font-weight:600;text-decoration:underline;">https://portal.itr.eng.br/login.html</a>
        </p>

${blocoAcessoHtml}

        <p style="margin:16px 0 4px;font-size:14px;line-height:1.6;color:#374151;">
          Permanecemos à disposição para qualquer esclarecimento.
        </p>

        <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
          Atenciosamente,<br><strong>Equipe ITR Engenharia</strong>
        </p>

        <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#98a2b3;border-top:1px solid #eef0f3;padding-top:16px;">
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

  const texto = `ITR Engenharia — Atualização da ${os}\n\n`
    + `Olá, ${nomeCliente}.\n\n`
    + `Passamos para informar que houve atualizações na ordem de serviço ${os} em ${dataAlteracoes}. Seguem as alterações:\n\n`
    + linhas.map(l =>
        `- Amostra ${l.amostra || '-'} | ${l.ensaioNome || l.ensaioSigla || '-'} | ${statusExibido(l.status)}`
      ).join('\n')
    + `\n\nSegue link para o acompanhamento de suas amostras:\nhttps://portal.itr.eng.br/login.html`
    + blocoAcessoTexto
    + `\n\nAtenciosamente,\nEquipe ITR Engenharia`;

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
  const emails = obterEmailsCliente(cliente);
  const emailPrincipal = emailPrincipalDoCliente(cliente, emails);

  if (emails.length === 0) {
    return [];
  }

  return emails.map(destinatarioEmail => ({
    destinatario: destinatarioEmail,
    ehContatoPrincipal:
      Boolean(emailPrincipal) &&
      destinatarioEmail.toLowerCase() === emailPrincipal.toLowerCase(),
    ...montarEmailDaOS(cliente, ordem, {
      destinatarioEmail,
      emailPrincipal,
      ehContatoPrincipal:
        Boolean(emailPrincipal) &&
        destinatarioEmail.toLowerCase() === emailPrincipal.toLowerCase(),
    }),
  }));
}

module.exports = {
  montarEmailDaOS,
  montarEmailsIndividualizados,
  obterEmailsCliente,
  emailPrincipalDoCliente,
  statusExibido,
  STATUS_EXIBICAO,
};
