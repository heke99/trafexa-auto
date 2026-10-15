import type { AdvertisingFinancialSettingsFields as FinancialSettingsFields } from './financial-types';

/** Canonical format/checksum only; this does not verify registration or account ownership. */
export function isValidFinancialPaymentAccount(method: FinancialSettingsFields['paymentMethod'], account: string | null): boolean {
  if (typeof account !== 'string') return false;
  if (method === 'iban') {
    if (!/^SE[0-9]{22}$/.test(account)) return false;
    let remainder = 0;
    for (const character of account.slice(4) + account.slice(0, 4)) {
      const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
      for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder === 1;
  }
  if (method !== 'bankgiro' && method !== 'plusgiro') return false;
  if (!(method === 'bankgiro' ? /^[0-9]{7,8}$/ : /^[0-9]{2,8}$/).test(account) || /^0+$/.test(account)) return false;
  let sum = 0;
  for (let index = account.length - 1, position = 0; index >= 0; index--, position++) {
    const digit = Number(account[index]) * (position % 2 === 1 ? 2 : 1);
    sum += digit > 9 ? digit - 9 : digit;
  }
  return sum % 10 === 0;
}
