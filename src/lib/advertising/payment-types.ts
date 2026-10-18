import type { AdvertisingResult } from './database.types';
import type { AdvertisingBillingPage } from './billing-types';

export type AdvertisingPaymentEntrySource = {
  id: string; sequence: string; companyId: string; invoiceId: string;
  invoiceNumber: string; invoiceSourceHash: string; sellerOrganisationNumber: string;
  kind: 'receipt' | 'reversal'; amountOre: string; paymentIdentifier: string;
  bankReference: string; bookedDate: string; reason: string; createdAt: string;
  createdBy: string; reversesEntryId: string | null; replacesEntryId: string | null;
};
export type AdvertisingPaymentEntry = AdvertisingPaymentEntrySource & {
  sourceHash: string; canonicalSnapshot: string; isReversed: boolean; isReplaced: boolean;
};
export type AdvertisingPaymentPage = {
  companyId: string; invoiceId: string; invoiceNumber: string; invoiceSourceHash: string;
  actorUserId: string; actorRole: AdvertisingBillingPage['actorRole']; currency: 'SEK';
  businessDate: string; grossTotalOre: string;
  credit: { id: string; creditNumber: string; sourceHash: string; grossTotalOre: string } | null;
  receivableOre: string; receivedOre: string; outstandingOre: string; surplusOre: string;
  status: 'unpaid' | 'partial' | 'settled' | 'overpaid' | 'credited';
  entries: AdvertisingPaymentEntry[]; nextBeforeSequence: string | null;
  latestSequence: string; entryCount: string; reviewToken: string; canonicalReview: string; canWrite: boolean;
};
export type AdvertisingPaymentScope = { companyId: string; invoiceId: string };
export type AdvertisingPaymentReview = AdvertisingPaymentScope & {
  expectedInvoiceSourceHash: string; expectedReviewToken: string;
  reviewAcknowledged: true; requestId: string;
};
export type AdvertisingPaymentRegistration = AdvertisingPaymentReview & {
  amountOre: string; paymentIdentifier: string; bankReference: string;
  bookedDate: string; reason: string; replacesEntryId: string | null;
  expectedReplacedEntryHash: string | null;
};
export type AdvertisingPaymentReversal = AdvertisingPaymentReview & { entryId: string; reason: string };
export type AdvertisingPaymentReceipt = {
  entryId: string; companyId: string; invoiceId: string; actorUserId: string;
  requestId: string; sourceHash: string; reviewToken: string;
};
export type AdvertisingPaymentPageResult = AdvertisingResult<{ page: AdvertisingPaymentPage }>;
export type AdvertisingPaymentWriteResult = AdvertisingResult<{ entry: AdvertisingPaymentEntry; receipt: AdvertisingPaymentReceipt }>;
export type AdvertisingPaymentLookupResult = AdvertisingResult<{
  companyId: string; invoiceId: string; actorUserId: string; paymentIdentifier: string;
  entry: AdvertisingPaymentEntry | null;
}>;
