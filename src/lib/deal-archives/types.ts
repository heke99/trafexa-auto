export type DealArchivePage = { companyId:string; dealId:string; actorId:string; role:string; version:number; archived:boolean; dealStatus:string; canArchive:boolean; blockedReason:'active_reservation'|'live_contract'|'unsettled_payment'|'deal_unavailable'|null; reviewHash:string };
export type DealArchiveInput = { companyId:string; dealId:string; operation:'archive'|'restore'; expectedVersion:number; reviewHash:string; reason:string; acknowledged:true; requestId:string };
export type DealArchiveResult = {ok:true;page:DealArchivePage}|{ok:false;code:'access_denied'|'conflict'|'invalid_input'|'unavailable';message:string};
export type DealDeletePage={companyId:string;dealId:string;actorId:string;role:string;reviewHash:string;canDelete:boolean;blockedReason:'business_history'|'active_reservation'|'not_draft'|null};
export type DealDeleteInput={companyId:string;dealId:string;reviewHash:string;acknowledged:true;requestId:string};
export type DealDeleteReceipt={companyId:string;dealId:string;actorId:string;deleted:true;requestId:string};
export type DealDeleteResult={ok:true;page:DealDeletePage}|Exclude<DealArchiveResult,{ok:true}>;
export type DealDeleteMutationResult={ok:true;receipt:DealDeleteReceipt}|Exclude<DealArchiveResult,{ok:true}>;
