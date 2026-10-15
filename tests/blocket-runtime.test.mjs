import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
const id=n=>`f6190000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const GROUP=id(1),JOB=id(2),COMPANY=id(3),CONNECTION=id(4),SECRET='fixture-internal-strong-secret-1234567890';
const now=()=>new Date('2026-10-15T12:00:00Z');
const group=()=>({id:GROUP,version:3,groupReference:'approved-group',credentialReference:'dealer-a',scope:'dealer_group',status:'active',updatedAt:'2026-10-15T11:00:00+00:00',dispatcherId:`blocket_${GROUP.replaceAll('-','')}`});
const binding=()=>({companyId:COMPANY,connectionId:CONNECTION,connectionVersion:7,accountReference:'dealer-approved',validUntil:'2026-10-16T12:00:00Z',group:group()});
const job=()=>({id:JOB,companyId:COMPANY,stockId:id(5),listingId:id(6),listingVersion:9,channel:'blocket',connectionId:CONNECTION,connectionVersion:7,accountReference:'dealer-approved',dispatcherId:group().dispatcherId,createdBy:id(7),status:'published',version:3,claimToken:null,claimExpiresAt:null,providerAdId:'sensitive-provider-id',providerUrl:'https://www.blocket.se/annons/123',errorCode:null,snapshot:{privateInternalFixture:'NEVER_RETURN_SNAPSHOT'},createdAt:'2026-10-15T11:00:00Z',updatedAt:'2026-10-15T11:30:00Z'});
const env=()=>({BLOCKET_DISPATCH_ENABLED:'true',INTERNAL_ADVERTISING_SECRET:SECRET,NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'SENSITIVE_SERVICE_KEY',BLOCKET_GROUP_TOKENS_JSON:JSON.stringify({'dealer-a':'SENSITIVE_PROVIDER_TOKEN'})});
const request=(value={},options={})=>new Request('https://app.trafexa.com/api/internal/advertising/blocket/test'+(options.query??''),{method:'POST',headers:{authorization:`Bearer ${SECRET}`,'content-type':'application/json',cookie:'app-session=NEVER_USE_COOKIE',...options.headers},body:typeof value==='string'?value:JSON.stringify(value)});
async function setup({environment=env(),responses={},runner}={}){
 const calls={clients:[],rpc:[],provider:[],media:[],delivery:[],worker:[],signals:[]};
 const sdk={rpc:(name,args)=>{calls.rpc.push({name,args});let result;
 if(Object.hasOwn(responses,name)){const chosen=responses[name];result=typeof chosen==='function'?chosen(args):chosen;}else result=name==='get_blocket_worker_group'?{data:group(),error:null}:name==='refresh_advertising_dispatcher'?{data:{dispatcherId:args.p_dispatcher_id,channel:args.p_channel,availableUntil:args.p_available_until.replace('Z','+00:00')},error:null}:name==='get_blocket_worker_binding'?{data:binding(),error:null}:name==='get_advertising_job'?{data:job(),error:null}:{data:job(),error:null};
 const pending=Promise.resolve(result);pending.abortSignal=signal=>{calls.signals.push(signal);return pending;};return pending;},storage:{}};
 const loader=await createSourceLoader({'@supabase/supabase-js':{createClient:(...args)=>{calls.clients.push(args);return sdk;}},'./blocket-provider':{createBlocketV5Provider:options=>{calls.provider.push(options);return {channel:'blocket',...options};}},'./blocket-delivery-store':{createBlocketDeliveryStore:client=>{calls.delivery.push(client);return {privateLedger:true};}},'../vehicle-photos/export-media':{createAdvertisingExportMediaResolver:options=>{calls.media.push(options);return {origin:options.projectOrigin};}},'./advertising-worker':{createAdvertisingWorker:options=>{calls.worker.push(options);return {run:async id=>runner?runner(options,id):options.store.getJob(id)};}}});
 const runtime=loader.load('src/lib/advertising/blocket-runtime.ts').createBlocketRuntime({environment:()=>environment,now});return {runtime,calls,sdk,environment};
}
test('runtime construction and default-off entrypoints perform zero SDK/provider work',async()=>{
 const h=await setup({environment:{}});assert.equal(h.calls.clients.length,0);const response=await h.runtime.readiness(request({groupId:GROUP}));assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,code:'disabled'});assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.provider.length,0);
});
test('bearer authorization and strong configured secret are required before body or SDK processing',async()=>{
 for(const auth of ['',`bearer ${SECRET}`,`Bearer wrong-${SECRET}`]){const h=await setup();const r=await h.runtime.readiness(request({groupId:GROUP},{headers:{authorization:auth}}));assert.equal(r.status,401);assert.equal(h.calls.clients.length,0);}
 const h=await setup({environment:{...env(),INTERNAL_ADVERTISING_SECRET:'weak'}});const r=await h.runtime.job(request(),JOB);assert.equal(r.status,503);assert.equal(h.calls.clients.length,0);
});
test('readiness exact group token lookup issues only bounded four-minute lease, not a Blocket request',async()=>{
 const h=await setup();const r=await h.runtime.readiness(request({groupId:GROUP}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,status:'ready',availableUntil:'2026-10-15T12:04:00.000Z'});assert.deepEqual(h.calls.rpc.map(c=>c.name),['get_blocket_worker_group','refresh_advertising_dispatcher']);assert.equal(h.calls.provider.length,0);assert.equal(h.calls.rpc[1].args.p_dispatcher_id,group().dispatcherId);assert.equal(h.calls.rpc[1].args.p_channel,'blocket');assert.ok(h.calls.signals.every(signal=>signal instanceof AbortSignal));assert.equal(r.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
});
test('private SDK receives service runtime config with session persistence disabled and never visitor cookies',async()=>{
 const h=await setup();await h.runtime.readiness(request({groupId:GROUP}));const[url,key,options]=h.calls.clients[0];assert.equal(url,'https://fixture.supabase.co');assert.equal(key,'SENSITIVE_SERVICE_KEY');assert.deepEqual(options.auth,{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});assert.equal(options.global.headers,undefined);assert.deepEqual(Object.keys(options).sort(),['auth','global']);
});
test('credential references preserve hyphen and underscore identity and missing tokens never lease a dispatcher',async()=>{
 const h=await setup({environment:{...env(),BLOCKET_GROUP_TOKENS_JSON:JSON.stringify({'dealer_a':'OTHER_PRIVATE_TOKEN'})}});const r=await h.runtime.readiness(request({groupId:GROUP}));assert.equal(r.status,503);assert.equal(h.calls.rpc.some(c=>c.name==='refresh_advertising_dispatcher'),false);
 for(const value of ['[]','{"dealer-a":"bad\\nheader"}','{"dealer-a":5}','{"other":"token"}']){const h=await setup({environment:{...env(),BLOCKET_GROUP_TOKENS_JSON:value}});assert.equal((await h.runtime.readiness(request({groupId:GROUP}))).status,503);assert.equal(h.calls.rpc.length,1);}
});
test('readiness rejects inactive, wrong-group or dispatcher substitution before refreshing',async()=>{
 for(const patch of [{status:'disabled'},{id:id(99)},{dispatcherId:'arbitrary-dispatcher'}]){const h=await setup({responses:{get_blocket_worker_group:{data:{...group(),...patch},error:null}}});assert.equal((await h.runtime.readiness(request({groupId:GROUP}))).status,503);assert.equal(h.calls.rpc.length,1);}
});
test('strict JSON, exact keys, query, MIME and body bounds reject before creating a service client',async()=>{
 for(const r of [request({groupId:GROUP,token:'NOT_ALLOWED'}),request('{broken'),request({groupId:GROUP},{query:'?secret=no'}),request({groupId:GROUP},{headers:{'content-type':'text/plain'}}),request('x'.repeat(4097)),request({groupId:'not-a-uuid'})]){const h=await setup();assert.equal((await h.runtime.readiness(r)).status,400);assert.equal(h.calls.clients.length,0);}
 const h=await setup();assert.equal((await h.runtime.job(request({providerUrl:'https://attacker.invalid'}),JOB)).status,400);assert.equal(h.calls.clients.length,0);
});
test('job runtime creates only exact verified V5 provider/media/ledger and returns sanitized status',async()=>{
 const h=await setup();const r=await h.runtime.job(request(),JOB);assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,status:'published'});assert.equal(h.calls.provider[0].token,'SENSITIVE_PROVIDER_TOKEN');assert.equal(h.calls.provider[0].dispatcherId,group().dispatcherId);assert.equal(h.calls.provider[0].verifiedBinding.accountReference,'dealer-approved');assert.equal(h.calls.delivery[0],h.sdk);assert.equal(h.calls.media[0].client,h.sdk);assert.equal(h.calls.media[0].enabled,true);assert.equal(h.calls.worker[0].enabled,true);assert.deepEqual(h.calls.worker[0].blocketDelivery,{privateLedger:true});
});
test('expired binding, wrong job identity or current connection mismatch never starts a provider request',async()=>{
 const expired=await setup({responses:{get_blocket_worker_binding:{data:{...binding(),validUntil:'2026-10-14T12:00:00Z'},error:null}}});assert.equal((await expired.runtime.job(request(),JOB)).status,503);assert.equal(expired.calls.provider.length,0);
 for(const patch of [{id:id(99)},{companyId:id(99)},{connectionVersion:8},{accountReference:'other'},{dispatcherId:'other'},{channel:'wayke'}]){const h=await setup({responses:{get_advertising_job:{data:{...job(),...patch},error:null}}});const r=await h.runtime.job(request(),JOB);assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,code:'unavailable'});}
});
test('generic store adapter preserves claim, CAS, save outcome and expiry RPC contracts',async()=>{
 const h=await setup({runner:async(options,id)=>{await options.store.claimJob(id,4,id);await options.store.saveJob(id,5,id,{status:'outcome_unknown',errorCode:'blocket_submission_unknown'});await options.store.expireDispatch(id,6);return options.store.getJob(id);}});assert.equal((await h.runtime.job(request(),JOB)).status,200);
 assert.deepEqual(h.calls.rpc.find(c=>c.name==='claim_advertising_job').args,{p_job_id:JOB,p_expected_version:4,p_claim_token:JOB});assert.deepEqual(h.calls.rpc.find(c=>c.name==='save_advertising_job').args,{p_job_id:JOB,p_expected_version:5,p_claim_token:JOB,p_status:'outcome_unknown',p_provider_ad_id:null,p_provider_url:null,p_error_code:'blocket_submission_unknown'});assert.deepEqual(h.calls.rpc.find(c=>c.name==='expire_advertising_dispatch').args,{p_job_id:JOB,p_expected_version:6});
});
test('backend failures return no raw database, credentials, snapshot or provider identity',async()=>{
 const h=await setup({responses:{get_blocket_worker_binding:{data:null,error:{message:'SENSITIVE_SERVICE_KEY SENSITIVE_PROVIDER_TOKEN PRIVATE_DATABASE_ERROR'}}}});const r=await h.runtime.job(request(),JOB);assert.equal(r.status,503);const text=await r.text();assert.doesNotMatch(text,/SENSITIVE|PRIVATE|snapshot|providerAdId/);assert.equal(text,'{"ok":false,"code":"unavailable"}');
});
test('actual V5 provider, durable ledger factory and generic worker compose through the runtime without replaying a terminal job',async()=>{
 const h=await setup();let fetches=0;
 const loader=await createSourceLoader({'@supabase/supabase-js':{createClient:()=>h.sdk},'../vehicle-photos/export-media':{createAdvertisingExportMediaResolver:options=>({origin:options.projectOrigin,resolve:async()=>{throw Error('Terminal jobs must not resolve media');}})}});
 const runtime=loader.load('src/lib/advertising/blocket-runtime.ts').createBlocketRuntime({environment:env,now,fetch:async()=>{fetches++;throw Error('Terminal job must not access provider');}});
 const r=await runtime.job(request(),JOB);assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,status:'published'});assert.equal(fetches,0);assert.deepEqual(h.calls.rpc.map(call=>call.name),['get_blocket_worker_binding','get_advertising_job']);
});
