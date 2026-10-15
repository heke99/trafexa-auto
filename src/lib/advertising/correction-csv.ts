import { BILLING_MONTH, BILLING_UUID } from './billing-validation.ts';
import { parseAdvertisingCorrectionsPage } from './correction-validation.ts';
import type { AdvertisingCorrectionsPage } from './correction-types';

// Quoting alone does not prevent a spreadsheet from executing a reason as a formula.
function cell(value: string | number) {
  const text = String(value);
  const safe = /^\s*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** A separate corrected accounting basis; the locked original remains unchanged. */
export function generateAdvertisingCorrectionsCsv(value: unknown) {
  if (!value || typeof value !== 'object') throw Error('Invalid report');
  const raw = value as AdvertisingCorrectionsPage;
  if (typeof raw.companyId !== 'string' || !BILLING_UUID.test(raw.companyId) ||
      typeof raw.actorUserId !== 'string' || !BILLING_UUID.test(raw.actorUserId) ||
      typeof raw.month !== 'string' || !BILLING_MONTH.test(raw.month) ||
      !['platform_admin', 'owner', 'admin', 'finance'].includes(raw.actorRole)) throw Error('Invalid report scope');
  const page = parseAdvertisingCorrectionsPage(value, raw.companyId, raw.month, raw.actorUserId, raw.actorRole);
  const original = page.original;
  if (!original) throw Error('Billing period is not locked');
  const rows: (string | number)[][] = [
    ['Rättat annonsunderlag', 'Underlag inför fakturering — ingen faktura eller kreditfaktura'],
    ['Företags-ID', page.companyId], ['Månad', page.month], ['Tidszon', 'Europe/Stockholm'],
    ['Period från (inklusive)', original.periodStart], ['Period till (exklusive)', original.periodEnd],
    ['Originalets underlags-ID', original.id], ['Originalet låst', original.lockedAt],
    ['Originalets SHA-256', original.reviewToken], ['Rättelseunderlagets SHA-256', page.reviewToken],
    ['Registrering startade', original.trackingStartedAt],
    ['Täckning', original.coverage === 'full' ? 'Hela perioden' : 'Del av perioden — uttryckligen granskad'],
    ['Äldre publicerade jobb som inte ingår', original.legacyPublishedJobs],
    ['Valuta', 'SEK'], ['Belopp', 'Exklusive moms'], [],
    ['Publicerings-ID', 'Annons-ID', 'Kanal', 'Registrerad publicering', 'Antal', 'Originalbelopp i öre', 'Nedsättning i öre', 'Återstående belopp i öre'],
  ];
  for (const item of original.items) {
    if (item.unitPriceOre === null) throw Error('Unpriced original');
    const reduction = page.adjustments.filter(row => row.publicationId === item.publicationId)
      .reduce((sum, row) => sum + BigInt(row.amountOre), 0n);
    rows.push([item.publicationId, item.listingId, item.channel === 'blocket' ? 'Blocket' : 'Wayke',
      item.publishedAt, 1, item.unitPriceOre, reduction.toString(), (BigInt(item.unitPriceOre) - reduction).toString()]);
  }
  rows.push(['Totalt', '', '', '', original.count, original.totalOre, page.reductionTotalOre, page.netTotalOre!], [],
    ['Rättelse-ID', 'Publicerings-ID', 'Nedsättning i öre', 'Motivering', 'Registrerad', 'Registrerad av']);
  for (const row of page.adjustments) rows.push([row.id, row.publicationId, row.amountOre, row.reason, row.createdAt, row.createdBy]);
  rows.push([], ['Originalrader och antal bevaras även när återstående belopp är noll.'],
    ['Senare rättelser ger en ny version av detta underlag. Kontrollsumman anger exporterad version.']);
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
}
