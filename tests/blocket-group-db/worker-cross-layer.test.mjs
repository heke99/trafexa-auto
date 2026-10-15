// Actual generic worker + V5 provider + durable ledger bridge → complete SQL.
// Only provider fetch and normalized media URLs are synthetic. No real partner
// endpoint, hosted Auth, upload or credential is touched by this test.
import assert from 'node:assert/strict';
import {randomUUID}from 'node:crypto';
import {readFile}from 'node:fs/promises';
import{before,beforeEach,after,test}from 'node:test';
import{createDatabase,asRole}from '../crm-db/helpers.mjs';
import{createSourceLoader}from '../helpers/source-loader.mjs';
const id=n=>`fd190000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const PLATFORM=id(1),OWNER=id(2),SALES=id(3),COMPANY=id(101),GROUP=id(201),STOCK=id(301),LISTING=id(401),PHOTO=id(501);
const fixture=(await readFile(new URL('../../supabase/tests/blocket_group_delivery.sql',import.meta.url),'utf8')).split('-- BEGIN BLOCKET FIXTURES')[1].split('-- END BLOCKET FIXTURES')[0];
let db,modules;
before(async()=>{db=await createDatabase({approveEstablishedFixtures:false});modules=await createSourceLoader();});
beforeEach(async()=>{await db.exec(`begin;truncate auth.users,private.blocket_groups cascade;${fixture}commit;`);});
after(async()=>{await db?.close();});
async function rpc(name,args={},role='service_role',actor=null){const entries=Object.entries(args);return asRole(db,role,actor,async tx=>(await tx.query(`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(',')})result`,entries.map(([,v])=>v))).rows[0].result);}
const dealer=(name,args,actor=SALES)=>rpc(name,args,'authenticated',actor);
async function provision(){
 await dealer('configure_blocket_group',{p_group_id:GROUP,p_expected_version:0,p_group_reference:'Reviewed fixture group',p_credential_reference:'fixture_label',p_scope:'dealer_group',p_status:'active',p_reason:'Reviewed group',p_acknowledged:true,p_request_id:randomUUID()},PLATFORM);
 await dealer('bind_blocket_company',{p_company_id:COMPANY,p_group_id:GROUP,p_expected_group_version:1,p_expected_connection_version:0,p_dealer_code:'dealer-a',p_evidence_reference:'Reviewed legal dealer scope',p_valid_until:new Date(Date.now()+86400000).toISOString(),p_reason:'Reviewed binding',p_acknowledged:true,p_request_id:randomUUID()},PLATFORM);
 await rpc('refresh_advertising_dispatcher',{p_dispatcher_id:'blocket_'+GROUP.replaceAll('-',''),p_channel:'blocket',p_available_until:new Date(Date.now()+240000).toISOString()});
 await dealer('save_advertising_channel_rate',{p_company_id:COMPANY,p_channel:'blocket',p_unit_price_ore:'12500',p_expected_version:0,p_request_id:randomUUID()},PLATFORM);
}
async function queue(version=2){const q=await dealer('get_advertising_send_quote',{p_company_id:COMPANY,p_listing_id:LISTING,p_expected_version:version,p_channels:['blocket']});const sent=await dealer('send_vehicle_advertisement_priced',{p_company_id:COMPANY,p_listing_id:LISTING,p_expected_version:version,p_channels:['blocket'],p_request_id:randomUUID(),p_expected_quote_token:q.reviewToken});return sent.jobs[0].id;}
async function revise(version,description='Reviewed updated complete advertisement'){
 const saved=await dealer('save_vehicle_advertisement',{p_company_id:COMPANY,p_stock_id:STOCK,p_listing_id:LISTING,p_expected_version:version,p_title:'Volvo V60 reviewed',p_description:description,p_photo_ids:[PHOTO],p_include_registration_number:true,p_request_id:randomUUID()});
 const ready=await dealer('mark_vehicle_advertisement_ready',{p_company_id:COMPANY,p_listing_id:LISTING,p_expected_version:saved.listing.version,p_request_id:randomUUID()});return ready.listing.version;
}
async function totals(){return(await db.query("select jsonb_build_object('publications',(select count(*)from private.advertising_publications),'prices',(select count(*)from private.advertising_publication_prices),'amount',(select coalesce(sum(unit_price_ore),0)::text from private.advertising_publication_prices),'deliveries',(select count(*)from private.blocket_delivery_revisions))result")).rows[0].result;}
async function harness(){
 await provision();const state={calls:[],rpc:[],remote:null,activeRequest:null,activeOperation:null,rejectNext:false,remote404:false,wrongDealer:false,badTaxonomy:false,loseBegin:false,failPublishedSave:null,onMedia:null};
 const client={rpc(name,args){const result=(async()=>{state.rpc.push(name);const data=await rpc(name,args);if(name==='begin_blocket_delivery'&&state.loseBegin){state.loseBegin=false;return{data:null,error:{code:'LOST',message:'PRIVATE committed response lost'}};}return{data,error:null};})();return result;}};
 const ledger=modules.load('@/lib/advertising/blocket-delivery-store').createBlocketDeliveryStore(client);
 const store={getJob:jobId=>rpc('get_advertising_job',{p_job_id:jobId}),claimJob:(jobId,version,token)=>rpc('claim_advertising_job',{p_job_id:jobId,p_expected_version:version,p_claim_token:token}),expireDispatch:(jobId,version)=>rpc('expire_advertising_dispatch',{p_job_id:jobId,p_expected_version:version}),async saveJob(jobId,version,token,outcome){
  if(outcome.status==='published'&&state.failPublishedSave==='before'){state.failPublishedSave=null;throw Error('PRIVATE simulated job commit unavailable');}
  const result=await rpc('save_advertising_job',{p_job_id:jobId,p_expected_version:version,p_claim_token:token,p_status:outcome.status,p_provider_ad_id:outcome.providerAdId??null,p_provider_url:outcome.providerUrl??null,p_error_code:outcome.errorCode??null});
  if(outcome.status==='published'&&state.failPublishedSave==='after'){state.failPublishedSave=null;throw Error('PRIVATE simulated committed job receipt lost');}return result;
 }};
 const fetcher=async(url,init)=>{
  const parsed=new URL(url),path=parsed.pathname.replace('/pro-import-api/v5','');assert.equal(parsed.origin,'https://api.blocket.se');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  state.calls.push({path,method:init.method,body:init.body?JSON.parse(init.body):null});
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  if(path.startsWith('/vehicles/')){assert.ok(Number((await db.query('select count(*)n from private.blocket_delivery_revisions')).rows[0].n)>0,'Durable intent precedes provider I/O');return json(state.badTaxonomy?[{id:'other',name:'Not the vehicle'}]:path.endsWith('/brand')?[{id:'volvo',name:'Volvo'}]:path.endsWith('/models')?[{id:'v60',name:'V60'}]:[{id:'petrol',name:'Bensin'}]);}
  if(path==='/car/validate'){assert.equal(init.method,'POST');return json({valid:true});}
  if(init.method==='GET')return state.remote404||!state.remote?json({},404):json({...state.remote,...(state.wrongDealer?{dealer_code:'other-dealer'}:{})});
  assert.ok(path==='/car'||path==='/car/'+LISTING);assert.ok(init.method==='POST'||init.method==='PUT');
  if(state.rejectNext){state.rejectNext=false;return json({private_error:'MUST_NOT_PERSIST'},400);}
  state.activeRequest=randomUUID();state.activeOperation=init.method==='POST'?'create':'update';
  const previous=state.remote;
  state.remote={source_id:LISTING,dealer_code:'dealer-a',category_id:1020,api_version:'v5',state:'created',visible:true,blocket_ad_id:previous?.blocket_ad_id??null,log:[...(previous?.log??[]),{request_id:state.activeRequest,action:state.activeOperation,state:'processing',created:new Date().toISOString()}]};
  return json(state.remote,init.method==='POST'?201:200);
 };
 const binding=await rpc('get_blocket_worker_binding',{p_job_id:await queue()});
 const provider=modules.load('@/lib/advertising/blocket-provider').createBlocketV5Provider({enabled:true,token:'FAKE_FIXTURE_TOKEN',dispatcherId:binding.group.dispatcherId,verifiedBinding:binding,fetch:fetcher});
 const media={origin:'https://fixture.supabase.co',async resolve(photo){if(state.onMedia)await state.onMedia();const hash='a'.repeat(64),objectPath=`${photo.companyId}/${photo.stockId}/${photo.id}/${hash}.jpg`;return{url:`${media.origin}/storage/v1/object/sign/ads-export-media/${objectPath}?token=FAKE_MEDIA_TOKEN`,expiresAt:new Date(Date.now()+172800000).toISOString(),objectPath,sha256:hash,normalizationVersion:'vehicle-photo-v1'};}};
 const worker=modules.load('@/lib/advertising/advertising-worker').createAdvertisingWorker({enabled:true,store,providers:[provider],media,blocketDelivery:ledger});
 const initial=(await db.query('select id from private.advertising_jobs order by created_at limit 1')).rows[0].id;
 function publishRemote(){assert.ok(state.remote);state.remote.blocket_ad_id='123456';state.remote.log=state.remote.log.filter(row=>row.request_id!==state.activeRequest);state.remote.log.push({request_id:state.activeRequest,action:state.activeOperation,state:'done',created:new Date().toISOString()},{request_id:state.activeRequest,action:'publish',state:'done',created:new Date().toISOString()});}
 return{state,worker,store,ledger,initial,publishRemote,writes:()=>state.calls.filter(c=>c.method==='PUT'||c.method==='POST'&&c.path==='/car')};
}

test('actual priced V5 create then reviewed PUT freezes accepted price and bills one verified publication only',async()=>{
 const h=await harness();const submitted=await h.worker.run(h.initial);assert.equal(submitted.status,'submitted');assert.equal(h.writes().length,1);assert.equal(h.writes()[0].method,'POST');assert.equal(h.writes()[0].body.source_id,LISTING);assert.equal(h.writes()[0].body.dealer_code,'dealer-a');assert.equal(h.writes()[0].body.image_urls.length,1);assert.deepEqual(h.writes()[0].body.category_fields.powertrain,{fuel:'petrol',transmission:'automatic'});
 assert.deepEqual(await totals(),{publications:0,prices:0,amount:'0',deliveries:1});h.publishRemote();assert.equal((await h.worker.run(h.initial)).status,'published');assert.deepEqual(await totals(),{publications:1,prices:1,amount:'12500',deliveries:1});
 const version=await revise(2),next=await queue(version);assert.equal((await h.worker.run(next)).status,'submitted');assert.equal(h.writes().length,2);const put=h.writes()[1];assert.equal(put.method,'PUT');assert.equal(put.path,'/car/'+LISTING);assert.equal(Object.hasOwn(put.body,'source_id'),false);assert.equal(Object.hasOwn(put.body,'dealer_code'),false);assert.equal(put.body.image_urls.length,1);assert.equal(put.body.body,'Reviewed updated complete advertisement');
 h.publishRemote();assert.equal((await h.worker.run(next)).status,'published');assert.deepEqual(await totals(),{publications:1,prices:1,amount:'12500',deliveries:2});
 const revisions=(await db.query('select operation,provider_ad_id,provider_request_id from private.blocket_delivery_revisions order by revision')).rows;assert.deepEqual(revisions.map(r=>r.operation),['create','update']);assert.ok(revisions.every(r=>r.provider_ad_id==='123456'));assert.notEqual(revisions[0].provider_request_id,revisions[1].provider_request_id);
});

test('published durable ledger finalizes a failed generic job save without another provider GET or write',async()=>{
 const h=await harness();await h.worker.run(h.initial);h.publishRemote();h.state.failPublishedSave='before';await assert.rejects(h.worker.run(h.initial),/simulated job commit/);
 assert.equal((await h.store.getJob(h.initial)).status,'submitted');assert.equal((await h.ledger.get(h.initial)).status,'published');assert.equal((await totals()).publications,0);
 h.state.remote404=true;const calls=h.state.calls.length;assert.equal((await h.worker.run(h.initial)).status,'published');assert.equal(h.state.calls.length,calls);assert.equal(h.writes().length,1);assert.equal((await totals()).publications,1);
});

test('lost committed generic publication receipt does not query provider or bill twice on retry',async()=>{
 const h=await harness();await h.worker.run(h.initial);h.publishRemote();h.state.failPublishedSave='after';await assert.rejects(h.worker.run(h.initial),/committed job receipt/);
 const calls=h.state.calls.length;h.state.remote404=true;assert.equal((await h.worker.run(h.initial)).status,'published');assert.equal(h.state.calls.length,calls);assert.equal(h.writes().length,1);assert.deepEqual(await totals(),{publications:1,prices:1,amount:'12500',deliveries:1});
});

test('definitive rejected create stays terminal; only newly reviewed version may CREATE and later bill',async()=>{
 const h=await harness();h.state.rejectNext=true;assert.equal((await h.worker.run(h.initial)).status,'rejected');assert.equal((await h.ledger.get(h.initial)).status,'rejected');const writes=h.writes().length;await h.worker.run(h.initial);assert.equal(h.writes().length,writes);assert.equal((await totals()).publications,0);
 const version=await revise(2),next=await queue(version);assert.equal((await h.worker.run(next)).status,'submitted');assert.deepEqual(h.writes().map(w=>w.method),['POST','POST']);h.publishRemote();assert.equal((await h.worker.run(next)).status,'published');assert.equal((await totals()).publications,1);
});

test('definitive rejected PUT preserves provider identity; corrected reviewed version still updates with billing once',async()=>{
 const h=await harness();await h.worker.run(h.initial);h.publishRemote();await h.worker.run(h.initial);
 const v=await revise(2),second=await queue(v);h.state.rejectNext=true;assert.equal((await h.worker.run(second)).status,'rejected');assert.equal((await h.ledger.get(second)).providerAdId,'123456');
 const nextV=await revise(v),third=await queue(nextV);assert.equal((await h.worker.run(third)).status,'submitted');assert.deepEqual(h.writes().map(w=>w.method),['POST','PUT','PUT']);h.publishRemote();assert.equal((await h.worker.run(third)).status,'published');assert.equal((await totals()).publications,1);assert.equal((await totals()).prices,1);
});

test('unmatched official taxonomy blocks before any car creation and leaves a terminal reviewed rejection',async()=>{
 const h=await harness();h.state.badTaxonomy=true;assert.equal((await h.worker.run(h.initial)).status,'rejected');assert.equal(h.writes().length,0);assert.equal((await h.ledger.get(h.initial)).status,'rejected');assert.equal((await totals()).publications,0);
});

test('old request publication cannot satisfy current PUT and wrong dealer evidence never creates a billable publication',async()=>{
 const h=await harness();await h.worker.run(h.initial);h.state.wrongDealer=true;assert.equal((await h.worker.run(h.initial)).status,'submitted');assert.equal((await totals()).publications,0);h.state.wrongDealer=false;h.publishRemote();await h.worker.run(h.initial);
 const next=await queue(await revise(2));await h.worker.run(next);assert.equal((await h.worker.run(next)).status,'submitted');assert.equal((await h.ledger.get(next)).status,'submitted');assert.equal((await totals()).publications,1);assert.equal(h.writes().length,2);
});

test('group revocation before SQL claim prevents every provider request and rolls back the intent',async()=>{
 const h=await harness();h.state.onMedia=async()=>{h.state.onMedia=null;await db.query("update private.blocket_groups set status='disabled'where id=$1",[GROUP]);};
 await assert.rejects(h.worker.run(h.initial));assert.equal(h.state.calls.length,0);assert.equal(await h.ledger.get(h.initial),null);assert.equal((await h.store.getJob(h.initial)).status,'queued');
});

test('lost durable begin receipt never performs an unjournaled provider write or repeats a first attempt',async()=>{
 const h=await harness();h.state.loseBegin=true;await assert.rejects(h.worker.run(h.initial),/unavailable/);assert.equal((await h.ledger.get(h.initial)).status,'dispatching');assert.equal(h.state.calls.length,0);assert.equal((await h.worker.run(h.initial)).status,'dispatching');assert.equal(h.state.calls.length,0);assert.equal((await totals()).publications,0);
});
