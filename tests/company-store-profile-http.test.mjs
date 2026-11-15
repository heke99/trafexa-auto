import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';

async function setup(){
 const calls=[];
 const action=name=>async value=>{calls.push({name,value});return{ok:true};};
 const loader=await createSourceLoader({'server-only':{},'@/lib/data/company-store-profile-actions':{
  createCompanyWithProfileAction:action('create'),saveCompanyStoreProfileAction:action('save'),prepareCompanyStoreExportAction:action('export'),
  getCompanyStoreProfileAction:action('read'),getCompanyStoreExportAction:action('download'),
 }});
 return {http:loader.load('src/lib/company-store-profile/http.ts'),calls};
}
const request=(body,headers={})=>new Request('https://app.trafexa.com/api/company-store-profile',{method:'POST',headers:{origin:'https://app.trafexa.com','content-type':'application/json',...headers},body,duplex:'half'});
for(const name of ['createDealerCompany','writeCompanyStoreProfile','prepareCompanyStoreExport'])test(`${name}: incomplete body cancels at deadline before any action`,async t=>{
 const {http,calls}=await setup();const originalSetTimeout=globalThis.setTimeout,originalClearTimeout=globalThis.clearTimeout;
 const timer={};let fire,controller,cancelled=false,cleared=false;
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{if(delay!==5000)return originalSetTimeout(callback,delay,...args);fire=callback;return timer;});
 t.mock.method(globalThis,'clearTimeout',handle=>{if(handle===timer)cleared=true;else originalClearTimeout(handle);});
 const body=new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode('{"companyId":'));},cancel(){cancelled=true;}});
 const pending=http[name](request(body));
 try{
  await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof fire,'function');fire();
  const response=await pending;assert.equal(response.status,408);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
  assert.match((await response.json()).error,/för lång tid/);assert.equal(cancelled,true);assert.equal(cleared,true);assert.equal(calls.length,0);
 }finally{if(!cancelled)controller.close();await pending;}
});
test('store mutation HTTP guards reject foreign origins, malformed or oversized JSON before actions',async()=>{
 const {http,calls}=await setup();
 for(const [body,headers,status] of [['{}',{origin:'https://evil.invalid'},403],['{}',{'content-type':'text/plain'},415],['{}',{'content-length':'-1'},400],['{}',{'content-length':'65537'},413],['x'.repeat(65537),{},413],['{bad',{},400],['[]',{},400],[new Uint8Array([255]),{},400]]){
  const response=await http.writeCompanyStoreProfile(request(body,headers));assert.equal(response.status,status);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
 assert.equal(calls.length,0);
});
test('complete mutation bodies preserve exact request IDs and route action responses',async()=>{
 const {http,calls}=await setup();const body={requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',displayName:'Åkes bilar'};
 for(const [name,action,status] of [['createDealerCompany','create',201],['writeCompanyStoreProfile','save',200],['prepareCompanyStoreExport','export',201]]){
  const response=await http[name](request(JSON.stringify(body)));assert.equal(response.status,status);assert.deepEqual(await response.json(),{ok:true});assert.deepEqual(calls.at(-1),{name:action,value:body});
 }
});
