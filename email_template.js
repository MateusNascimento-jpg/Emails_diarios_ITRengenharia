// ============================================================
//  email_template.js  -  MONTAGEM DO EMAIL (uma OS = um email) - Montagem de acordo com o Banco da Empresa
// ------------------------------------------------------------

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ------------------------------------------------------------
// DE-PARA de status: nome real no Airtable -> nome exibido no email
// (muda so a exibicao; o filtro da view usa os nomes reais)
// ------------------------------------------------------------
const STATUS_EXIBICAO = {
  'Aguardando Preparação': 'Amostra recebida',
  'Enviado ao Cliente': 'Relatório Pronto',
};

function statusExibido(statusReal) {
  return STATUS_EXIBICAO[statusReal] || statusReal || '-';
}

// cor da pilula conforme o status EXIBIDO
function corDoStatus(statusExib) {
  const s = (statusExib || '').toLowerCase();

  if (s.includes('relatório pronto') || s.includes('relatorio pronto')) {
    return { fundo: '#dcfce7', texto: '#166534' }; // verde
  }

  if (s.includes('amostra recebida')) {
    return { fundo: '#dbeafe', texto: '#1e40af' }; // azul
  }

  if (s.includes('andamento')) {
    return { fundo: '#fef3c7', texto: '#92400e' }; // laranja
  }

  return { fundo: '#f3f4f6', texto: '#374151' }; // cinza (fallback)
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

// ------------------------------------------------------------
// montarEmailDaOS(cliente, ordem)
// ------------------------------------------------------------
function montarEmailDaOS(cliente, ordem) {
  const nomeCliente = cliente.clienteNome || 'Cliente';
  const os = ordem.osNome || 'Ordem de Serviço';

  // Dados de acesso ao portal
  // Regra atual pedida:
  // Usuario de login = CNPJ
  // Senha de login do portal = Email Cliente
  const usuarioLogin = cliente.cnpj || '-';
  const senhaLoginPortal = cliente.email || '-';

  // data das alteracoes = ONTEM (o email de manha reporta o dia anterior),
  // formatada por extenso no fuso de Brasilia. Ex: "07 de julho de 2026"
  const dataAlteracoes = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    });

  const assunto = `ITR Engenharia — Atualização nas amostras da ordem de serviço ${os}`;
  const linhasHtml = ordem.linhas.map(linhaTabela).join('');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08);border:1px solid #e6e9ef;">

      <!-- CABECALHO azul marinho escuro com logo -->
      <div style="background:#0f2543;padding:26px 28px;text-align:center;">
        <img src="cid:logoITR" alt="ITR Engenharia" width="200"
             style="display:inline-block;max-width:200px;height:auto;" />
      </div>

      <!-- CORPO -->
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

        <div style="margin:14px 0 18px;padding:14px 16px;background:#f7f8fa;border:1px solid #e6e9ef;border-radius:10px;">
          <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#374151;">
            <strong style="color:#0f2543;">Usuário de login:</strong> ${esc(usuarioLogin)}
          </p>
          <p style="margin:0;font-size:13px;line-height:1.5;color:#374151;">
            <strong style="color:#0f2543;">Senha de login do portal:</strong> ${esc(senhaLoginPortal)}
          </p>
        </div>

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
    + ordem.linhas.map(l =>
        `- Amostra ${l.amostra || '-'} | ${l.ensaioNome || l.ensaioSigla || '-'} | ${statusExibido(l.status)}`
      ).join('\n')
    + `\n\nSegue link para o acompanhamento de suas amostras:\nhttps://portal.itr.eng.br/login.html`
    + `\n\nUsuário de login: ${usuarioLogin}`
    + `\nSenha de login do portal: ${senhaLoginPortal}`
    + `\n\nAtenciosamente,\nEquipe ITR Engenharia`;

  return { assunto, html, texto };
}

module.exports = {
  montarEmailDaOS,
  statusExibido,
  STATUS_EXIBICAO,
};