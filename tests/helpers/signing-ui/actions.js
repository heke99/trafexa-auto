export async function listMyContractSigningsAction(input){window.fixture.calls.push({kind:'listCustomer',input});return window.fixture.denied?{ok:false,code:'access_denied',message:'Åtkomst nekad'}:{ok:true,signings:window.fixture.rows,nextBeforeId:null};}
export async function listDealContractSigningsAction(input){window.fixture.calls.push({kind:'listDealer',input});return window.fixture.denied?{ok:false,code:'access_denied',message:'Åtkomst nekad'}:{ok:true,signings:window.fixture.rows,nextBeforeId:null};}
export async function requestContractSigningAction(input){window.fixture.calls.push({kind:'request',input});return {ok:true,signing:window.fixture.rows[0]};}
export async function signContractAction(input){window.fixture.calls.push({kind:'sign',input});if(window.fixture.failOnce){window.fixture.failOnce=false;throw Error('transport');}window.fixture.rows=window.fixture.rows.map(row=>({...row,canSign:false,revision:row.revision+1,customerSignature:{fullName:input.fullName}}));return {ok:true,signing:window.fixture.rows[0]};}

export async function getContractArchiveAction(){throw Error('Existing signing tests must not open the archive panel.');}
export async function archiveContractAction(){throw Error('Existing signing tests must not archive contracts.');}
