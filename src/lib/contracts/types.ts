import type{OfferSnapshot}from'@/lib/documents/offer-pdf';
export const CONTRACT_PLACEHOLDERS=['company.name','company.organisation_number','customer.name','customer.email','vehicle.registration','vehicle.make','vehicle.model','vehicle.model_year','offer.version','offer.price_ore','trade_in.value_ore','trade_in.amount_to_pay_ore']as const;
export type ContractTemplateVersion={id:string;companyId:string;templateId:string;version:number;title:string;body:string;status:'draft'|'approved'|'retired';approvalVersion:number;createdAt:string;approvedAt:string|null;actorLabel:'Du'|'Kollega'};
export type ContractDraft={id:string;companyId:string;dealId:string;version:number;offerId:string|null;offerVersion:number;sourceKind?:'direct_deal';customerIdentity?:{kind:'person'|'business';number:string};template:{id:string;templateId:string;version:number;approvalVersion:number;title:string;body:string};sourceOffer:OfferSnapshot;createdAt:string;actorLabel:'Du'|'Kollega'};
export type ContractTemplatePage={companyId:string;templates:ContractTemplateVersion[];businessDate:string;nextBeforeTemplateId:string|null};
export type DealContractPage={companyId:string;dealId:string;acceptedOffer:{id:string;version:number;snapshot:OfferSnapshot}|null;templates:ContractTemplateVersion[];drafts:ContractDraft[];canCreate:boolean;latestVersion:number;nextBeforeDraftVersion:number|null;nextBeforeTemplateId:string|null};
export type ContractResult<T>=({ok:true}&T)|{ok:false;code:'unauthenticated'|'access_denied'|'invalid_input'|'conflict'|'unavailable';message:string};

/** Canonical extension is opt-in; historical offer-backed hashes stay byte-identical. */
export function contractDraftContent(d:ContractDraft){return{offerVersion:d.offerVersion,template:d.template,sourceOffer:d.sourceOffer,...(d.sourceKind==='direct_deal'?{sourceKind:'direct_deal',customerIdentity:d.customerIdentity}:{})};}
