function receipt(input){return {actorId:input.actorId,companyId:input.companyId,requestId:input.requestId,storeId:input.storeId??'af190000-0000-4000-8000-000000000090',periodId:input.periodId,version:input.operation==='store'?0:input.expectedVersion+1,operation:input.operation};}
async function answer(kind,input){
 const f=window.programFixture;f.calls.push({kind,input:structuredClone(input)});
 if(f.actual)return kind==='save'?window.actualProgramSave(input):window.actualProgramResolve(input);
 const next=f.responses[kind].shift();
 if(next?.hold)return new Promise(resolve=>f.pending.push(resolve));
 if(next?.throw)throw Error('Synthetic response lost');
 if(kind==='save'&&next?.commitThenThrow){f.saved=receipt(input);throw Error('Synthetic response lost after commit');}
 if(next)return next;
 return kind==='save'?{ok:true,receipt:receipt(input)}:{ok:true,state:'saved',receipt:f.saved};
}
export const saveAdvertisingProgramRequestAction=input=>answer('save',input);
export const resolveAdvertisingProgramRequestAction=input=>answer('resolve',input);
