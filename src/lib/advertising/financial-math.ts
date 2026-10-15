import { ore } from './billing-validation.ts';
import { parseAdvertisingInvoiceDraft } from './invoice-validation.ts';
import type { AdvertisingInvoiceDraft } from './invoice-types';
import type { AdvertisingFinancialSettingsFields as FinancialSettingsFields } from './financial-types';

import { isValidFinancialPaymentAccount } from './financial-payment.ts';
import { allocateAdvertisingVatV2 } from './vat-allocation.ts';
export { isValidFinancialPaymentAccount } from './financial-payment.ts';

export type AdvertisingFinancialLine = {
  publicationId: string; listingId: string; channel: 'blocket' | 'wayke';
  originalOre: string; reductionOre: string; netOre: string; vatOre: string | null; grossOre: string | null;
};
export type AdvertisingFinancialPreview = {
  lines: AdvertisingFinancialLine[]; netTotalOre: string; vatTotalOre: string | null; grossTotalOre: string | null; blockers: string[];
};

/** Version 1: SEK, VAT rounded half up per net publication row, then summed. */
export function computeAdvertisingFinancialPreview(value: AdvertisingInvoiceDraft, fields: FinancialSettingsFields): AdvertisingFinancialPreview {
  return computeFinancialPreview(value, fields, 1);
}

/** Version 2: VAT rounded on the total net tax base, then allocated deterministically. */
export function computeAdvertisingFinancialPreviewV2(value: AdvertisingInvoiceDraft, fields: FinancialSettingsFields): AdvertisingFinancialPreview {
  return computeFinancialPreview(value, fields, 2);
}

function computeFinancialPreview(value: AdvertisingInvoiceDraft, fields: FinancialSettingsFields, version: 1 | 2): AdvertisingFinancialPreview {
  const draft = parseAdvertisingInvoiceDraft(value, value.companyId, value.id), snapshot = draft.snapshot;
  if (!['unresolved', 'se_standard_25'].includes(fields.vatTreatment) ||
      !['unresolved', 'bankgiro', 'plusgiro', 'iban'].includes(fields.paymentMethod) ||
      fields.sellerVatRegistered !== null && typeof fields.sellerVatRegistered !== 'boolean' ||
      fields.paymentDays !== null && (!Number.isSafeInteger(fields.paymentDays) || fields.paymentDays < 1 || fields.paymentDays > 90)) throw Error('Invalid financial settings');
  const blockers = [
    ...snapshot.buyerProfile.missingFields.map(key => `buyer.${key}`),
    ...snapshot.sellerProfile.missingFields.map(key => `seller.${key}`),
  ];
  const vatNumberMatches = fields.sellerVatNumber !== null && snapshot.sellerProfile.fields.organisationNumber !== null &&
    fields.sellerVatNumber === `SE${snapshot.sellerProfile.fields.organisationNumber}01`;
  const domestic = snapshot.buyerProfile.fields.countryCode === 'SE' && snapshot.sellerProfile.fields.countryCode === 'SE';
  if (fields.vatTreatment === 'unresolved') blockers.push('vatTreatment');
  if (fields.sellerVatRegistered !== true) blockers.push('sellerVatRegistered');
  if (!vatNumberMatches) blockers.push('sellerVatNumber');
  if (!domestic) blockers.push('vat.domesticCountry');
  if (fields.paymentDays === null) blockers.push('paymentDays');
  if (fields.paymentMethod === 'unresolved') blockers.push('paymentMethod');
  if (fields.paymentMethod !== 'unresolved' && !isValidFinancialPaymentAccount(fields.paymentMethod, fields.paymentAccount)) blockers.push('paymentAccount');
  if (typeof fields.reason !== 'string' || fields.reason.trim().length === 0) blockers.push('settings.reason');
  const taxKnown = fields.vatTreatment === 'se_standard_25' && fields.sellerVatRegistered === true && vatNumberMatches && domestic;
  const reductions = new Map<string, bigint>();
  for (const row of snapshot.basis.adjustments) reductions.set(row.publicationId, (reductions.get(row.publicationId) ?? 0n) + BigInt(row.amountOre));
  const lines: AdvertisingFinancialLine[] = snapshot.basis.original!.items.map(item => {
    const originalOre = ore(item.unitPriceOre), reductionOre = ore((reductions.get(item.publicationId) ?? 0n).toString());
    const netOre = ore((BigInt(originalOre) - BigInt(reductionOre)).toString());
    const vatOre = taxKnown && version === 1 ? ore(((BigInt(netOre) * 25n + 50n) / 100n).toString()) : null;
    const grossOre = vatOre === null ? null : ore((BigInt(netOre) + BigInt(vatOre)).toString());
    return { publicationId: item.publicationId, listingId: item.listingId, channel: item.channel, originalOre, reductionOre, netOre, vatOre, grossOre };
  });
  const netTotalOre = ore(lines.reduce((sum, row) => sum + BigInt(row.netOre), 0n).toString());
  if (netTotalOre !== snapshot.basis.netTotalOre) throw Error('Financial net does not match frozen source');
  if (taxKnown && version === 2) {
    const taxes = allocateAdvertisingVatV2(lines);
    for (let index = 0; index < lines.length; index++) {
      lines[index].vatOre = taxes[index];
      lines[index].grossOre = ore((BigInt(lines[index].netOre) + BigInt(taxes[index])).toString());
    }
  }
  const vatTotalOre = taxKnown ? ore(lines.reduce((sum, row) => sum + BigInt(row.vatOre!), 0n).toString()) : null;
  const grossTotalOre = vatTotalOre === null ? null : ore((BigInt(netTotalOre) + BigInt(vatTotalOre)).toString());
  return { lines, netTotalOre, vatTotalOre, grossTotalOre, blockers: [...new Set(blockers)] };
}
