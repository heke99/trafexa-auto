async function act(kind,form){const f=window.fixture,input=Object.fromEntries(form);f.calls.push({kind,input});const next=f.responses[kind]?.shift();if(next?.throw)throw Error('Simulated transport');if(next?.defer)return new Promise(resolve=>f.deferred.push(resolve));return next??(kind==='review'?{ok:true,message:'Kontrollerat'}:{ok:true,count:1,message:'En bil importerad'});}
export const reviewStockImportAction=form=>act('review',form);
export const importStockAction=form=>act('import',form);
