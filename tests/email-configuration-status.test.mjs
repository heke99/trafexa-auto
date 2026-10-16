import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLoader} from './helpers/source-loader.mjs';

const keys=['TRANSACTIONAL_EMAIL_ENABLED','TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED','RESEND_API_KEY','SUPABASE_SECRET_KEY','NEXT_PUBLIC_SUPABASE_URL'];
const project='https://buqdtssxrotkzndublrt.supabase.co';
test('admin email diagnostics distinguish paused events from invitation readiness without sending or exposing credentials',async()=>{
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 let externalCalls=0,authorizations=0;
 const loader=await createSourceLoader({'server-only':{},'@supabase/supabase-js':{createClient(){externalCalls++;throw Error('No external client expected');}},'@/lib/platform-admin/context':{async requirePlatformAdminContext(){authorizations++;return {userId:'admin',db:{async rpc(){return {data:{pending:2,processing:0,accepted:0,rejected:0,unknown:0,cancelled:0},error:null};}}};}}});
 const server=loader.load('@/lib/email/server');
 const action=loader.load('@/lib/email/actions');
 try{
  delete process.env.TRANSACTIONAL_EMAIL_ENABLED;
  Object.assign(process.env,{TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED:'true',RESEND_API_KEY:'synthetic-resend-secret',SUPABASE_SECRET_KEY:'synthetic-supabase-secret',NEXT_PUBLIC_SUPABASE_URL:project});
  const paused=await action.getTransactionalEmailStatusAction();
  assert.equal(paused.ok,true);assert.equal(authorizations,2);
  assert.deepEqual(paused.diagnostics,{enabled:false,domainVerified:true,credentialsPresent:true,projectConfigured:true});
  assert.equal(paused.transport,'unconfigured');assert.equal(paused.invitationTransport,'configured');
  assert.equal((await server.dispatchNextTransactionalEmail()).status,'unconfigured');assert.equal(externalCalls,0);
  assert.equal(JSON.stringify(paused).includes('synthetic-'),false);
  process.env.TRANSACTIONAL_EMAIL_ENABLED='true';
  assert.equal(server.transactionalEmailConfigurationStatus().transport,'configured');
  for(const [key,field] of [['TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED','domainVerified'],['RESEND_API_KEY','credentialsPresent'],['SUPABASE_SECRET_KEY','credentialsPresent'],['NEXT_PUBLIC_SUPABASE_URL','projectConfigured']]){
   const old=process.env[key];delete process.env[key];
   const unavailable=server.transactionalEmailConfigurationStatus();assert.equal(unavailable.transport,'unconfigured');assert.equal(unavailable.invitationTransport,'unconfigured');assert.equal(unavailable.diagnostics[field],false);
   process.env[key]=old;
  }
  assert.equal(externalCalls,0);
 }finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
