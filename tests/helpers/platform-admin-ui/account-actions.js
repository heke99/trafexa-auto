export async function listPlatformAccountsAction(input) {
  window.fixture.accountListCalls.push({...input});
  const response=window.fixture.accountResponses.shift();
  if(response?.wait) return new Promise(resolve => {window.resolveAccountList=()=>resolve(response.result);});
  if(response?.throw) throw new Error('Unknown outcome');
  return response ?? {ok:true,accounts:window.fixture.accounts.filter(row=>input.filter==='all'||row.status===input.filter),nextPageKey:null};
}
export async function setPlatformAccountAccessAction(input) {
  window.fixture.accountStatusCalls.push({...input});
  const response=window.fixture.accountStatusResponses.shift();
  if(response?.throw)throw new Error('Unknown outcome');
  if(response)return response;
  window.fixture.accounts=window.fixture.accounts.map(row=>row.userId===input.userId?{...row,status:input.status,version:row.version+1}:row);
  return {ok:true,receipt:{...input,version:input.expectedVersion+1}};
}
