import type {AdvertisingResult} from './database.types';
import type {AdvertisingBillingPage} from './billing-types';
import type {AdvertisingInvoiceSeries,AdvertisingInvoiceSeriesConfiguration,AdvertisingIssuedInvoice,AdvertisingIssuedInvoiceLine} from './issuance-types';
/** Amounts are positive credit magnitudes copied exactly from the original, never recomputed. */
export type AdvertisingCreditInvoiceSnapshot={status:'credited';documentType:'full_credit';direction:'credit';currency:'SEK';rendererVersion:1;companyId:string;originalInvoiceId:string;creditNumber:string;creditDate:string;sequence:string;reason:string;series:AdvertisingInvoiceSeriesConfiguration;originalInvoice:AdvertisingIssuedInvoice;lines:AdvertisingIssuedInvoiceLine[];netTotalOre:string;vatTotalOre:string;grossTotalOre:string};
export type AdvertisingCreditInvoice={id:string;companyId:string;originalInvoiceId:string;createdAt:string;creditNumber:string;creditDate:string;sourceHash:string;canonicalSnapshot:string;snapshot:AdvertisingCreditInvoiceSnapshot};
export type AdvertisingCreditPreview={creditNumber:string;sequence:string;creditDate:string;originalSourceHash:string;seriesReviewToken:string;reviewToken:string;canonicalSnapshot:string};
export type AdvertisingCreditPage={companyId:string;actorUserId:string;actorRole:AdvertisingBillingPage['actorRole'];businessDate:string;currentYear:number;originalInvoice:AdvertisingIssuedInvoice;series:AdvertisingInvoiceSeries|null;credit:AdvertisingCreditInvoice|null;preview:AdvertisingCreditPreview|null;blockers:string[];canConfigureSeries:boolean;canCredit:boolean};
export type AdvertisingCreditPageResult=AdvertisingResult<{page:AdvertisingCreditPage}>;
export type AdvertisingCreditInvoiceResult=AdvertisingResult<{credit:AdvertisingCreditInvoice}>;
export type AdvertisingCreditSeriesReceipt={seriesId:string;companyId:string;actorUserId:string;requestId:string;originalInvoiceId:string;originalSourceHash:string;configurationHash:string};
export type AdvertisingCreditIssueReceipt={creditId:string;companyId:string;actorUserId:string;requestId:string;originalInvoiceId:string;originalSourceHash:string;seriesId:string;sourceHash:string;creditNumber:string;reviewToken:string};
export type AdvertisingCreditSeriesResult=AdvertisingResult<{series:AdvertisingInvoiceSeries;receipt:AdvertisingCreditSeriesReceipt}>;
export type AdvertisingCreditIssueResult=AdvertisingResult<{credit:AdvertisingCreditInvoice;receipt:AdvertisingCreditIssueReceipt}>;
