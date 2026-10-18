import type {AdvertisingResult} from './database.types';
export type AdvertisingReceivablesStatus='unpaid'|'partial'|'settled'|'overpaid'|'credited';
export type AdvertisingReceivablesFilter='all'|AdvertisingReceivablesStatus|'overdue';
export type AdvertisingReceivablesCursor={filter:AdvertisingReceivablesFilter;createdAt:string;id:string;actorUserId:string};
export type AdvertisingReceivablesItem={companyId:string;companyLabel:string;companyStatus:'active'|'suspended';buyerLegalName:string;buyerOrganisationNumber:string;sellerOrganisationNumber:string;invoiceId:string;invoiceSourceHash:string;invoiceNumber:string;month:string;createdAt:string;invoiceDate:string;dueDate:string;grossTotalOre:string;credit:{id:string;creditNumber:string;sourceHash:string;grossTotalOre:string}|null;receivableOre:string;receivedOre:string;outstandingOre:string;surplusOre:string;status:AdvertisingReceivablesStatus;isOverdue:boolean};
export type AdvertisingReceivablesSummary={totalCount:string;counts:Record<AdvertisingReceivablesStatus,string>;overdueCount:string;grossTotalOre:string;creditTotalOre:string;receivableOre:string;receivedOre:string;outstandingOre:string;surplusOre:string;overdueOutstandingOre:string};
export type AdvertisingReceivablesPage={actorUserId:string;actorRole:'platform_admin';filter:AdvertisingReceivablesFilter;generatedAt:string;businessDate:string;summary:AdvertisingReceivablesSummary;filteredCount:string;items:AdvertisingReceivablesItem[];nextCursor:AdvertisingReceivablesCursor|null};
export type AdvertisingReceivablesInput={filter:AdvertisingReceivablesFilter;cursor:AdvertisingReceivablesCursor|null};
export type AdvertisingReceivablesResult=AdvertisingResult<{page:AdvertisingReceivablesPage}>;
