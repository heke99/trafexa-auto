import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
const invitationFingerprint=value=>createHash('sha256').update(value).digest('hex');
import {createSourceLoader} from './helpers/source-loader.mjs';
// Actual GoTrue GenerateTokenHash output is hexadecimal SHA-224 (56 characters).
const token='a'.repeat(56);
const redirect=url=>{const e=new Error('redirect');e.url=url;throw e;};
async function activation(options={}){
 const calls=[],mutations=[];
 const loader=await createSourceLoader({
  'next/navigation':{redirect},
  'next/headers':{cookies:async()=>({get:()=>options.noCookie?undefined:{value:token},set:(...v)=>mutations.push(v),delete:(...v)=>mutations.push(v)})},
  '@/lib/account-access/context':{requireApprovedAccountAccess:async()=>{calls.push('approval');if(options.denied)throw Error('denied');return{userId:options.wrongIdentity?'another-user':'review-user',emailVerified:true,status:'approved'};}},
  '@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{
   verifyOtp:async input=>{calls.push(['verify',input]);return{error:options.verifyError?{message:'private token diagnostics'}:null,data:{user:{id:'review-user',email_confirmed_at:'2026-01-01'}}};},
   updateUser:async input=>{calls.push(['password',input]);if(options.passwordThrows)throw Error('private ambiguous password diagnostics');return{error:options.passwordError?{message:'private password diagnostics'}:null};},
   signOut:async input=>{calls.push(['signOut',input]);if(options.signOutThrows)throw Error('private logout diagnostics');return{error:options.signOutError?{message:'private logout diagnostics'}:null};},
  }})},
 });
 const action=loader.load('src/lib/auth/activate-account-actions.ts').activateAccountAction;
 return{calls,mutations,async submit(input={}){
  const f=new FormData();f.set('invitationFingerprint',input.invitationFingerprint??invitationFingerprint(token));f.set('password',input.password??'a long synthetic password');f.set('acknowledged',input.acknowledged??'yes');f.set('token_hash','b'.repeat(64));f.set('email','forged@example.invalid');
  try{await action(f);assert.fail('Expected redirect');}catch(e){assert.ok(e.url);return new URL(e.url,'https://app.trafexa.com');}
 }};
}
test('invitation GET only deposits HttpOnly token and redirects to clean local form without consuming OTP',async()=>{
 const calls=[];
 const loader=await createSourceLoader({
  '@/lib/auth/app-origin':{getAuthAppOrigin:()=> 'https://app.trafexa.com'},
  '@/lib/supabase/server':{createServerSupabaseClient:()=>assert.fail('GET must not consume invite')},
  'next/server':{NextResponse:{redirect:url=>({url:String(url),headers:new Headers(),cookies:{set:(...v)=>calls.push(v)}})}},
 });
 const handler=loader.load('src/app/auth/invitation/route.ts').GET;
 const res=await handler({nextUrl:new URL(`https://app.trafexa.com/auth/invitation?token_hash=${token}&next=https://attacker.invalid`)});
 assert.equal(res.url,'https://app.trafexa.com/activate-account');assert.ok(!res.url.includes(token));
 assert.equal(res.headers.get('cache-control'),'private, no-store');assert.equal(res.headers.get('referrer-policy'),'no-referrer');
 assert.deepEqual(calls,[['trafexa-account-invitation',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/activate-account',maxAge:3600}]]);
 for(const invalid of ['', 'a'.repeat(55), 'a'.repeat(57), 'a'.repeat(63), 'b'.repeat(65),'x'.repeat(56)]){
  const failed=await handler({nextUrl:new URL('https://app.trafexa.com/auth/invitation?token_hash='+invalid)});
  assert.equal(new URL(failed.url).pathname,'/login');assert.ok(!failed.url.includes(invalid)||!invalid);
 }
 assert.equal(calls.length,1);
});
test('activation requires valid password, acknowledgement and server cookie before Auth IO',async()=>{
 const h=await activation();for(const input of [{password:'short'},{acknowledged:'no'},{password:'abc\n'+'x'.repeat(20)}])assert.equal((await h.submit(input)).pathname,'/activate-account');assert.deepEqual(h.calls,[]);
 const missing=await activation({noCookie:true});assert.equal((await missing.submit()).pathname,'/activate-account');assert.deepEqual(missing.calls,[]);
});
test('activation takes token only from HttpOnly cookie, verifies invite, checks private approval and sets password before global logout',async()=>{
 const h=await activation(),result=await h.submit();assert.equal(result.pathname,'/login');assert.ok(result.searchParams.get('success'));
 assert.deepEqual(h.calls,[['verify',{token_hash:token,type:'invite'}],'approval',['password',{password:'a long synthetic password'}],['signOut',{scope:'global'}]]);
 assert.equal(h.mutations[0][0],'trafexa-account-invitation');assert.equal(h.mutations[0][1],'');assert.equal(h.mutations[0][2].maxAge,0);
 assert.ok(!result.href.includes(token));
});
test('replayed or expired invite cannot report success or change any password',async()=>{
 const h=await activation({verifyError:true}),result=await h.submit();assert.equal(result.pathname,'/activate-account');assert.ok(result.searchParams.get('error'));assert.equal(h.calls.length,1);assert.deepEqual(h.mutations,[]);assert.ok(!result.href.includes('private'));
});
test('revoked private approval signs out verified session and refuses password activation',async()=>{
 const h=await activation({denied:true}),result=await h.submit();assert.equal(result.pathname,'/login');assert.ok(result.searchParams.get('error'));assert.deepEqual(h.calls.slice(1),['approval',['signOut',{scope:'global'}]]);assert.ok(!h.calls.some(v=>Array.isArray(v)&&v[0]==='password'));
});
test('password provider failure preserves verified reset opportunity without false activation success or token replay',async()=>{
 const h=await activation({passwordError:true}),result=await h.submit();assert.equal(result.pathname,'/reset-password');assert.ok(result.searchParams.get('error'));assert.equal(result.searchParams.has('success'),false);assert.equal(h.calls.filter(v=>Array.isArray(v)&&v[0]==='verify').length,1);assert.equal(h.mutations[0][2].maxAge,0);assert.ok(!result.href.includes('private'));
});

test('activation rejects a verified-session identity mismatch before setting a password',async()=>{const h=await activation({wrongIdentity:true}),result=await h.submit();assert.equal(result.pathname,'/login');assert.ok(result.searchParams.get('error'));assert.ok(!h.calls.some(v=>Array.isArray(v)&&v[0]==='password'));assert.deepEqual(h.calls.at(-1),['signOut',{scope:'global'}]);});

test('activation logout failures preserve saved-password fact without claiming completed logout or replaying the invitation',async()=>{
 for(const options of [{signOutError:true},{signOutThrows:true}]){
  const h=await activation(options),result=await h.submit();
  assert.equal(result.pathname,'/login');assert.equal(result.searchParams.has('success'),false);
  assert.match(result.searchParams.get('error'),/Lösenordet har sparats/);
  assert.match(result.searchParams.get('error'),/utloggningen från alla sessioner kunde inte bekräftas/);
  assert.ok(!result.href.includes('private'));
  assert.equal(h.calls.filter(v=>Array.isArray(v)&&v[0]==='verify').length,1);
  assert.equal(h.calls.filter(v=>Array.isArray(v)&&v[0]==='password').length,1);
  assert.ok(h.mutations.some(v=>v[0]==='trafexa-company'));
 }
});

test('revoked approval still returns a bounded denial when provider logout fails',async()=>{
 const h=await activation({denied:true,signOutThrows:true}),result=await h.submit();
 assert.equal(result.pathname,'/login');assert.match(result.searchParams.get('error'),/saknar godkänd åtkomst/);
 assert.ok(!h.calls.some(v=>Array.isArray(v)&&v[0]==='password'));
 assert.ok(!result.href.includes('private'));assert.ok(h.mutations.some(v=>v[0]==='trafexa-company'));
});

test('activation client initialization failure retains invitation for a safe retry before any OTP consumption',async()=>{
 const mutations=[];
 const loader=await createSourceLoader({
  'next/navigation':{redirect},
  'next/headers':{cookies:async()=>({get:()=>({value:token}),set:(...args)=>mutations.push(args),delete:(...args)=>mutations.push(args)})},
  '@/lib/supabase/server':{createServerSupabaseClient:async()=>{throw Error('private initialization diagnostic');}},
 });
 const form=new FormData();form.set('invitationFingerprint',invitationFingerprint(token));form.set('password','synthetic-password-long');form.set('acknowledged','yes');
 await assert.rejects(()=>loader.load('@/lib/auth/activate-account-actions').activateAccountAction(form),error=>{
  const url=new URL(error.url,'https://app.trafexa.com');assert.equal(url.pathname,'/activate-account');
  assert.match(url.searchParams.get('error'),/Försök igen med samma inbjudningslänk/);assert.ok(!url.href.includes('private'));return true;
 });
 assert.deepEqual(mutations,[]);
});


test('activation with a lost password-write response reports ambiguity without claiming rejection or replaying the consumed invite',async()=>{
 const h=await activation({passwordThrows:true}),result=await h.submit();
 assert.equal(result.pathname,'/login');assert.equal(result.searchParams.has('success'),false);
 assert.match(result.searchParams.get('error'),/Lösenordsändringen kunde inte bekräftas/);
 assert.doesNotMatch(result.href,/private|diagnostics|token_hash/);
 assert.equal(h.calls.filter(v=>Array.isArray(v)&&v[0]==='verify').length,1);
 assert.equal(h.calls.filter(v=>Array.isArray(v)&&v[0]==='password').length,1);
 assert.equal(h.calls.some(v=>Array.isArray(v)&&v[0]==='signOut'),false);
 assert.equal(h.mutations[0][0],'trafexa-account-invitation');assert.equal(h.mutations[0][2].maxAge,0);
 assert.ok(h.mutations.some(v=>v[0]==='trafexa-company'));
});


test('stale activation form cannot consume a replacement invitation from another tab',async()=>{
 const h=await activation(),result=await h.submit({invitationFingerprint:invitationFingerprint('b'.repeat(56))});
 assert.equal(result.pathname,'/activate-account');assert.match(result.searchParams.get('error'),/har ändrats/);assert.deepEqual(h.calls,[]);assert.deepEqual(h.mutations,[]);
});
