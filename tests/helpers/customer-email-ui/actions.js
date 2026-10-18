// Existing isolated fixtures use about:blank, whose native storage is opaque.
// Model a normal same-origin browser session; production code is never imported here.
if (typeof window !== 'undefined' && window.origin === 'null') {
 const entries = new Map();
 Object.defineProperty(window, 'sessionStorage', {configurable:true,value:{getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)}});
}
// Browser-only transport fixture. No provider call or production action is imported.
function current(input, response) {
  if (response && !response.ok) return response;
  const source=response?.delivery??{};
  return {ok:true,delivery:{...input,actorUserId:window.customerEmailActor?.userId,actorRole:window.customerEmailActor?.role,recipientEmail:'anna@example.com',status:'pending',transport:'paused',...source,referenceId:source.referenceId??source.signingId??input.referenceId,kind:source.kind??input.kind}};
}
export async function getCustomerEmailDeliveryAction(input){
  const f=window.fixture; (f.customerEmailCalls??=[]).push({kind:'read',input});
  const response=f.customerEmailReads?.shift()??f.deliveryByKind?.[input.kind]??f.deliveryResponses?.shift()??f.deliveryResponse;
  if(response?.throw)throw Error('Customer email read unavailable');
  if(response?.hold)return new Promise(resolve=>{f.releaseCustomerEmailRead=resolve;});
  return f.denied?{ok:false,code:'access_denied',message:'Åtkomst nekad'}:current(input,response);
}
export async function retryCustomerEmailAction(input){
  const f=window.fixture;(f.customerEmailCalls??=[]).push({kind:'retry',input});
  const response=f.customerEmailRetries?.shift();
  if(response?.throw)throw Error('Customer retry outcome unknown');
  if(response?.hold)return new Promise(resolve=>{f.releaseCustomerEmailRetry=resolve;});
  return current(input,response??{ok:true,delivery:{status:'accepted',transport:'configured'}});
}

function renewalReview(input, response) {
  if (response && !response.ok) return response;
  return {ok:true,review:{...input,actorUserId:window.customerEmailActor?.userId,actorRole:window.customerEmailActor?.role,recipientEmail:'anna@example.com',documentHash:'a'.repeat(64),documentVersion:2,emailId:'email-1',generation:0,status:'accepted',invitationId:'invitation-1',expiresAt:null,canWrite:true,canRenew:false,transport:'configured',...response?.review}};
}
export async function getGuestInvitationRenewalReviewAction(input){
 const f=window.fixture;(f.renewalCalls??=[]).push({kind:'read',input,actorUserId:window.customerEmailActor?.userId});
 const response=f.renewalReads?.shift()??f.renewalReview;
 if(response?.throw)throw Error('Review unavailable');
 if(response?.hold)return new Promise(resolve=>{f.releaseRenewalRead=resolve;});
 return renewalReview(input,response);
}
export async function renewGuestDocumentInvitationAction(input){
 const f=window.fixture;(f.renewalCalls??=[]).push({kind:'renew',input});
 const response=f.renewalResults?.shift();
 if(response?.throw)throw Error('Renewal unknown');
 if(response?.hold)return new Promise(resolve=>{f.releaseRenewal=resolve;});
 if(response && !response.ok)return response;
 return {ok:true,renewal:{...input,actorUserId:window.customerEmailActor?.userId,actorRole:window.customerEmailActor?.role,emailId:'email-2',generation:input.expectedGeneration+1,recipientEmail:'anna@example.com',documentHash:input.expectedDocumentHash,documentVersion:2,dispatchStatus:'accepted',...response?.renewal}};
}
