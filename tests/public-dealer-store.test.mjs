import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
const id=n=>`fd200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const companyId=id(101),userId=id(1),requestId=id(901),slug='stockholm-bilar';
const fields={displayName:'Stockholm Bilar',addressLine1:'Bilvägen 12',addressLine2:null,postalCode:'11122',city:'Stockholm',countryCode:'SE',publicEmail:'butik@bilfirman.se',publicPhone:'081234567',websiteUrl:null,logoUrl:null,description:'Bilar och service',openingHoursText:null};
const time='2026-10-15T18:00:00Z';
const selection=[{listingId:id(601),version:2}];
const input=(patch={})=>({companyId,slug,expectedVersion:0,profileVersion:1,listings:selection,acknowledged:true,requestId,...patch});
const state=(patch={})=>({slug,version:1,status:'published',profileVersion:1,publishedAt:time,updatedAt:time,selectedListings:selection,...patch});
const receipt=(patch={})=>({companyId,actorUserId:userId,requestId,action:'publish',store:state(),...patch});
const listing=()=>({id:id(601),version:2,title:'Volvo V60',description:'Välskött bil',priceOre:'25000000',currency:'SEK',make:'Volvo',model:'V60',year:2022,mileageKm:50000,fuel:'diesel',transmission:'automatic',photos:[{id:id(501)}]});
const publicStore=()=>({slug,version:1,publishedAt:time,shop:{legalName:'Stockholm Bilar AB',organisationNumber:'5568554884',...fields},listings:[listing()]});
const graph=await createSourceLoader(),v=graph.load('src/lib/public-dealer-store/validation.ts');
async function fixture(options={}){
 const calls=[],contexts=[],invalidated=[];
 const db={rpc(name,args){calls.push({name,args:structuredClone(args)});const query={abortSignal(signal){assert.ok(signal instanceof AbortSignal);return query;},then(resolve,reject){if(options.lost){options.lost=false;return Promise.reject(Error('PRIVATE TOKEN')).then(resolve,reject);}return Promise.resolve({data:options.data??(name==='get_company_public_store'?{companyId,actorUserId:userId,actorRole:'owner',store:state()}:receipt()),error:options.error??null}).then(resolve,reject);}};return query;}};
 const loader=await createSourceLoader({'./context':{requirePublicStoreContext:async c=>{contexts.push(c);if(options.deny||options.revoke&&contexts.length>1)throw Object.assign(Error('PRIVATE'),{code:'access_denied'});return{db,companyId:c,userId:options.switchActor&&contexts.length>1?id(2):userId,role:options.switchRole&&contexts.length>1?'admin':'owner'};}},'next/cache':{revalidatePath:p=>{invalidated.push(p);if(options.cacheError)throw Error('cache');}}});
 return{actions:loader.load('src/lib/public-dealer-store/actions.ts'),calls,contexts,invalidated};
}
test('public store publication requires exact opt-in input and canonical distinct selected versions before IO',async()=>{
 assert.deepEqual(v.parsePublishPublicStoreInput(input()),input());
 const f=await fixture();
 for(const patch of [{acknowledged:false},{expectedVersion:-1},{slug:'admin'},{slug:'Upper'},{slug:'two--'},{listings:[...selection,...selection]},{listings:Array.from({length:51},(_,i)=>({listingId:id(600+i),version:2}))},{profileVersion:0},{shop:fields},{companyId:'bad'},{requestId:'bad'}])assert.equal((await f.actions.publishCompanyPublicStoreAction(input(patch))).code,'invalid_input');
 assert.equal(f.calls.length,0);assert.equal(f.contexts.length,0);
 const reversed=[{listingId:id(602),version:3},...selection];assert.deepEqual(v.parsePublishPublicStoreInput(input({listings:reversed})).listings,[...selection,reversed[0]]);
});
test('actual publish and manager actions bind company actor profile selected snapshot and next version',async()=>{
 const f=await fixture();assert.equal((await f.actions.getCompanyPublicStoreAction({companyId})).store.slug,slug);
 const result=await f.actions.publishCompanyPublicStoreAction(input());assert.equal(result.receipt.store.version,1);
 assert.deepEqual(f.calls[1],{name:'publish_company_public_store',args:{p_company_id:companyId,p_slug:slug,p_expected_version:0,p_profile_version:1,p_listings:selection,p_acknowledged:true,p_request_id:requestId}});
 assert.equal(f.contexts.length,4);assert.deepEqual(f.invalidated,['/settings','/handlare/'+slug]);
});
test('unpublish CAS receipt is verified and stale historical publication stays historical without mutable preflight',async()=>{
 const i={companyId,expectedVersion:1,acknowledged:true,requestId};const f=await fixture({data:receipt({action:'unpublish',store:state({version:2,status:'unpublished'})})});assert.equal((await f.actions.unpublishCompanyPublicStoreAction(i)).receipt.store.status,'unpublished');
 assert.equal(f.calls[0].name,'unpublish_company_public_store');
 const replay=await fixture();assert.equal((await replay.actions.publishCompanyPublicStoreAction(input())).ok,true);assert.equal(replay.calls.length,1);
});
test('forged publication receipt never becomes success or invalidates a route',async()=>{
 for(const patch of [{actorUserId:id(9)},{companyId:id(102)},{requestId:id(902)},{action:'unpublish'},{store:state({version:2})},{store:state({slug:'another-shop'})},{store:state({profileVersion:2})},{store:state({selectedListings:[]})},{secret:'PRIVATE'}]){
  const f=await fixture({data:receipt(patch)}),r=await f.actions.publishCompanyPublicStoreAction(input());assert.equal(r.code,'unavailable');assert.equal(f.invalidated.length,0);assert.equal('receipt'in r,false);
 }
});
test('revoked approval actor or role after IO withholds manager data and committed receipt',async()=>{
 for(const option of [{revoke:true},{switchActor:true},{switchRole:true}])for(const read of [false,true]){const f=await fixture(option),r=read?await f.actions.getCompanyPublicStoreAction({companyId}):await f.actions.publishCompanyPublicStoreAction(input());assert.equal(r.code,'access_denied');assert.equal('store'in r,false);assert.equal('receipt'in r,false);assert.equal(f.invalidated.length,0);}
});
test('lost acknowledgement preserves exact request payload and safe diagnostics; cache failure preserves receipt',async()=>{
 const f=await fixture({lost:true});const first=await f.actions.publishCompanyPublicStoreAction(input());assert.equal(first.code,'unavailable');assert.equal(JSON.stringify(first).includes('PRIVATE'),false);assert.equal((await f.actions.publishCompanyPublicStoreAction(input())).ok,true);assert.deepEqual(f.calls[0],f.calls[1]);
 assert.equal((await(await fixture({cacheError:true})).actions.publishCompanyPublicStoreAction(input())).ok,true);
});
test('public projection rejects private costs identifiers and registration details anywhere',()=>{
 assert.deepEqual(v.parsePublicDealerStore(publicStore(),slug),publicStore());assert.equal(v.parsePublicDealerStore(null,slug),null);
 for(const mutate of [s=>s.companyId=companyId,s=>s.shop.apiKey='PRIVATE',s=>s.listings[0].purchasePriceOre='1',s=>s.listings[0].registrationNumber='ABC123',s=>s.listings[0].photos[0].objectPath='private/path',s=>s.listings.push(s.listings[0]),s=>s.shop.websiteUrl='javascript:alert(1)']){const s=publicStore();mutate(s);assert.throws(()=>v.parsePublicDealerStore(s,slug));}
 assert.throws(()=>v.parsePublicDealerStore(publicStore(),'wrong-store'));
});
test('actual public JSON route exports only approved public DTO with no cache and distinguishes missing from unavailable',async()=>{
 let result=publicStore(),error=false;const loader=await createSourceLoader({'@/lib/public-dealer-store/public':{loadPublicDealerStore:async s=>{assert.equal(s,slug);if(error)throw Error('PRIVATE');return result;}}}),route=loader.load('src/app/api/public-stores/[slug]/route.ts');
 const context={params:Promise.resolve({slug})};let r=await route.GET(new Request('https://trafexa.com/api/public-stores/'+slug),context);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store, max-age=0');assert.deepEqual(await r.json(),{schemaVersion:1,store:result});
 r=await route.GET(new Request('https://trafexa.com/api/public-stores/'+slug+'?companyId='+companyId),context);assert.equal(r.status,400);
 result=null;r=await route.GET(new Request('https://trafexa.com/api/public-stores/'+slug),context);assert.equal(r.status,404);
 error=true;r=await route.GET(new Request('https://trafexa.com/api/public-stores/'+slug),context);assert.equal(r.status,503);assert.equal((await r.text()).includes('PRIVATE'),false);
});
test('actual public image route returns only image bytes with no-store and rejects query-path overrides',async()=>{
 let value={bytes:new Uint8Array([1,2,3]),contentType:'image/jpeg'};const loader=await createSourceLoader({'@/lib/public-dealer-store/public':{loadPublicStorePhoto:async()=>value}}),route=loader.load('src/app/api/public-stores/[slug]/photos/[photoId]/route.ts');
 const context={params:Promise.resolve({slug,photoId:id(501)})},url='https://trafexa.com/api/public-stores/'+slug+'/photos/'+id(501);let r=await route.GET(new Request(url),context);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('cache-control'),/no-store/);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),value.bytes);
 assert.equal((await route.GET(new Request(url+'?objectPath=private'),context)).status,400);value=null;assert.equal((await route.GET(new Request(url),context)).status,404);
});
