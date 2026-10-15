import {createHash} from 'node:crypto';

export const archiveId = number => `ab170000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const ARCHIVE_COMPANY = archiveId(1);
export const ARCHIVE_DEALER = archiveId(2);
export const ARCHIVE_CUSTOMER = archiveId(3);
export const ARCHIVE_REQUEST = archiveId(4);
export const ARCHIVE_SIGNING = archiveId(5);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Synthetic SQL-shaped source; the action's actual parser removes createdBy. */
export function completedArchiveSource() {
  const sourceOffer = {
    schema_version: 1, document_type: 'offer', version: 1, deal_id: archiveId(6),
    issued_at: '2026-10-14T10:00:00Z', valid_until: '2026-11-12',
    terms: 'Originalvillkor för det syntetiska arkivprovet.', currency: 'SEK',
    price_basis: 'gross', sale_price_ore: '19900029',
    company: {id: ARCHIVE_COMPANY, name: 'Fiktiv arkivbil AB', organisation_number: '5560000001'},
    customer: {id: archiveId(7), kind: 'person', name: 'Fiktiv kund', email: 'archive-customer@example.invalid', phone: null, address: null},
    stock: {id: archiveId(8), vat_scheme: 'standard'},
    vehicle: {id: archiveId(9), registration_number: 'ARK123', vin: null, make: 'Volvo', model: 'V60', model_year: 2022, mileage_km: 48000, fuel: 'hybrid', gearbox: 'automatic'},
    vat: {rate_percent: 25, amount_ore: '3980006', net_price_ore: '15920023'},
  };
  const draft = {
    id: archiveId(10), companyId: ARCHIVE_COMPANY, dealId: sourceOffer.deal_id,
    version: 1, offerId: archiveId(11), offerVersion: 1,
    template: {id: archiveId(12), templateId: archiveId(13), version: 1, approvalVersion: 2, title: 'Fiktivt köpeavtal', body: 'Säljare {{company.name}}. Kund {{customer.name}}. Fordon {{vehicle.registration}}. Pris {{offer.price_ore}}.'},
    sourceOffer, createdAt: '2026-10-15T10:00:00Z', createdBy: ARCHIVE_DEALER,
  };
  const canonicalContent = JSON.stringify({draftId: draft.id, companyId: draft.companyId, dealId: draft.dealId, draftVersion: draft.version, content: {offerVersion: draft.offerVersion, template: draft.template, sourceOffer}});
  const documentHash = digest(canonicalContent);
  const receipt = party => ({
    party, fullName: party === 'customer' ? 'Fiktiv kund' : 'Fiktiv handlare',
    signedAt: party === 'customer' ? '2026-10-15T10:02:00Z' : '2026-10-15T10:03:00Z',
    documentHash, consentVersion: '2026-10-14',
    strokes: [{points: [{x: 0, y: 0}, {x: 20, y: 30}, {x: 40, y: 0}, {x: 60, y: 30}]}],
  });
  return {
    id: ARCHIVE_SIGNING, companyId: draft.companyId, dealId: draft.dealId,
    draftId: draft.id, draftVersion: draft.version, documentHash, canonicalContent, draft,
    customerEmail: sourceOffer.customer.email, status: 'completed', revision: 3,
    createdAt: '2026-10-15T10:01:00Z', completedAt: '2026-10-15T10:03:00Z',
    customerSignature: receipt('customer'), companySignature: receipt('company'),
    canSign: false, party: 'company',
  };
}
