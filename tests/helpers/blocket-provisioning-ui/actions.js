function call(kind,input){return window.fixture?.call?.(kind,input)??Promise.resolve({ok:false,code:'unavailable',error:'QA backend unavailable'});}
export const getPlatformBlocketProvisioningAction=input=>call('read',input);
export const configureBlocketGroupAction=input=>call('group',input);
export const bindBlocketCompanyAction=input=>call('bind',input);
export const disableBlocketCompanyAction=input=>call('disable',input);
