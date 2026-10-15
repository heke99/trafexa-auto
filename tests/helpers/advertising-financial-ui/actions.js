async function read(input,platform){window.financialCalls??=[];window.financialCalls.push({kind:'read',...input,platform});const next=window.financialResponses?.shift();if(next?.hold)return new Promise(resolve=>{window.releaseFinancial=resolve;});if(next)return next;if(!window.financialPage)return{ok:false,code:'unavailable',message:'Finansiell fixture saknas'};return{ok:true,page:window.financialPage};}
export const getPlatformAdvertisingFinancialPageAction=input=>read(input,true);
export const listAdvertisingFinancialPageAction=input=>read(input,false);
async function mutate(kind,input){window.financialCalls.push({kind,...input});const next=window.financialMutationResponses?.shift();if(next?.throw)throw Error('Unknown outcome');if(next)return next;return{ok:true,...(kind==='settings'?{settings:window.financialPage.settings}:{assessment:window.financialAssessment,isOutdated:false}),receipt:{companyId:input.companyId,actorUserId:window.financialPage.actorUserId,requestId:input.requestId}};}
export const saveAdvertisingFinancialSettingsAction=input=>mutate('settings',input);
export const createAdvertisingFinancialAssessmentAction=input=>mutate('create',input);
async function detail(input,platform){window.financialCalls.push({kind:'detail',...input,platform});const next=window.financialDetailResponses?.shift();if(next?.hold)return new Promise(resolve=>{window.releaseFinancialDetail=resolve;});if(next)return next;return{ok:true,assessment:window.financialAssessment,isOutdated:window.financialOutdated??false};}
export const getAdvertisingFinancialAssessmentAction=input=>detail(input,false);
export const getPlatformAdvertisingFinancialAssessmentAction=input=>detail(input,true);
