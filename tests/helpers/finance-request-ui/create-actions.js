async function create(kind,input){
 const result=await window.fixture.mutate(kind,input);
 if(result?.throw)throw Error('Simulated unknown transport');
 if(result?.wait)return new Promise(resolve=>{(window.fixture.createDeferred??=[]).push(resolve);});
 if(result!==undefined)return result;
 return {ok:true,receipt:{companyId:input.companyId,actorId:window.fixture.scope.actorId,requestId:input.requestId,kind:kind==='createCustomerRequest'?'customer':'finance_intake',recordId:'90000000-0000-4000-8000-000000000001',createdAt:'2026-10-15T12:00:00Z'}};
}
export const createCustomerRequestAction=input=>create('createCustomerRequest',input);
export const createFinanceIntakeRequestAction=input=>create('createFinanceIntakeRequest',input);
