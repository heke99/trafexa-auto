async function run(kind,input) {
 const f=window.fixture; f[`${kind}Calls`].push(input);const response=f[`${kind}Responses`].shift();
 if(response?.throw)throw Error('Unknown');if(response?.defer)return new Promise(resolve=>{f.resolve=resolve;});if(response)return structuredClone(response);
 if(kind==='list')return {ok:true,...structuredClone(f.page),status:input.status};
 const branch={id:input.branchId,companyId:input.companyId,version:input.expectedVersion+1,status:kind==='status'?input.status:'active',fields:input.fields??f.page.branches[0]?.fields,createdAt:'2026-10-15T12:00:00Z',updatedAt:'2026-10-15T12:01:00Z'};
 return {ok:true,receipt:{companyId:input.companyId,actorUserId:f.page.actorUserId,requestId:input.requestId,action:kind==='save'?'save':'status',branch}};
}
export const listCompanyBranchesAction=input=>run('list',input);
export const saveCompanyBranchAction=input=>run('save',input);
export const setCompanyBranchStatusAction=input=>run('status',input);
