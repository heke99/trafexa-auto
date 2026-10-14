const fixture = () => window.fixture;
async function take(kind,input,normal) { const f=fixture();f.calls.push({kind,input});const next=f.responses[kind]?.shift();if(next?.throw)throw Error('network');if(next?.defer)return new Promise(resolve=>{f.release=()=>resolve(next.result);});return next||normal(); }
export const listDealOfferReviewsAction = input => take('dealerList',input,()=>({ok:true,companyId:input.companyId,reviews:fixture().reviews,latestOffer:fixture().latestOffer}));
export const listMyOfferReviewsAction = input => take('customerList',input,()=>({ok:true,reviews:fixture().reviews,nextPageKey:fixture().cursor||null}));
export const publishOfferReviewAction = input => take('publish',input,()=>{const review={...fixture().review,status:'pending'};fixture().reviews=[review];return {ok:true,review};});
export const withdrawOfferReviewAction = input => take('withdraw',input,()=>{const review={...fixture().review,status:'withdrawn',reason:input.reason};fixture().reviews=[review];return {ok:true,review};});
export const respondOfferReviewAction = input => take('respond',input,()=>{const review={...fixture().review,status:input.decision,responderName:input.responderName,reason:input.reason};fixture().reviews=[review];return {ok:true,review};});
