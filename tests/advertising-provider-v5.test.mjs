import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createSourceLoader } from './helpers/source-loader.mjs';
const loader = await createSourceLoader();
const { createBlocketV5Provider } = loader.load('src/lib/advertising/blocket-provider.ts');
const { createAdvertisingWorker } = loader.load('src/lib/advertising/advertising-worker.ts');
const { createBlocketDeliveryStore, parseBlocketDelivery } = loader.load('src/lib/advertising/blocket-delivery-store.ts');
const id = n => `b10c0000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NOW = new Date('2026-10-15T15:00:00Z'), SHA = 'a'.repeat(64), RID = id(9), OLD = id(10);
const binding = () => ({ companyId:id(1),connectionId:id(2),connectionVersion:1,accountReference:'DEALER-A',validUntil:'2026-10-16T15:00:00Z' });
const payload = () => ({sourceId:id(3),listingVersion:2,accountReference:'DEALER-A',title:'Private title omitted',description:'Välskött Volvo',make:'Volvo',model:'V60',fuel:'petrol',transmission:'automatic',priceGrossOre:'25000000',year:2022,mileageKm:35000,registrationNumber:'ABC123',photos:[{url:'https://p.supabase.co/export.jpg?token=private',contentType:'image/jpeg',expiresAt:'2026-10-17T15:00:00Z'}]});
const delivery = (patch={}) => ({id:id(4),companyId:id(1),listingId:id(3),listingVersion:2,sourceId:id(3),dealerCode:'DEALER-A',revision:1,operation:'create',providerAdId:null,connectionId:id(2),connectionVersion:1,payloadSha256:SHA,providerRequestId:null,status:'dispatching',version:1,...patch});
const log = (request_id,action,state='done',created='2026-10-15T15:00:01Z') => ({request_id,action,state,created});
const remote = (patch={}) => ({source_id:id(3),dealer_code:'DEALER-A',category_id:1020,api_version:'v5',state:'created',visible:true,blocket_ad_id:null,log:[log(RID,'create','processing')],...patch});
function fixture(options={}) {
 const calls=[];
 const config={ enabled:true,token:'injected-not-real',dispatcherId:'blocket-v5',verifiedBinding:binding(),fetch:async(url,init)=>{
  const path=new URL(url).pathname, query=new URL(url).search;
  calls.push({url,method:init.method,headers:init.headers,redirect:init.redirect,cache:init.cache,body:init.body?JSON.parse(init.body):null});
  if(options.transport) return options.transport(url,init,calls);
  if(path.endsWith('/vehicles/car/brand'))return Response.json(options.brands??[{id:'volvo',name:'Volvo'}]);
  if(path.endsWith('/vehicles/car/models'))return Response.json(options.models??[{id:'v60-ii',name:'V60'}]);
  if(path.endsWith('/vehicles/car/fuel'))return Response.json(options.fuels??[{id:'petrol',name:'Bensin'},{id:'electricity',name:'El'}]);
  if(path.endsWith('/car/validate'))return Response.json({}, {status:options.validationStatus??200});
  if(init.method==='GET'&&query.includes('include=log'))return Response.json(options.read??remote({blocket_ad_id:'12345',log:[log(OLD,'create'),log(OLD,'publish')]}),{status:options.readStatus??200});
  return Response.json(options.ack??remote(),{status:options.status??(init.method==='POST'?201:200)});
 }};
 return {calls,config,provider:createBlocketV5Provider(config)};
}
test('V5 construction is opt-in and missing durable revision cannot issue requests',async()=>{
 assert.throws(()=>createBlocketV5Provider({...fixture().config,enabled:false}),/unavailable/);
 const f=fixture();assert.equal((await f.provider.submit(payload())).status,'outcome_unknown');assert.equal(f.calls.length,0);
});
test('V5 first CREATE works at internal version 2 and validates exact resolved taxonomy/body without forbidden fields',async()=>{
 const f=fixture(), result=await f.provider.submit(payload(),delivery());
 assert.equal(result.status,'submitted');assert.equal(result.providerRequestId,RID);
 const write=f.calls.at(-1);assert.equal(write.url,'https://api.blocket.se/pro-import-api/v5/car');assert.equal(write.method,'POST');
 assert.equal(write.body.source_id,id(3));assert.equal(write.body.dealer_code,'DEALER-A');assert.equal(write.body.category_fields.brand,'volvo');assert.equal(write.body.category_fields.model,'v60-ii');
 assert.deepEqual(write.body.category_fields.powertrain,{fuel:'petrol',transmission:'automatic'});assert.deepEqual(write.body.category_fields.condition.mileage,{unit:'km',value:35000});
 assert.equal(write.body.category_fields.registration_number,'ABC123');assert.equal(write.body.price[0].amount,250000);
 for(const key of ['title','contact','category_id'])assert.equal(Object.hasOwn(write.body,key),false);
 assert.equal(Object.hasOwn(write.body.category_fields,'vin'),false);
 const validation=f.calls.find(call=>call.url.endsWith('/car/validate'));assert.deepEqual(validation.body,write.body);
 assert.ok(f.calls.every(call=>call.redirect==='error'&&call.cache==='no-store'));
 assert.equal(write.headers['X-Auth-Token'],'injected-not-real');
});
test('V5 UPDATE verifies exact dealer/identity/api version first and preserves source through PUT with full image list',async()=>{
 const f=fixture({ack:remote({blocket_ad_id:'12345',log:[log(OLD,'create'),log(OLD,'publish'),log(RID,'update','processing')]})});
 const d=delivery({operation:'update',revision:2,providerAdId:'12345'});
 assert.equal((await f.provider.submit(payload(),d)).providerRequestId,RID);
 assert.equal(f.calls[0].method,'GET');assert.ok(f.calls[0].url.endsWith('/car/'+id(3)+'?include=log'));
 const write=f.calls.at(-1);assert.equal(write.method,'PUT');assert.ok(write.url.endsWith('/car/'+id(3)));
 assert.deepEqual(write.body.image_urls,payload().photos.map(p=>p.url));
 for(const key of ['source_id','dealer_code','category_id','title','contact'])assert.equal(Object.hasOwn(write.body,key),false);
 assert.equal(Object.hasOwn(write.body.category_fields,'registration_number'),false);
 assert.equal(f.calls.some(c=>c.url.endsWith('/validate')),false);
});
test('group UPDATE refuses wrong dealer/source/provider identity/V4 and 404 before every mutation',async()=>{
 for(const patch of [{dealer_code:'DEALER-B'},{source_id:id(99)},{blocket_ad_id:'999'},{api_version:'v4'},{state:'deleted'}]){
  const f=fixture({read:remote({blocket_ad_id:'12345',...patch})});
  assert.equal((await f.provider.submit(payload(),delivery({operation:'update',revision:2,providerAdId:'12345'}))).status,'outcome_unknown');
  assert.ok(f.calls.every(c=>c.method==='GET'));
 }
 const f=fixture({readStatus:404});await f.provider.submit(payload(),delivery({operation:'update',providerAdId:'12345'}));assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('taxonomy resolves exact IDs or unique case-insensitive names and rejects ambiguous labels/hybrid without creating ads',async()=>{
 const exact=fixture();const p=payload();p.make='volvo';p.model='v60-ii';p.fuel='electric';
 await exact.provider.submit(p,delivery());assert.equal(exact.calls.at(-1).body.category_fields.powertrain.fuel,'electricity');
 for(const options of [{models:[{id:'v60-i',name:'V60'},{id:'v60-ii',name:'V60'}]},{models:[{id:'v60-ii',name:'V60 II'}]}]){
  const f=fixture(options), result=await f.provider.submit(payload(),delivery());assert.equal(result.status,'rejected');assert.equal(result.errorCode,'blocket_taxonomy_selection_required');assert.ok(f.calls.every(c=>c.method==='GET'));
 }
 const f=fixture(), hybrid=payload();hybrid.fuel='hybrid';assert.equal((await f.provider.submit(hybrid,delivery())).status,'rejected');assert.equal(f.calls.length,0);
});
test('invalid taxonomy and validation failures never reach the write endpoint',async()=>{
 for(const options of [{brands:{results:[{id:'volvo',name:'Volvo'}]}},{brands:[{id:'volvo',name:'Volvo'},{id:'volvo',name:'Duplicate'}]},{validationStatus:400},{validationStatus:503}]){
  const f=fixture(options);assert.notEqual((await f.provider.submit(payload(),delivery())).status,'submitted');assert.equal(f.calls.some(c=>c.method==='POST'&&new URL(c.url).pathname.endsWith('/v5/car')),false);
 }
});
test('unbound dealer, missing registration consent, WebP or fractional price cause no write',async()=>{
 for(const patch of [{accountReference:'DEALER-B'},{registrationNumber:undefined},{priceGrossOre:'25000001'},{photos:[{...payload().photos[0],contentType:'image/webp'}]}]){
  const f=fixture();assert.notEqual((await f.provider.submit({...payload(),...patch},delivery())).status,'submitted');assert.equal(f.calls.length,0);
 }
});
test('ack correlation requires one new operation body request ID, never a response header or old UPDATE log',async()=>{
 for(const ack of [remote({log:[]}),remote({log:[log(RID,'create'),log(OLD,'create')]}),remote({log:[{...log(RID,'create'),request_id:'bad'}]})]){
  const f=fixture({ack});assert.equal((await f.provider.submit(payload(),delivery())).status,'outcome_unknown');
 }
 const f=fixture({ack:remote({blocket_ad_id:'12345',log:[log(OLD,'update')] }),read:remote({blocket_ad_id:'12345',log:[log(OLD,'update')]})});
 assert.equal((await f.provider.submit(payload(),delivery({operation:'update',providerAdId:'12345'}))).status,'outcome_unknown');
});
test('reconciliation publishes only the exact durable request operation and publish evidence',async()=>{
 const d=delivery({status:'submitted',version:2,providerRequestId:RID});
 const f=fixture({read:remote({blocket_ad_id:'12345',log:[log(RID,'create'),log(RID,'handle_media'),log(RID,'publish')]})});
 const result=await f.provider.reconcile(payload(),d);assert.equal(result.status,'published');assert.equal(result.providerRequestId,RID);assert.match(result.evidenceSha256,/^[0-9a-f]{64}$/);assert.ok(f.calls.every(c=>c.method==='GET'));
 for(const read of [remote({blocket_ad_id:'12345',log:[log(OLD,'create'),log(OLD,'publish')]}),remote({blocket_ad_id:'12345',log:[log(RID,'publish')]}),remote({blocket_ad_id:'12345',visible:false,log:[log(RID,'create'),log(RID,'publish')]}),remote({blocket_ad_id:'12345',log:[log(RID,'create'),log(RID,'publish'),log(OLD,'delete','done','2026-10-15T15:00:02Z')]})]){
  assert.notEqual((await fixture({read}).provider.reconcile(payload(),d)).status,'published');
 }
 assert.equal((await f.provider.reconcile(payload(),delivery({status:'outcome_unknown'}))).status,'outcome_unknown');
});
function workerFixture(options={}) {
 let job={id:id(20),companyId:id(1),stockId:id(21),listingId:id(3),listingVersion:2,channel:'blocket',connectionId:id(2),connectionVersion:1,accountReference:'DEALER-A',dispatcherId:'blocket-v5',createdBy:id(22),status:'queued',version:1,claimToken:null,claimExpiresAt:null,providerAdId:null,providerUrl:null,errorCode:null,createdAt:NOW.toISOString(),updatedAt:NOW.toISOString(),snapshot:{title:'Volvo V60',description:'Fin bil',make:'Volvo',model:'V60',fuel:'petrol',transmission:'automatic',priceGrossOre:'25000000',year:2022,mileageKm:35000,includeRegistrationNumber:true,registrationNumber:'ABC123',photos:[{id:id(23),companyId:id(1),stockId:id(21),objectPath:id(1)+'/'+id(21)+'/'+id(23)+'.jpg',contentType:'image/jpeg',sizeBytes:500,version:1,status:'active',createdAt:NOW.toISOString(),storageBucket:'ads-vehicle-photos',storageVisibility:'private'}]}};
 let d=null;const calls=[];
 const store={async getJob(){return structuredClone(job);},async claimJob(){throw Error('V5 must claim atomically through SQL ledger');},async expireDispatch(){calls.push('expire');job={...job,status:'outcome_unknown',version:job.version+1,claimToken:null};return structuredClone(job);},async saveJob(_id,version,token,outcome){calls.push('save:'+outcome.status);assert.equal(version,job.version);if(options.failSave)throw Error('database unavailable');job={...job,...outcome,version:job.version+1};return structuredClone(job);}};
 const ledger={async get(){calls.push('get');return d&&structuredClone(d);},async begin(j,token,hash){calls.push('begin');job={...job,status:'dispatching',version:job.version+1,claimToken:token,claimExpiresAt:'2026-10-15T15:02:00Z'};d=delivery({payloadSha256:hash,listingVersion:j.listingVersion,operation:options.operation??'create',providerAdId:options.previousProviderAdId??null});return{job:structuredClone(job),delivery:structuredClone(d),replayed:options.replayed??false};},async record(_id,previous,token,outcome){calls.push('record:'+outcome.status);if(options.failRecord)throw Error('record unavailable');if(outcome.status==='published')assert.ok(d.providerRequestId,'ack must be durable before publication');d={...d,status:outcome.status==='retryable'?'outcome_unknown':outcome.status,version:d.version+1,providerRequestId:outcome.providerRequestId??d.providerRequestId,providerAdId:outcome.providerAdId??d.providerAdId};return structuredClone(d);}};
 const provider={channel:'blocket',deliveryProtocol:'blocket-v5',dispatcherId:'blocket-v5',verifiedBinding:binding(),async submit(p,revision){calls.push('submit');assert.equal(revision.id,d.id);assert.equal(p.sourceId,id(3));if(options.throwSubmit)throw Error('SECRET');return options.submitOutcome??{status:'submitted',providerRequestId:RID};},async reconcile(){calls.push('reconcile');return options.reconcileOutcome??{status:'published',providerAdId:'12345',providerUrl:null,providerRequestId:RID,evidenceSha256:SHA};}};
 const media={origin:'https://p.supabase.co',async resolve(){calls.push('media');const path=id(1)+'/'+id(21)+'/'+id(23)+'/'+SHA+'.jpg';return{url:'https://p.supabase.co/storage/v1/object/sign/ads-export-media/'+path+'?token=private',expiresAt:'2026-10-17T15:00:00Z',objectPath:path,sha256:SHA,normalizationVersion:'vehicle-photo-v1'};}};
 return {calls,options,store,ledger,provider,media,get job(){return job;},set job(v){job=v;},get delivery(){return d;},set delivery(v){d=v;},worker:()=>createAdvertisingWorker({enabled:true,store,providers:[provider],media,now:()=>NOW,blocketDelivery:ledger})};
}
test('V5 worker journals intent and ACK before job submission, then verifies ledger before billable publication',async()=>{
 const f=workerFixture(),worker=f.worker();assert.equal((await worker.run(id(20))).status,'submitted');assert.deepEqual(f.calls.slice(-4),['begin','submit','record:submitted','save:submitted']);
 assert.equal((await worker.run(id(20))).status,'published');assert.deepEqual(f.calls.slice(-3),['reconcile','record:published','save:published']);assert.equal(f.calls.filter(c=>c==='submit').length,1);
});
test('unknown write outcome and 404 reconciliation can never produce another POST or media resolution',async()=>{
 const f=workerFixture({throwSubmit:true,reconcileOutcome:{status:'outcome_unknown',errorCode:'remote_not_found'}}),worker=f.worker();
 assert.equal((await worker.run(id(20))).status,'outcome_unknown');assert.equal((await worker.run(id(20))).status,'outcome_unknown');
 assert.equal(f.calls.filter(c=>c==='submit').length,1);assert.equal(f.calls.filter(c=>c==='media').length,1);assert.equal(f.calls.filter(c=>c==='begin').length,1);
});
test('begin replay never submits, and a lost result save resumes read-only after lease expiration',async()=>{
 const replay=workerFixture({replayed:true});await replay.worker().run(id(20));assert.equal(replay.calls.includes('submit'),false);
 const f=workerFixture({failSave:true}),worker=f.worker();await assert.rejects(worker.run(id(20)),/database/);f.options.failSave=false;f.job={...f.job,claimExpiresAt:'2026-10-15T14:59:00Z'};
 assert.equal((await worker.run(id(20))).status,'published');assert.equal(f.calls.filter(c=>c==='submit').length,1);assert.ok(f.calls.includes('expire'));
});
test('first recovered acknowledgement is recorded before publication and forged identity/correlation are withheld',async()=>{
 const f=workerFixture();f.job={...f.job,status:'outcome_unknown'};f.delivery=delivery({status:'outcome_unknown'});
 assert.equal((await f.worker().run(id(20))).status,'published');assert.deepEqual(f.calls.slice(-4),['reconcile','record:submitted','record:published','save:published']);
 const bad=workerFixture();bad.job={...bad.job,status:'submitted'};bad.delivery=delivery({status:'submitted',providerRequestId:OLD});
 assert.equal((await bad.worker().run(id(20))).status,'submitted');assert.equal(bad.calls.some(c=>c==='record:published'||c==='save:published'),false);
});
test('V5 requires the SQL ledger and rejects wrong delivery scope before provider reads or writes',async()=>{
 const f=workerFixture();await assert.rejects(createAdvertisingWorker({enabled:true,store:f.store,providers:[f.provider],media:f.media,now:()=>NOW}).run(id(20)),/store_required/);assert.equal(f.calls.length,0);
 for(const patch of [{dealerCode:'DEALER-B'},{companyId:id(90)},{listingVersion:1},{connectionVersion:2}]){
  const bad=workerFixture();bad.delivery=delivery(patch);await assert.rejects(bad.worker().run(id(20)),/binding/);assert.equal(bad.calls.includes('submit')||bad.calls.includes('reconcile'),false);
 }
});
test('service SDK bridge validates exact DTOs, passes scoped RPCs and never exposes raw SQL diagnostics',async()=>{
 const calls=[],client={rpc(name,args){calls.push({name,args});return Promise.resolve({data:name==='get_blocket_delivery'?delivery():name==='begin_blocket_delivery'?{job:{id:id(20)},delivery:delivery(),replayed:false}:delivery({status:'submitted',providerRequestId:RID,version:2}),error:null});}};
 const store=createBlocketDeliveryStore(client);assert.equal((await store.get(id(20))).id,id(4));await store.begin({id:id(20),version:1},id(25),SHA);await store.record(id(20),delivery(),id(25),{status:'submitted',providerRequestId:RID});
 assert.deepEqual(calls.map(c=>c.name),['get_blocket_delivery','begin_blocket_delivery','record_blocket_delivery']);assert.equal(calls[2].args.p_provider_request_id,RID);assert.equal(calls[2].args.p_evidence_sha256,null);
 for(const patch of [{unexpected:'secret'},{providerAdId:'not-numeric'},{sourceId:id(99)},{providerRequestId:'bad'},{status:'submitted',providerRequestId:null}])assert.throws(()=>parseBlocketDelivery(delivery(patch)));
 const failed=createBlocketDeliveryStore({rpc(){return Promise.resolve({data:null,error:{message:'SECRET'}});}});await assert.rejects(failed.get(id(20)),e=>e.message==='blocket_delivery_unavailable');
});



test('published ledger finalizes a lost generic job save without a later remote GET or another ledger write', async()=>{
 const f=workerFixture(),worker=f.worker();await worker.run(id(20));f.options.failSave=true;
 await assert.rejects(worker.run(id(20)),/database/);assert.equal(f.delivery.status,'published');
 const previousReads=f.calls.filter(c=>c==='reconcile').length, previousRecords=f.calls.filter(c=>c==='record:published').length;
 f.options.failSave=false;f.provider.reconcile=async()=>{throw Error('later GET 404 must never be used');};
 assert.equal((await worker.run(id(20))).status,'published');assert.equal(f.calls.filter(c=>c==='reconcile').length,previousReads);assert.equal(f.calls.filter(c=>c==='record:published').length,previousRecords);
 assert.equal(f.calls.filter(c=>c==='submit').length,1);
});
test('definitively rejected revision permits a corrected explicit new version without replaying its old job',async()=>{
 for(const operation of ['create','update']){
  const f=workerFixture({operation,previousProviderAdId:operation==='update'?'12345':null,submitOutcome:{status:'rejected',errorCode:'blocket_http_400'}}),worker=f.worker();
  assert.equal((await worker.run(id(20))).status,'rejected');assert.equal(f.delivery.status,'rejected');
  assert.equal((await worker.run(id(20))).status,'rejected');assert.equal(f.calls.filter(c=>c==='submit').length,1);
  f.job={...f.job,id:id(30),listingVersion:3,status:'queued',version:1,claimToken:null,claimExpiresAt:null};f.delivery=null;f.options.submitOutcome={status:'submitted',providerRequestId:RID};
  assert.equal((await worker.run(id(30))).status,'submitted');assert.equal(f.delivery.operation,operation);assert.equal(f.delivery.listingVersion,3);assert.equal(f.calls.filter(c=>c==='submit').length,2);
 }
});
test('rejected ledger can finish a lost local rejection save without querying the provider again',async()=>{
 const f=workerFixture({submitOutcome:{status:'rejected',errorCode:'blocket_http_400'},failSave:true}),worker=f.worker();
 await assert.rejects(worker.run(id(20)),/database/);assert.equal(f.delivery.status,'rejected');f.options.failSave=false;
 f.job={...f.job,claimExpiresAt:'2026-10-15T14:59:00Z'};
 assert.equal((await worker.run(id(20))).status,'rejected');assert.equal(f.calls.includes('reconcile'),false);assert.equal(f.calls.filter(c=>c==='submit').length,1);
});
