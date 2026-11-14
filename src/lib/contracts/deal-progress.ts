export type DealContractProgress = {
 status:'none'|'draft'|'pending'|'completed'|'unavailable'; source:'native'|'uploaded_pdf'|null;
 companySigned:boolean;customerSigned:boolean;signedAt:string|null;
 invitationStatus:'none'|'queued'|'active'|'expired'|'revoked'|'unavailable'|'completed';
};
const statuses=['none','draft','pending','completed','unavailable'],invitations=['none','queued','active','expired','revoked','unavailable','completed'];
/** Minimal contract state only; never pass signing capabilities or personal data. */
export function parseDealContractProgress(value:unknown):DealContractProgress{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid contract progress');
 const v=value as Record<string,unknown>,keys=['status','source','companySigned','customerSigned','signedAt','invitationStatus'];
 if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k))||typeof v.status!=='string'||!statuses.includes(v.status)||![null,'native','uploaded_pdf'].includes(v.source as string|null)||typeof v.companySigned!=='boolean'||typeof v.customerSigned!=='boolean'||typeof v.invitationStatus!=='string'||!invitations.includes(v.invitationStatus))throw Error('Invalid contract progress');
 if(v.status==='none'?(v.source!==null||v.companySigned||v.customerSigned||v.signedAt!==null||v.invitationStatus!=='none'):v.source===null)throw Error('Invalid contract progress source');
 if(v.status==='completed'){
  if(!v.companySigned||!v.customerSigned||v.invitationStatus!=='completed'||typeof v.signedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v.signedAt)||!Number.isFinite(Date.parse(v.signedAt)))throw Error('Invalid contract completion');
  const date=v.signedAt.slice(0,10);if(new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('Invalid completion date');
 }else if(v.signedAt!==null)throw Error('Invalid unsigned completion date');
 return v as DealContractProgress;
}
