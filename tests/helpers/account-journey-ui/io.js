export const getAccountInvitationFingerprint=getPasswordRecoveryFingerprint;
export function getPasswordRecoveryFingerprint(value){return window.auth.fingerprints[value];}
export async function cookies(){return {get:name=>{const value=window.auth.cookies[name];return value!==undefined?{value}:undefined;}};}
export async function createServerSupabaseClient(){return {auth:{getUser:async()=>{window.auth.reads.push('auth');return {data:{user:window.auth.session},error:window.auth.session?null:{message:'No session'}};}}};}
export async function getPlatformAdminContext(){window.auth.reads.push('admin');return window.auth.admin?{userId:window.auth.session?.id}:null;}
export async function getAccountAccessContext(){window.auth.reads.push('access');if(window.auth.accessError)throw Error('Unavailable');return window.auth.access;}
export async function getWorkspaceSnapshot(){window.auth.reads.push('workspace');return window.auth.snapshot;}
export async function getAuthenticatedLandingPath(){return window.auth.landing;}
export function getAccountPendingPath(next){return next==='/dashboard'?'/account-pending':`/account-pending?${new URLSearchParams({next})}`;}
export function redirect(url){throw Object.assign(Error('Redirect'),{url});}
export function useRouter(){return {push:url=>window.auth.pushes.push(url),refresh:()=>window.auth.refreshes++};}
async function submit(kind,form){window.auth.actions.push({kind,input:Object.fromEntries(form)});if(window.auth.hold)return new Promise(resolve=>window.auth.pending.push(resolve));}
export const loginAction=form=>submit('login',form);
export const forgotPasswordAction=form=>submit('forgot',form);
export const updatePasswordAction=form=>submit('reset',form);
export const activateAccountAction=form=>submit('activate',form);
export const signOutAction=form=>submit('signout',form);
export const retryPasswordSignOutAction=form=>submit('retry-signout',form);
export const createCompanyWithProfileAction=async input=>{window.auth.companyActions.push(input);return window.auth.companyResult??{ok:false,code:'unavailable',error:'Resultatet kunde inte verifieras. Försök igen med samma granskade uppgifter.'};};
export const getCompanyStoreProfileAction=()=>{throw Error('Unexpected profile IO');};
export const getCompanyStoreExportAction=getCompanyStoreProfileAction;
export const saveCompanyStoreProfileAction=getCompanyStoreProfileAction;
export const prepareCompanyStoreExportAction=getCompanyStoreProfileAction;
export const savedPasswordSignOutWarning='Lösenordet har sparats, men utloggningen från alla sessioner kunde inte bekräftas. Logga ut och logga sedan in med ditt nya lösenord.';
export const passwordChangeUnconfirmedWarning='Lösenordsändringen kunde inte bekräftas. Försök logga in med ditt nya lösenord. Om det inte fungerar, begär en ny återställningslänk.';
export const sessionSignOutUnconfirmedWarning='Utloggningen från alla sessioner kunde inte bekräftas. Försök logga ut igen innan du loggar in med ditt lösenord.';
