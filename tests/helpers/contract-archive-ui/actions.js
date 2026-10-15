export function getContractArchiveAction(input) { return window.fixture.call('read', input); }
export function archiveContractAction(input) { return window.fixture.call('archive', input); }
export async function listMyContractSigningsAction(input) { window.fixture.signingCalls.push({kind:'customer',input}); return {ok:true,signings:window.fixture.signings,nextBeforeId:null}; }
export async function listDealContractSigningsAction(input) { window.fixture.signingCalls.push({kind:'dealer',input}); return {ok:true,signings:window.fixture.signings,nextBeforeId:null}; }
export function requestContractSigningAction() { throw Error('Archive UI fixtures must not request signatures.'); }
export function signContractAction() { throw Error('Archive UI fixtures must not sign a contract.'); }
