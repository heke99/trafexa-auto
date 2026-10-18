import { LEGAL_POLICY_VERSION } from '../privacy/policy-version.ts';
import type { WebApplicationSeeking } from './database.types';

export const APPLICATION_PRIVACY_VERSION = LEGAL_POLICY_VERSION;
export const APPLICATION_SEEKING = ['system', 'purchase_finance', 'stock_finance', 'dealer_network', 'advertising', 'other'] as const;
export const APPLICATION_SEEKING_LABELS: Record<WebApplicationSeeking, string> = { system: 'Affärssystem', purchase_finance: 'Köpfinansiering', stock_finance: 'Lagerfinansiering', dealer_network: 'Handlarnätverk', advertising: 'Annonsering', other: 'Annat' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export function normalizeApplicationOrganisationNumber(value: string): string {
  let digits = value.trim().replace(/[-\s]/g, '');
  if (/^16\d{10}$/.test(digits)) digits = digits.slice(2);
  if (!/^\d{10}$/.test(digits)) throw new Error('Ange ett giltigt svenskt organisationsnummer.');
  const sum = [...digits].reduce((total, digit, index) => { const product = Number(digit) * (index % 2 === 0 ? 2 : 1); return total + (product > 9 ? product - 9 : product); }, 0);
  if (sum % 10 !== 0 || /^0{10}$/.test(digits)) throw new Error('Kontrollera organisationsnumrets kontrollsiffra.');
  return digits;
}
export function validateWebApplication(value: Record<string, unknown>, options: { allowHistoricalReplay?: boolean } = {}) {
  const privacyVersion = value.privacyVersion;
  const recognizedVersion = typeof privacyVersion === 'string' && /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(privacyVersion) && privacyVersion <= APPLICATION_PRIVACY_VERSION;
  if (typeof value.requestId !== 'string' || !(privacyVersion === APPLICATION_PRIVACY_VERSION || options.allowHistoricalReplay === true && recognizedVersion)) throw new Error('Formuläret har uppdaterats. Läs in sidan igen innan du skickar ansökan.');
  const keys = ['requestId', 'name', 'email', 'company', 'phone', 'organisationNumber', 'seeking', 'message', 'privacyVersion', 'privacyAcknowledged', 'website'];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Kontrollera formulärets uppgifter.');
  const text = (key: string, minimum: number, maximum: number, multiline = false) => {
    const input = value[key];
    if (typeof input !== 'string' || input.length > maximum || CONTROLS.test(input) || !multiline && /[\r\n\t]/.test(input)) throw new Error('Kontrollera formulärets textuppgifter.');
    const clean = input.trim();
    if (clean.length < minimum) throw new Error('Fyll i alla obligatoriska uppgifter.');
    return clean;
  };
  const requestId = text('requestId', 36, 36).toLowerCase();
  if (!UUID.test(requestId)) throw new Error('Läs in formuläret igen och försök på nytt.');
  const name = text('name', 2, 160), company = text('company', 2, 160), email = text('email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ange en giltig e-postadress.');
  const phone = text('phone', 7, 40);
  if (!/^\+?[0-9 ()-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) throw new Error('Ange ett giltigt telefonnummer.');
  const organisationNumber = normalizeApplicationOrganisationNumber(text('organisationNumber', 10, 30));
  const seeking = value.seeking;
  if (!Array.isArray(seeking) || seeking.length < 1 || seeking.length > APPLICATION_SEEKING.length || new Set(seeking).size !== seeking.length || seeking.some(item => typeof item !== 'string' || !APPLICATION_SEEKING.includes(item as WebApplicationSeeking))) throw new Error('Välj vad företaget söker.');
  const message = text('message', 2, 2000, true);
  if (value.privacyAcknowledged !== true) throw new Error('Läs integritetsinformationen och bekräfta att du har tagit del av den.');
  if (value.website !== undefined && (typeof value.website !== 'string' || value.website !== '')) throw new Error('Formuläret kunde inte godkännas.');
  return { requestId, name, email, company, phone, organisationNumber, seeking: (seeking as WebApplicationSeeking[]).slice().sort(), message, privacyVersion: privacyVersion as string, privacyAcknowledged: true };
}
