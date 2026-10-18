import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
const fingerprint=value=>createHash('sha256').update(value).digest('hex');
import {createServerClient} from '@supabase/ssr';
import {createSourceLoader} from './helpers/source-loader.mjs';
const token='a'.repeat(56),userId='a1234567-0000-4000-8000-000000000001',otherId='b1234567-0000-4000-8000-000000000001';
const redirect=url=>{const error=Error('Framework redirect');error.url=url;throw error;};
async function harness(options={}){
 const values=new Map(),events=[],cookieEvents=[];
 if(options.cookie!==undefined)values.set('trafexa-password-recovery',options.cookie);
 const store={get:name=>values.has(name)?{value:values.get(name)}:undefined,set(name,value,config){cookieEvents.push([name,value,config]);if(config?.maxAge===0)values.delete(name);else values.set(name,value);},delete(name){cookieEvents.push([name,'delete']);values.delete(name);}};
 const loader=await createSourceLoader({
  'next/navigation':{redirect},'next/headers':{cookies:async()=>store},'next/cache':{revalidatePath:()=>assert.fail('No business writes')},
  '@/lib/auth/app-origin':{getAuthAppOrigin:()=> 'https://app.trafexa.com'},
  'next/server':{NextResponse:{redirect:url=>({url:String(url),headers:new Headers(),cookies:store})}},
  '@/lib/supabase/server':{createServerSupabaseClient:async()=>{events.push('client');if(options.clientFailure)throw Error('PRIVATE client secret');return{auth:{
   verifyOtp:async input=>{events.push(['verify',input]);if(options.verifyThrows)throw Error('PRIVATE verify secret');return{error:options.verifyError?{message:'PRIVATE expired token'}:null,data:{user:options.noVerifiedUser?null:{id:userId,email_confirmed_at:'2026-10-18T00:00:00Z'}}};},
   getUser:async()=>{events.push('fresh-user');if(options.freshThrows)throw Error('PRIVATE Auth secret');return{error:options.freshError?{message:'PRIVATE Auth error'}:null,data:{user:options.noSession?null:{id:options.wrongActor?otherId:userId}}};},
   updateUser:async input=>{events.push(['password',input]);if(options.writeThrows)throw Error('PRIVATE write secret');return{error:options.writeError?{message:'PRIVATE rejection'}:null};},
   signOut:async input=>{events.push(['signout',input]);if(options.logoutThrows)throw Error('PRIVATE logout secret');return{error:options.logoutError?{message:'PRIVATE logout rejection'}:null};},
  }};}},
 });
 return{values,events,cookieEvents,loader,async submit({password='long-fixture-password',next='/my-contracts?contract=fixture'}={}){const f=new FormData();f.set('passwordMode','recovery');f.set('recoveryFingerprint',fingerprint(token));f.set('password',password);f.set('next',next);f.set('token_hash','b'.repeat(56));f.set('email','attacker@example.invalid');try{await loader.load('@/lib/data/actions').updatePasswordAction(f);assert.fail('Expected redirect');}catch(e){assert.ok(e.url);const url=new URL(e.url,'https://app.trafexa.com');assert.doesNotMatch(url.href,/PRIVATE|secret|token_hash|attacker/);return url;}}};
}
test('recovery GET is inert even with no session or PKCE verifier, strictly scoped and scanner-safe',async()=>{
 const h=await harness(),get=h.loader.load('@/app/auth/recovery/route').GET;
 const r=await get({nextUrl:new URL(`https://app.trafexa.com/auth/recovery?token_hash=${token}&next=%2Fmy-contracts`)});
 assert.equal(r.url,'https://app.trafexa.com/reset-password?next=%2Fmy-contracts');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');assert.deepEqual(h.events,[]);
 assert.deepEqual(h.cookieEvents,[['trafexa-password-recovery',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/reset-password',maxAge:3600}]]);assert.ok(!r.url.includes(token));
 const external=await get({nextUrl:new URL(`https://app.trafexa.com/auth/recovery?token_hash=${token}&next=https://attacker.invalid`)});assert.equal(external.url,'https://app.trafexa.com/reset-password');
});
test('recovery GET rejects malformed duplicated and unexpected parameters and clears a prior scoped token',async()=>{for(const query of['token_hash=bad',`token_hash=${token}&token_hash=${token}`,`token_hash=${token}&next=/admin&next=/dashboard`,`token_hash=${token}&type=invite`,'']){const h=await harness({cookie:token}),r=await h.loader.load('@/app/auth/recovery/route').GET({nextUrl:new URL('https://app.trafexa.com/auth/recovery?'+query)});assert.equal(new URL(r.url).pathname,'/forgot-password');assert.deepEqual(h.events,[]);assert.equal(h.values.has('trafexa-password-recovery'),false);assert.equal(h.cookieEvents.at(-1)[2].path,'/reset-password');assert.equal(h.cookieEvents.at(-1)[2].maxAge,0);assert.ok(!r.url.includes(token));}});
test('explicit password POST validates first and uses only recovery-cookie token, exact recovery type and freshly matching Auth actor',async()=>{
 const h=await harness({cookie:token});assert.equal((await h.submit({password:'short'})).pathname,'/reset-password');assert.deepEqual(h.events,[]);assert.equal(h.values.get('trafexa-password-recovery'),token);
 const result=await h.submit();assert.equal(result.pathname,'/login');assert.equal(result.searchParams.get('next'),'/my-contracts?contract=fixture');assert.ok(result.searchParams.get('success'));
 assert.deepEqual(h.events,['client',['verify',{token_hash:token,type:'recovery'}],'fresh-user',['password',{password:'long-fixture-password'}],['signout',{scope:'global'}]]);assert.equal(h.values.has('trafexa-password-recovery'),false);assert.equal(h.cookieEvents[0][2].path,'/reset-password');assert.ok(h.cookieEvents.some(v=>v[0]==='trafexa-company'));
});
test('invalid expired consumed lost or switched recovery cannot silently reset an existing different account',async()=>{for(const options of[{cookie:'bad'},{cookie:token,verifyError:true},{cookie:token,verifyThrows:true},{cookie:token,noVerifiedUser:true},{cookie:token,wrongActor:true},{cookie:token,noSession:true},{cookie:token,freshError:true},{cookie:token,freshThrows:true}]){const h=await harness(options),r=await h.submit();assert.equal(r.pathname,options.cookie==='bad'?'/reset-password':'/forgot-password');assert.equal(h.events.some(v=>Array.isArray(v)&&v[0]==='password'),false);assert.equal(h.values.has('trafexa-password-recovery'),options.cookie==='bad');assert.equal(r.searchParams.has('success'),false);}});
test('client failure retains unconsumed recovery while rejected or ambiguous writes and failed global logout remain truthful',async()=>{
 const client=await harness({cookie:token,clientFailure:true});assert.equal((await client.submit()).pathname,'/reset-password');assert.equal(client.values.get('trafexa-password-recovery'),token);
 for(const options of[{writeError:true},{writeThrows:true},{logoutError:true},{logoutThrows:true}]){const h=await harness({cookie:token,...options}),r=await h.submit();assert.equal(h.values.has('trafexa-password-recovery'),options.cookie==='bad');assert.equal(r.searchParams.has('success'),false);assert.equal(r.pathname,options.writeError?'/reset-password':'/login');if(options.writeThrows)assert.match(r.searchParams.get('error'),/Lösenordsändringen kunde inte bekräftas/);if(options.logoutError||options.logoutThrows)assert.match(r.searchParams.get('error'),/Lösenordet har sparats.*utloggningen/);assert.equal(h.events.filter(v=>Array.isArray(v)&&v[0]==='verify').length,1);assert.equal(h.events.filter(v=>Array.isArray(v)&&v[0]==='password').length,1);}
});

test('actual Supabase SSR SDK proves legacy PKCE needs original browser verifier while the actual recovery GET/action establish and revoke a new-device session',{timeout:15000},async()=>{
 const jar=new Map(),requests=[];
 const user={id:userId,email:'synthetic-recovery@example.invalid',email_confirmed_at:'2026-10-18T00:00:00Z',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[]};
 const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const jwt=`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:userId,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})}.fixture_signature`;
 const db=createServerClient('https://synthetic-recovery.supabase.co','sb_publishable_fixture_only',{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>{for(const {name,value,options}of items)if(options?.maxAge===0)jar.delete(name);else jar.set(name,value);}},global:{fetch:async(input,init)=>{
  const url=new URL(String(input)),body=init.body?JSON.parse(init.body):null;requests.push([url.pathname,init.method,body]);
  assert.equal(url.origin,'https://synthetic-recovery.supabase.co');
  if(url.pathname==='/auth/v1/verify'){assert.deepEqual(body,{token_hash:token,type:'recovery',gotrue_meta_security:{}});return new Response(JSON.stringify({access_token:jwt,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,user}),{headers:{'Content-Type':'application/json'}});}
  if(url.pathname==='/auth/v1/user')return new Response(JSON.stringify(user),{headers:{'Content-Type':'application/json'}});
  if(url.pathname==='/auth/v1/logout')return new Response('{}',{headers:{'Content-Type':'application/json'}});
  assert.fail('Unexpected actual SDK network boundary '+url.pathname);
 }}});
 const legacy=await db.auth.exchangeCodeForSession('synthetic-pkce-code');assert.ok(legacy.error);assert.equal(legacy.error.code,'pkce_code_verifier_not_found');assert.equal(requests.length,0);
 const store={get:name=>jar.has(name)?{value:jar.get(name)}:undefined,set(name,value,config){if(config?.maxAge===0)jar.delete(name);else jar.set(name,value);},delete(name){jar.delete(name);}};
 const source=await createSourceLoader({'next/navigation':{redirect},'next/headers':{cookies:async()=>store},'next/cache':{revalidatePath:()=>assert.fail('No business writes')},'@/lib/supabase/server':{createServerSupabaseClient:async()=>db},'@/lib/auth/app-origin':{getAuthAppOrigin:()=> 'https://app.trafexa.com'},'next/server':{NextResponse:{redirect:url=>({url:String(url),headers:new Headers(),cookies:store})}}});
 const get=await source.load('@/app/auth/recovery/route').GET({nextUrl:new URL('https://app.trafexa.com/auth/recovery?token_hash='+token)});assert.equal(get.url,'https://app.trafexa.com/reset-password');assert.equal(requests.length,0,'Scanner GET neither consumes OTP nor changes the password');
 const form=new FormData();form.set('passwordMode','recovery');form.set('recoveryFingerprint',fingerprint(token));form.set('password','new-device-fixture-password');form.set('next','/my-contracts');
 await assert.rejects(()=>source.load('@/lib/data/actions').updatePasswordAction(form),error=>{const url=new URL(error.url,'https://app.trafexa.com');assert.equal(url.pathname,'/login');assert.equal(url.searchParams.get('next'),'/my-contracts');assert.ok(url.searchParams.get('success'));assert.equal(url.searchParams.has('error'),false);assert.ok(!url.href.includes(token));return true;});
 assert.equal((await db.auth.getSession()).data.session,null);assert.equal(jar.has('trafexa-password-recovery'),false);assert.ok(![...jar.keys()].some(key=>key.includes('code-verifier')));
 assert.deepEqual(requests.map(([path,method])=>[path,method]),[['/auth/v1/verify','POST'],['/auth/v1/user','GET'],['/auth/v1/user','PUT'],['/auth/v1/logout','POST']]);
});


test('rendered recovery intent cannot adopt a removed replaced or duplicated cookie binding, or fall back to an existing session',async()=>{
 for(const change of[h=>h.values.delete('trafexa-password-recovery'),h=>h.values.set('trafexa-password-recovery','b'.repeat(56))]){
  const h=await harness({cookie:token});change(h);const before=new Map(h.values),r=await h.submit();
  assert.equal(r.pathname,'/reset-password');assert.match(r.searchParams.get('error'),/flödet har ändrats/);assert.deepEqual(h.events,[]);assert.deepEqual(h.values,before,'A stale form must not clear another tab’s current recovery');
 }
 const h=await harness({cookie:token});for(const fields of[{}, {passwordMode:'session',expectedUserId:userId},{passwordMode:'recovery',recoveryFingerprint:fingerprint(token),expectedUserId:userId},{passwordMode:'recovery',recoveryFingerprint:'b'.repeat(64)}]){
  const form=new FormData();form.set('password','long-fixture-password');for(const[k,v]of Object.entries(fields))form.set(k,v);
  await assert.rejects(()=>h.loader.load('@/lib/data/actions').updatePasswordAction(form),error=>new URL(error.url,'https://app.trafexa.com').pathname==='/reset-password');assert.deepEqual(h.events,[]);
 }
 const duplicate=new FormData();duplicate.set('password','long-fixture-password');duplicate.append('passwordMode','recovery');duplicate.append('passwordMode','session');duplicate.set('recoveryFingerprint',fingerprint(token));await assert.rejects(()=>h.loader.load('@/lib/data/actions').updatePasswordAction(duplicate));assert.deepEqual(h.events,[]);
});
test('rendered session intent refuses a newly appeared recovery cookie or a different fresh Auth user',async()=>{
 for(const options of[{cookie:token},{wrongActor:true}]){
  const h=await harness(options),form=new FormData();form.set('password','long-fixture-password');form.set('passwordMode','session');form.set('expectedUserId',userId);
  await assert.rejects(()=>h.loader.load('@/lib/data/actions').updatePasswordAction(form),error=>{const r=new URL(error.url,'https://app.trafexa.com');assert.equal(r.pathname,options.cookie?'/reset-password':'/forgot-password');assert.equal(r.searchParams.has('success'),false);return true;});
  assert.equal(h.events.some(v=>Array.isArray(v)&&['verify','password','signout'].includes(v[0])),false);if(options.cookie)assert.deepEqual(h.events,[]);
 }
});
