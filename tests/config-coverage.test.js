'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function arquivosJs(dir) {
  const resultado = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) resultado.push(...arquivosJs(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) resultado.push(full);
  }
  return resultado;
}

test('.env.example documenta todas as variáveis de ambiente usadas pelo código', () => {
  const usadas = new Set();
  const regexes = [
    /process\.env\.([A-Z0-9_]+)/g,
    /process\.env\[['"]([A-Z0-9_]+)['"]\]/g,
    /(?:textoEnv|booleanoEnv|campoEnv|campoEnvExato)\(\s*['"]([A-Z0-9_]+)['"]/g,
  ];

  for (const arquivo of arquivosJs(root)) {
    const texto = fs.readFileSync(arquivo, 'utf8');
    for (const re of regexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(texto))) usadas.add(m[1]);
    }
  }

  usadas.delete('DOTENV_CONFIG_QUIET');

  const exemplo = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const documentadas = new Set();
  for (const linha of exemplo.split(/\r?\n/)) {
    const m = linha.match(/^([A-Z0-9_]+)=/);
    if (m) documentadas.add(m[1]);
  }

  const faltantes = [...usadas].filter(x => !documentadas.has(x)).sort();
  assert.deepEqual(faltantes, []);
});

test('teste de produção Meta não contém WABA/Phone Number IDs reais hardcoded', () => {
  const fonte = fs.readFileSync(path.join(root, 'teste_template_whatsapp_producao.js'), 'utf8');
  assert.doesNotMatch(fonte, /const\s+WABA_PRODUCAO_ESPERADA\s*=\s*['"]\d{12,}/);
  assert.doesNotMatch(fonte, /const\s+PHONE_NUMBER_ID_ESPERADO\s*=\s*['"]\d{12,}/);
  assert.match(fonte, /WHATSAPP_EXPECTED_WABA_ID/);
  assert.match(fonte, /WHATSAPP_EXPECTED_PHONE_NUMBER_ID/);
});
