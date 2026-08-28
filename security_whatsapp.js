'use strict';

require('dotenv').config({ quiet: true });
const { normalizarTelefone, CONFIG: META } = require('./enviar_whatsapp.js');

function textoEnv(nome, padrao = '') { return String(process.env[nome] ?? padrao).trim(); }
function booleanoEnv(nome, padrao = false) {
  const v = textoEnv(nome); if (!v) return padrao;
  return ['1','true','sim','yes','on'].includes(v.toLowerCase());
}

const CONFIG = Object.freeze({
  ativo: booleanoEnv('PORTAL_SECURITY_WHATSAPP_ENABLED', false),
  templateName: textoEnv('WHATSAPP_SECURITY_TEMPLATE_NAME'),
  templateLanguage: textoEnv('WHATSAPP_SECURITY_TEMPLATE_LANGUAGE', 'pt_BR'),
  portalOrigin: textoEnv('PORTAL_ORIGIN', 'https://portal.itr.eng.br').replace(/\/+$/, '')
});

const EVENTOS = Object.freeze({
  FIRST_ACCESS: 'primeiro acesso solicitado',
  PASSWORD_RESET: 'redefinição de senha solicitada',
  PASSWORD_CREATED: 'senha pessoal criada',
  PASSWORD_CHANGED: 'senha alterada'
});

async function enviarAvisoSegurancaWhatsApp({ type, client }) {
  if (!CONFIG.ativo || !META.ativo || META.simular) return { ok: true, ignorado: true, motivo: 'desativado-ou-simulacao' };
  if (!CONFIG.templateName) return { ok: false, ignorado: true, motivo: 'template-nao-configurado' };
  const normalizado = normalizarTelefone(client?.whatsapp);
  if (!normalizado?.ok) return { ok: true, ignorado: true, motivo: 'sem-whatsapp-ou-invalido' };
  const telefone = normalizado.telefone;
  if (!META.accessToken || !META.phoneNumberId) return { ok: false, ignorado: true, motivo: 'meta-nao-configurada' };

  const evento = EVENTOS[type];
  if (!evento) throw new Error('Evento de segurança do WhatsApp inválido.');
  const payload = {
    messaging_product: 'whatsapp', to: telefone, type: 'template',
    template: {
      name: CONFIG.templateName,
      language: { code: CONFIG.templateLanguage },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'cliente', text: String(client?.name || 'Cliente').slice(0, 80) },
          { type: 'text', parameter_name: 'evento', text: evento },
          { type: 'text', parameter_name: 'portal_url', text: `${CONFIG.portalOrigin}/login.html` }
        ]
      }]
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META.timeoutMs || 20000);
  try {
    const resp = await fetch(`${META.graphBaseUrl}/${META.apiVersion}/${META.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal
    });
    let dados = null; try { dados = await resp.json(); } catch (_) {}
    if (!resp.ok) throw new Error(`Meta recusou aviso de segurança (HTTP ${resp.status}).`);
    return { ok: true, id: dados?.messages?.[0]?.id || null };
  } finally { clearTimeout(timer); }
}

module.exports = { enviarAvisoSegurancaWhatsApp, CONFIG };
