'use strict';

// ============================================================
// lib/telefone.js — NORMALIZAÇÃO ÚNICA DE TELEFONES
// ============================================================
//
// Regras:
// - "+" ou "00" indicam número já internacional e nunca recebem
//   o código de país padrão automaticamente;
// - números nacionais brasileiros com DDD (10/11 dígitos) recebem 55;
// - números nacionais sem DDD (8/9 dígitos) são rejeitados;
// - número internacional sem "+" ou "00" só é aceito quando já começa
//   explicitamente com o código de país padrão;
// - formato final segue E.164 plausível: 8 a 15 dígitos, primeiro != 0.
//
// A Meta continua sendo a autoridade final sobre a existência do destino.
// ============================================================

function texto(valor) {
  return String(valor ?? '').trim();
}

function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

function normalizarTelefoneE164(
  valor,
  codigoPaisPadrao = '55'
) {
  const original = texto(valor);
  const codigoPais = somenteDigitos(codigoPaisPadrao);

  if (!original) {
    return {
      ok: false,
      motivo: 'telefone-vazio',
      original,
      telefone: '',
    };
  }

  let internacional =
    original.startsWith('+');

  let digitos =
    somenteDigitos(original);

  if (digitos.startsWith('00')) {
    digitos = digitos.slice(2);
    internacional = true;
  }

  // Aceita o zero de tronco nacional, ex.: 0 61 99999-9999.
  if (
    !internacional &&
    digitos.startsWith('0') &&
    (digitos.length === 11 || digitos.length === 12)
  ) {
    const semZero = digitos.slice(1);

    if (
      semZero.length === 10 ||
      semZero.length === 11
    ) {
      digitos = semZero;
    }
  }

  // Aceita 55 0 DDD número inclusive quando veio como +55 0...
  if (
    codigoPais === '55' &&
    digitos.startsWith('550') &&
    (digitos.length === 13 || digitos.length === 14)
  ) {
    digitos = `55${digitos.slice(3)}`;
  }

  // DDD + telefone brasileiro (fixo ou móvel).
  if (
    !internacional &&
    codigoPais &&
    (
      digitos.length === 10 ||
      digitos.length === 11
    )
  ) {
    digitos =
      `${codigoPais}${digitos}`;
  }

  // Sem "+" ou "00", não adivinha país estrangeiro e não aceita
  // números nacionais sem DDD.
  if (
    !internacional &&
    codigoPais &&
    !digitos.startsWith(codigoPais)
  ) {
    return {
      ok: false,
      motivo: 'telefone-sem-ddd-ou-pais',
      original,
      telefone: digitos,
    };
  }

  if (
    !/^[1-9]\d{7,14}$/.test(
      digitos
    )
  ) {
    return {
      ok: false,
      motivo: 'telefone-invalido',
      original,
      telefone: digitos,
    };
  }

  // Para números brasileiros sem marcador internacional, exige 55 + DDD
  // + telefone fixo/móvel (12 ou 13 dígitos).
  if (
    !internacional &&
    codigoPais === '55' &&
    digitos.startsWith('55') &&
    ![12, 13].includes(digitos.length)
  ) {
    return {
      ok: false,
      motivo: 'telefone-sem-ddd-ou-pais',
      original,
      telefone: digitos,
    };
  }

  return {
    ok: true,
    motivo: '',
    original,
    telefone: digitos,
  };
}

module.exports = {
  normalizarTelefoneE164,
  somenteDigitos,
};
