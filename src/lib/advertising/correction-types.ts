import type { AdvertisingResult } from './database.types';
import type { AdvertisingBillingLock, AdvertisingBillingPage } from './billing-types';
export type AdvertisingReduction = {id:string;publicationId:string;amountOre:string;reason:string;createdAt:string;createdBy:'Superadmin'};
export type AdvertisingCorrectionsPage = {companyId:string;actorUserId:string;actorRole:AdvertisingBillingPage['actorRole'];month:string;original:AdvertisingBillingLock|null;adjustments:AdvertisingReduction[];reductionTotalOre:string;netTotalOre:string|null;reviewToken:string;canonicalSnapshot:string};
export type AdvertisingReductionReceipt = {id:string;companyId:string;actorUserId:string;requestId:string;lockId:string;publicationId:string;amountOre:string;reason:string};
export type AdvertisingCorrectionsResult = AdvertisingResult<{page:AdvertisingCorrectionsPage}>;
export type AdvertisingReductionResult = AdvertisingResult<{page:AdvertisingCorrectionsPage;receipt:AdvertisingReductionReceipt}>;
