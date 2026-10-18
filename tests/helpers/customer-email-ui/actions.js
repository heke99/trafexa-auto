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
