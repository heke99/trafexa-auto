import{test}from'node:test';
import assert from'node:assert/strict';
import{createHash}from'node:crypto';
import{createDatabase,asRole}from'./crm-db/helpers.mjs';
import{createSourceLoader}from'./helpers/source-loader.mjs';
const id=n=>`fd330000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),app=id(2),user=id(3),nonce=id(4),email='recovery-fd330000@fixture.invalid';
const environment={TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://buqdtssxrotkzndublrt.supabase.co',RESEND_API_KEY:'synthetic-provider-key',SUPABASE_SECRET_KEY:'synthetic-database-secret'};
async function setup(){
 const previous=Object.fromEntries(Object.keys(environment).map(k=>[k,process.env[k]]));Object.assign(process.env,environment);
 const db=await createDatabase({approveEstablishedFixtures:false});
 await db.exec(`create role supabase_auth_admin nologin;alter table auth.users add column invited_at timestamptz;grant usage on schema auth to supabase_auth_admin;grant select,insert,update on auth.users to supabase_auth_admin;`);
 await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'admin-fd330000@fixture.invalid',now())",[admin]);await db.query('insert into private.platform_admins(user_id,created_by)values($1,$1)',[admin]);
 await db.query("insert into private.demo_requests(id,request_id,name,email,company,phone,organisation_number,seeking,message,privacy_version,privacy_acknowledged_at,legacy)values($1,$2,'Synthetic Recipient',$3,'Recovery Dealer AB','0701234567','5568554884',array['system'],'Synthetic complete application','2026-10',now(),false)",[app,id(5),email]);
 const state={generated:0,providers:0,crash:true,sendingCrash:false};
 const sqlRpc=async(role,name,args)=>{try{return{data:await asRole(db,role,role==='authenticated'?admin:null,async tx=>(await tx.query(`select public.${name}(${Object.values(args).map((_,i)=>'$'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result),error:null};}catch(error){return{data:null,error};}};
 const actorSdk={auth:{async getUser(){return{data:{user:{id:admin,email:'admin-fd330000@fixture.invalid',email_confirmed_at:'2026-10-16T00:00:00Z'}},error:null};}},rpc:(n,a)=>sqlRpc('authenticated',n,a)};
 const service={rpc:(n,a)=>sqlRpc('service_role',n,a),auth:{admin:{async generateLink(input){state.generated++;assert.equal(input.type,'invite');assert.equal(input.email,email);assert.equal(input.options.redirectTo,'https://app.trafexa.com/activate-account');
  const exists=(await db.query('select count(*)::int n from auth.users where id=$1',[user])).rows[0].n;
  await db.transaction(async tx=>{await tx.exec('set local role supabase_auth_admin');if(!exists)await tx.query('insert into auth.users(id,email)values($1,$2)',[user,email]);await tx.query('update auth.users set invited_at=now() where id=$1',[user]);});
  if(state.crash){state.crash=false;throw Error('Synthetic interruption after committed Auth generation');}
  return{data:{properties:{hashed_token:createHash('sha224').update(email+'synthetic-otp').digest('hex'),verification_type:'invite'},user:{id:user,email}},error:null};
 }}}};
 const loader=await createSourceLoader({'server-only':{},react:{cache:fn=>fn},'next/cache':{revalidatePath(){}},'@/lib/supabase/server':{async createServerSupabaseClient(){return actorSdk;}},'@supabase/supabase-js':{createClient(){return service;}},'./account-invitation-transport':{async sendAccountInvitation(input){state.providers++;assert.match(input.body,/token_hash=[a-f0-9]{56}/);if(state.sendingCrash)throw Error('Synthetic provider interruption');return{status:'sent',providerId:'synthetic-accepted-once'};}}});
 return{db,state,action:loader.load('@/lib/platform-admin/application-invitation-send-actions').inviteApprovedApplicationAction,input:{applicationId:app,expectedVersion:1,reason:'Synthetic reviewed approval',requestId:nonce,acknowledged:true},async close(){await db.close();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}};
}

test('actual approval action recovers committed Auth creation without ciphertext by reclaiming the same invitation and reusing the unconfirmed user',async()=>{
 const h=await setup();try{
  assert.deepEqual(await h.action(h.input),{ok:false,code:'unavailable'});
  const gap=(await h.db.query('select i.id,i.user_id,i.consumed_at,d.state,d.ciphertext,d.attempt_count from private.application_account_invitations i join private.application_invitation_deliveries d on d.invitation_id=i.id')).rows[0];assert.equal(gap.user_id,user);assert.ok(gap.consumed_at);assert.equal(gap.state,'generating');assert.equal(gap.ciphertext,null);assert.equal(gap.attempt_count,0);assert.equal(h.state.providers,0);
  assert.deepEqual(await h.action(h.input),{ok:false,code:'unavailable'});assert.equal(h.state.generated,1,'unexpired generation lease must not generate again');
  await h.db.query("update private.application_invitation_deliveries set lease_until=now()-interval '1 second'");
  const recovered=await h.action(h.input);assert.equal(recovered.ok,true);assert.equal(recovered.status,'sent');assert.equal(recovered.invitationId,gap.id);assert.equal(h.state.generated,2);assert.equal(h.state.providers,1);
  const finished=(await h.db.query('select i.id,i.user_id,d.state,d.ciphertext,d.attempt_count from private.application_account_invitations i join private.application_invitation_deliveries d on d.invitation_id=i.id')).rows[0];assert.equal(finished.id,gap.id);assert.equal(finished.user_id,user);assert.equal(finished.state,'sent');assert.equal(finished.attempt_count,1);assert.ok(finished.ciphertext);assert.ok(!finished.ciphertext.includes('token_hash='));
  assert.equal((await h.db.query('select count(*)::int n from auth.users where lower(email)=$1',[email])).rows[0].n,1);assert.equal((await h.db.query('select count(*)::int n from private.application_account_invitations')).rows[0].n,1);assert.equal((await h.db.query('select count(*)::int n from private.account_approval_audit where user_id=$1',[user])).rows[0].n,1);
  const replay=await h.action({...h.input,requestId:id(99)});assert.equal(replay.status,'already_sent');assert.equal(replay.invitationId,gap.id);assert.equal(h.state.generated,2);assert.equal(h.state.providers,1);
 }finally{await h.close();}
});

test('after an uncertain send the actual approval action never regenerates or redispatches, even after lease expiry',async()=>{
 const h=await setup();try{h.state.crash=false;h.state.sendingCrash=true;assert.deepEqual(await h.action(h.input),{ok:false,code:'unavailable'});assert.equal(h.state.providers,1);assert.equal((await h.db.query('select state from private.application_invitation_deliveries')).rows[0].state,'sending');await h.db.query("update private.application_invitation_deliveries set lease_until=now()-interval '1 second'");const retry=await h.action(h.input);assert.equal(retry.status,'unknown');assert.equal(h.state.generated,1);assert.equal(h.state.providers,1);}finally{await h.close();}
});

test('revoking the real approving administrator after the unsent Auth gap prevents recovery before any additional generation or provider call',async()=>{
 const h=await setup();try{await h.action(h.input);await h.db.query("update private.application_invitation_deliveries set lease_until=now()-interval '1 second'");await h.db.query("update private.platform_admins set status='suspended'where user_id=$1",[admin]);const denied=await h.action(h.input);assert.equal(denied.code,'forbidden');assert.equal(h.state.generated,1);assert.equal(h.state.providers,0);}finally{await h.close();}
});
