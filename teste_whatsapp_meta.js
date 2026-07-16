//Teste isolado do envio de mensagem de WhatsApp (Verificação completa da funcoinalidade das variáveis) 

require("dotenv").config();

function somenteDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

async function executarTeste() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const destinatario = somenteDigitos(process.env.WHATSAPP_TEST_NUMBER);
  const versaoApi = process.env.WHATSAPP_API_VERSION || "v25.0";

  const ausentes = [];

  if (!token) ausentes.push("WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId) ausentes.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!destinatario) ausentes.push("WHATSAPP_TEST_NUMBER");

  if (ausentes.length > 0) {
    throw new Error(
      `Variáveis ausentes no .env: ${ausentes.join(", ")}`
    );
  }

  const endpoint =
    `https://graph.facebook.com/${versaoApi}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: destinatario,
    type: "template",
    template: {
      name: "hello_world",
      language: {
        code: "en_US"
      }
    }
  };

  console.log("Enviando teste isolado para a Meta...");
  console.log(`Destinatário final: ${destinatario}`);
  console.log(`Template: ${payload.template.name}`);

  const resposta = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const resultado = await resposta.json();

  if (!resposta.ok) {
    const mensagemMeta =
      resultado?.error?.message || JSON.stringify(resultado);

    const erro = new Error(
      `A Meta recusou a requisição: ${mensagemMeta}`
    );

    erro.status = resposta.status;
    erro.codigoMeta = resultado?.error?.code;
    erro.subcodigoMeta = resultado?.error?.error_subcode;

    throw erro;
  }

  const messageId = resultado?.messages?.[0]?.id;

  console.log("");
  console.log("✅ Mensagem aceita pela Meta.");
  console.log(`Message ID: ${messageId || "não informado"}`);
  console.log("Confira o WhatsApp do número destinatário.");
}

executarTeste().catch((erro) => {
  console.error("");
  console.error("❌ Falha no teste do WhatsApp.");
  console.error(`Mensagem: ${erro.message}`);

  if (erro.status) {
    console.error(`HTTP status: ${erro.status}`);
  }

  if (erro.codigoMeta) {
    console.error(`Código Meta: ${erro.codigoMeta}`);
  }

  if (erro.subcodigoMeta) {
    console.error(`Subcódigo Meta: ${erro.subcodigoMeta}`);
  }

  process.exitCode = 1;
});