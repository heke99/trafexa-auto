import type { AdvertisingResult } from './database.types';
import type { AdvertisingPaymentPage } from './payment-types';

export type AdvertisingPaymentExportInput = {
  companyId: string; invoiceId: string;
  expectedInvoiceSourceHash: string; expectedReviewToken: string;
};
export type AdvertisingPaymentExport = {
  companyId: string; invoiceId: string; actorUserId: string;
  actorRole: AdvertisingPaymentPage['actorRole']; invoiceSourceHash: string;
  reviewToken: string; entryCount: string; fileName: string;
  contentType: 'text/csv;charset=utf-8'; csv: string; sha256: string;
};
export type AdvertisingPaymentExportResult = AdvertisingResult<{ export: AdvertisingPaymentExport }>;
