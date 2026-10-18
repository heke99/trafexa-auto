export function verifyContractArchiveAction(input) { return window.fixture.call('verify', input); }
export function getContractArchiveAction(input) { return window.fixture.call('read', input); }
export function archiveContractAction(input) { return window.fixture.call('archive', input); }
export async function listMyContractSigningsAction(input) { window.fixture.signingCalls.push({kind:'customer',input}); return {ok:true,signings:window.fixture.signings,nextBeforeId:null}; }
export async function listDealContractSigningsAction(input) { window.fixture.signingCalls.push({kind:'dealer',input}); return {ok:true,signings:window.fixture.signings,nextBeforeId:null}; }
export function requestContractSigningAction() { throw Error('Archive UI fixtures must not request signatures.'); }
export function signContractAction() { throw Error('Archive UI fixtures must not sign a contract.'); }
export async function getContractSigningAction(){throw Error('Archive tests must not fetch a selected contract.');}
export async function getContractSigningDeliveryAction(input){return {ok:true,delivery:{...input,recipientEmail:'customer@example.test',status:'accepted',transport:'configured'}};}
