import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
import {job,id} from './helpers/advertising-invoice-email-fixture.mjs';

const keys=['ADVERTISING_INVOICE_EMAIL_ENABLED','TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED','NEXT_PUBLIC_SUPABASE_URL','RESEND_API_KEY','SUPABASE_SECRET_KEY','RESEND_WEBHOOK_SECRET'];
async function environment(run,patch={}){const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{Object.assign(process.env,{ADVERTISING_INVOICE_EMAIL_ENABLED:'true',TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://buqdtssxrotkzndublrt.supabase.co',RESEND_API_KEY:'TEST-RESEND-KEY',SUPABASE_SECRET_KEY:'TEST-SERVICE-KEY',RESEND_WEBHOOK_SECRET:'TEST-WEBHOOK-KEY'},patch);await run();}finally{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}}
async function harness(options={}){
 const calls=[],j=job();let authCalls=0,providerCalls=0;
 class PlatformAdminError extends Error{constructor(code){super('PRIVATE AUTH DETAILS');this.code=code;}}
 const userDb={rpc:async(name,args)=>{calls.push(['user',name,args]);if(name==='claim_advertising_invoice_email')return{data:{companyId:id(1),actorUserId:id(2),actorRole:'platform_admin',job:options.empty?null:{...j,...options.claimPatch}},error:null};if(name==='bind_advertising_invoice_email'&&options.bindFailure)return{data:null,error:{code:'40001'}};return{data:{ok:!options.blocked},error:null};}};
 const service={rpc:async(name,args)=>{calls.push(['service',name,args]);if(options.finishFailure)return{data:null,error:{code:'08006'}};return{data:{status:args.p_outcome==='retryable'?'pending':args.p_outcome},error:null};}};
 const loader=await createSourceLoader({
  '@/lib/platform-admin/context':{PlatformAdminError,async requirePlatformAdminContext(){authCalls++;if(options.deny||options.revokeAt&&authCalls>=options.revokeAt)throw new PlatformAdminError('forbidden');return{userId:id(2),db:userDb};}},
  '@supabase/supabase-js':{createClient(url,key,config){assert.equal(url,'https://buqdtssxrotkzndublrt.supabase.co');assert.equal(key,'TEST-SERVICE-KEY');assert.equal(config.auth.persistSession,false);return service;}},
  './advertising-invoice-content':{async prepareAdvertisingInvoiceEmail(value){assert.equal(value.snapshot.documentSourceHash,j.documentSourceHash);if(options.renderFailure)throw Error('PRIVATE PDF DETAILS');return{body:'{"frozen":true}',payloadHash:'a'.repeat(64),pdfSha256:'b'.repeat(64)};}},
  './advertising-invoice-transport':{async sendPreparedAdvertisingInvoiceEmail(input){providerCalls++;calls.push(['provider',input]);assert.equal(input.emailId,j.id);assert.equal(input.body,'{"frozen":true}');return options.outcome??{status:'accepted',providerId:'provider-1'};}},
 });
 const action=loader.load('@/lib/advertising/invoice-email-send-actions');return{action,calls,get providerCalls(){return providerCalls;},input:{companyId:id(1),emailId:j.id}};
}
test('explicit dispatcher binds exact prepared bytes, checks fresh lease and records provider result only via service client',async()=>environment(async()=>{
 const h=await harness(),result=await h.action.sendAdvertisingInvoiceEmailAction(h.input);assert.deepEqual(result,{ok:true,status:'accepted'});assert.equal(h.providerCalls,1);
 assert.deepEqual(h.calls.map(c=>c[0]==='provider'?'provider':c[1]),['claim_advertising_invoice_email','bind_advertising_invoice_email','check_advertising_invoice_email','provider','finish_advertising_invoice_email']);
 const finish=h.calls.at(-1);assert.equal(finish[0],'service');assert.equal(finish[2].p_actor_user_id,id(2));assert.equal(finish[2].p_payload_hash,'a'.repeat(64));assert.equal(finish[2].p_pdf_sha256,'b'.repeat(64));assert.equal(finish[2].p_provider_id,'provider-1');
}));
test('missing configuration does not claim or send; forged browser fields and denied actors cannot dispatch',async()=>{
 for(const patch of [{RESEND_API_KEY:''},{SUPABASE_SECRET_KEY:''},{RESEND_WEBHOOK_SECRET:''},{ADVERTISING_INVOICE_EMAIL_ENABLED:'false'},{TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED:'false'},{NEXT_PUBLIC_SUPABASE_URL:'https://foreign.supabase.co'}])await environment(async()=>{const h=await harness();assert.equal((await h.action.sendAdvertisingInvoiceEmailAction(h.input)).status,'unconfigured');assert.equal(h.calls.length,0);},patch);
 await environment(async()=>{const h=await harness({deny:true});assert.equal((await h.action.sendAdvertisingInvoiceEmailAction(h.input)).code,'access_denied');assert.equal(h.calls.length,0);const s=await harness();assert.equal((await s.action.sendAdvertisingInvoiceEmailAction({...s.input,recipient:'evil@example.test'})).ok,false);assert.equal(s.calls.length,0);});
});
test('empty, substituted source, blocked lease or failed renderer never emits a provider request',async()=>environment(async()=>{
 for(const options of [{empty:true},{claimPatch:{companyId:id(9)}},{blocked:true},{renderFailure:true},{bindFailure:true}]){const h=await harness(options);await h.action.sendAdvertisingInvoiceEmailAction(h.input);assert.equal(h.providerCalls,0);if(options.renderFailure||options.bindFailure){const finish=h.calls.find(c=>c[1]==='finish_advertising_invoice_email');assert.equal(finish[2].p_payload_hash,null);assert.equal(finish[2].p_pdf_sha256,null);}}
}));
test('revocation before provider withholds bytes; revocation after acceptance still records trusted fact before denying response',async()=>environment(async()=>{
 const before=await harness({revokeAt:2}),r=await before.action.sendAdvertisingInvoiceEmailAction(before.input);assert.equal(r.code,'access_denied');assert.equal(before.providerCalls,0);assert.equal(before.calls.at(-1)[2].p_outcome,'cancelled');
 const after=await harness({revokeAt:3}),s=await after.action.sendAdvertisingInvoiceEmailAction(after.input);assert.equal(s.code,'access_denied');assert.equal(after.providerCalls,1);assert.equal(after.calls.at(-1)[0],'service');assert.equal(after.calls.at(-1)[2].p_outcome,'accepted');assert.equal(after.calls.at(-1)[2].p_provider_id,'provider-1');
}));
test('ambiguous provider/finish outcomes remain unknown while known throttles become pending without automatic retry',async()=>environment(async()=>{
 for(const options of [{outcome:{status:'unknown'}},{outcome:{status:'retryable'}},{finishFailure:true}]){const h=await harness(options),r=await h.action.sendAdvertisingInvoiceEmailAction(h.input);assert.equal(r.status,options.outcome?.status==='retryable'?'pending':'unknown');assert.equal(h.providerCalls,1);}
}));
test('configuration action is admin-only, freshly checked and exposes no secret values',async()=>environment(async()=>{
 const h=await harness(),r=await h.action.getAdvertisingInvoiceEmailConfigurationAction();assert.deepEqual(r,{ok:true,configured:true,sender:'kundtjanst@trafexa.com',replyTo:'info@trafexa.com'});assert.ok(!JSON.stringify(r).includes('TEST-'));
 const denied=await harness({revokeAt:2});assert.equal((await denied.action.getAdvertisingInvoiceEmailConfigurationAction()).code,'access_denied');
}));
