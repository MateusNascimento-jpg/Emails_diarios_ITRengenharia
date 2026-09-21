'use strict';

function emailAcessoValido(valor) {
  const v = String(valor || '').trim().toLowerCase();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

function actionUrlValida(type, valor, portalOrigin) {
  if (!['FIRST_ACCESS', 'PASSWORD_RESET'].includes(type)) {
    return valor == null || valor === '';
  }

  try {
    const u = new URL(String(valor || ''));
    const origem = new URL(String(portalOrigin || ''));

    const caminhoEsperado =
      type === 'FIRST_ACCESS'
        ? '/criar-senha.html'
        : '/redefinir-senha.html';

    return (
      u.protocol === 'https:' &&
      u.origin === origem.origin &&
      u.pathname === caminhoEsperado &&
      Boolean(u.hash)
    );
  } catch (_) {
    return false;
  }
}

module.exports = { emailAcessoValido, actionUrlValida };
