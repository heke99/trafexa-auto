const f=()=>window.fixture;
async function respond(queue,fallback){const next=queue.shift();if(next?.throw)throw Error('unknown');if(next?.delay)await new Promise(r=>setTimeout(r,next.delay));return next?.result||next||fallback();}
export async function listDealTradeInsAction(input){f().reads.push(input);return respond(f().readResponses,()=>({ok:true,companyId:input.companyId,dealId:input.dealId,salePriceOre:f().salePriceOre,customerName:f().customerName,latestVersion:f().latestVersion,canCreate:f().canCreate,versions:f().versions,nextBeforeVersion:f().cursor}));}
export async function createTradeInVersionAction(input){f().writes.push(input);return respond(f().writeResponses,()=>({ok:true,tradeIn:f().versions[0]}));}
