import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';

let originalAppUrl;
beforeEach(() => { originalAppUrl = process.env.NEXT_PUBLIC_APP_URL; process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.invalid'; });
afterEach(() => { if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl; });

function redirect(url) {
  const error = new Error('Framework redirect');
  error.url = url; error.digest = `NEXT_REDIRECT;${url}`;
  throw error;
}
async function harness({ sdkError = null, networkError = false, clientError = false } = {}) {
  const calls = [];
  let clients = 0;
  const loader = await createSourceLoader({
    'next/navigation': { redirect },
    'next/headers': { cookies: () => { throw new Error('Recovery must not mutate cookies.'); } },
    'next/cache': { revalidatePath: () => { throw new Error('Recovery must not invalidate business data.'); } },
    './company-context': { getCompanySession: () => { throw new Error('Recovery must not access a company.'); } },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => {
      clients++;
      if (clientError) throw new Error('private client initialization detail');
      return { auth: { resetPasswordForEmail: async (email, options) => {
        calls.push({ email, options });
        if (networkError) throw new Error('private network/provider detail');
        return { data: {}, error: sdkError };
      } } };
    } },
  });
  const { forgotPasswordAction } = loader.load('src/lib/data/actions.ts');
  return {
    calls, clients: () => clients,
    async submit(email = 'buyer@example.invalid', next) {
      const form = new FormData(); form.set('email', email);if(next!==undefined)form.set('next',next);
      try { await forgotPasswordAction(form); assert.fail('Recovery should redirect.'); }
      catch (error) { assert.match(error.digest ?? '', /^NEXT_REDIRECT;/); return new URL(error.url, 'https://app.example.invalid'); }
    },
  };
}

test('confirmed recovery request keeps the conditional account-safe success message', async () => {
  const h = await harness();
  const result = await h.submit('  buyer@example.invalid  ');
  assert.equal(result.pathname, '/forgot-password');
  assert.equal(result.searchParams.has('error'), false);
  assert.equal(result.searchParams.get('success'), 'Om adressen har ett konto får du ett mejl med instruktioner för återställning.');
  assert.deepEqual(h.calls, [{ email: 'buyer@example.invalid', options: { redirectTo: 'https://app.example.invalid/auth/callback?next=/reset-password' } }]);
});

test('SDK failures produce the same generic error for missing accounts and rate limits', async () => {
  const messages = [];
  for (const sdkError of [{ code: 'user_not_found', message: 'Account does not exist: private provider detail' }, { code: 'over_email_send_rate_limit', message: 'SMTP provider-private-diagnostics' }]) {
    const h = await harness({ sdkError });
    const result = await h.submit();
    assert.equal(result.pathname, '/forgot-password');
    assert.equal(result.searchParams.has('success'), false);
    assert.equal(h.calls.length, 1);
    messages.push(result.searchParams.get('error'));
  }
  assert.deepEqual(messages, Array(2).fill('Återställningsförfrågan kunde inte behandlas just nu. Försök igen senare.'));
});

test('a rejected network request returns safe failure instead of success or raw diagnostics', async () => {
  const h = await harness({ networkError: true });
  const result = await h.submit();
  assert.equal(result.searchParams.has('success'), false);
  assert.equal(result.searchParams.get('error'), 'Återställningsförfrågan kunde inte behandlas just nu. Försök igen senare.');
  assert.equal(h.calls.length, 1);
});

test('client initialization failures use the same account-safe recovery error', async () => {
  const h = await harness({ clientError: true });
  const result = await h.submit();
  assert.equal(result.searchParams.has('success'), false);
  assert.equal(result.searchParams.get('error'), 'Återställningsförfrågan kunde inte behandlas just nu. Försök igen senare.');
  assert.equal(h.clients(), 1); assert.equal(h.calls.length, 0);
});

test('invalid email is rejected before creating a client or calling the provider', async () => {
  const h = await harness();
  for (const email of ['', 'invalid', 'a@b@c.example', 'buyer@example.invalid\nBcc: hidden@example.invalid']) {
    const result = await h.submit(email);
    assert.equal(result.searchParams.has('success'), false);
    assert.equal(result.searchParams.get('error'), 'Ange en giltig e-postadress.');
  }
  assert.equal(h.clients(), 0); assert.deepEqual(h.calls, []);
});


test('customer recovery preserves its destination through callback and account-safe messages', async () => {
 const h=await harness();const result=await h.submit('buyer@example.invalid','/my-offers');
 assert.equal(result.searchParams.get('next'),'/my-offers');
 const callback=new URL(h.calls[0].options.redirectTo);
 assert.equal(callback.pathname,'/auth/callback');
 const reset=new URL(callback.searchParams.get('next'),'https://app.example.invalid');
 assert.equal(reset.pathname,'/reset-password');assert.equal(reset.searchParams.get('next'),'/my-offers');
 const invalid=await h.submit('invalid','/my-offers');assert.equal(invalid.searchParams.get('next'),'/my-offers');assert.equal(h.calls.length,1);
});

test('recovery rejects an external destination before constructing its callback', async () => {
 const h=await harness();await h.submit('buyer@example.invalid','//attacker.invalid');
 assert.equal(new URL(h.calls[0].options.redirectTo).searchParams.get('next'),'/reset-password');
});

test('password update uses fresh Auth and keeps the customer destination after global signout', async () => {
 const events=[];const loader=await createSourceLoader({
  'next/navigation':{redirect},'next/headers':{cookies:async()=>({delete:name=>events.push(['cookie',name])})},
  'next/cache':{revalidatePath:()=>assert.fail('No business mutation')},
  './company-context':{getCompanySession:()=>assert.fail('No company membership needed')},
  '@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{
   getUser:async()=>{events.push('fresh-user');return {data:{user:{id:'buyer'}},error:null};},
   getClaims:()=>assert.fail('Claims do not authorize password changes'),
   updateUser:async payload=>{events.push(['password',payload.password]);return {error:null};},
   signOut:async options=>{events.push(['signout',options.scope]);return {error:null};},
  }})},
 });
 const form=new FormData();form.set('next','/my-offers');form.set('password','new-password-long');
 try{await loader.load('src/lib/data/actions.ts').updatePasswordAction(form);assert.fail('Expected redirect');}
 catch(error){const url=new URL(error.url,'https://app.example.invalid');assert.equal(url.pathname,'/login');assert.equal(url.searchParams.get('next'),'/my-offers');}
 assert.deepEqual(events,['fresh-user',['password','new-password-long'],['signout','global'],['cookie','trafexa-company']]);
});

test('password reset reports a saved password and unconfirmed logout on provider error or timeout, preserving next',async()=>{
 for(const throws of [false,true]){
  const events=[];
  const loader=await createSourceLoader({
   'next/navigation':{redirect},'next/headers':{cookies:async()=>({delete:name=>events.push(['cookie',name])})},
   'next/cache':{revalidatePath:()=>assert.fail('No business mutation')},
   '@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{
    getUser:async()=>({data:{user:{id:'buyer'}},error:null}),
    updateUser:async()=>{events.push('password-saved');return{error:null};},
    signOut:async()=>{events.push('logout');if(throws)throw Error('private provider diagnostics');return{error:{message:'private provider diagnostics'}};},
   }})},
  });
  const form=new FormData();form.set('next','/my-offers');form.set('password','new-password-long');
  try{await loader.load('src/lib/data/actions.ts').updatePasswordAction(form);assert.fail('Expected redirect');}
  catch(error){
   const url=new URL(error.url,'https://app.example.invalid');
   assert.equal(url.pathname,'/login');assert.equal(url.searchParams.get('next'),'/my-offers');assert.equal(url.searchParams.has('success'),false);
   assert.match(url.searchParams.get('error'),/Lösenordet har sparats/);assert.match(url.searchParams.get('error'),/utloggningen från alla sessioner kunde inte bekräftas/);
   assert.ok(!url.href.includes('private'));
  }
  assert.deepEqual(events,['password-saved','logout',['cookie','trafexa-company']]);
 }
});

test('password reset bounds client, identity and ambiguous password-write failures without replaying a write',async()=>{
 for(const step of ['client','identity','password']){
  const events=[];
  const loader=await createSourceLoader({
   'next/navigation':{redirect},'next/headers':{cookies:async()=>({delete:()=>assert.fail('No confirmed logout')})},
   'next/cache':{revalidatePath:()=>assert.fail('No business mutation')},
   '@/lib/supabase/server':{createServerSupabaseClient:async()=>{
    events.push('client');if(step==='client')throw Error('private provider diagnostics');
    return{auth:{getUser:async()=>{events.push('identity');if(step==='identity')throw Error('private provider diagnostics');return{data:{user:{id:'buyer'}},error:null};},
     updateUser:async()=>{events.push('password');throw Error('private provider diagnostics');},
     signOut:async()=>assert.fail('No confirmed password response'),
    }};
   }},
  });
  const form=new FormData();form.set('next','/my-offers');form.set('password','new-password-long');
  try{await loader.load('src/lib/data/actions.ts').updatePasswordAction(form);assert.fail('Expected redirect');}
  catch(error){
   const url=new URL(error.url,'https://app.example.invalid');
   assert.equal(url.pathname,step==='password'?'/login':'/forgot-password');assert.equal(url.searchParams.get('next'),'/my-offers');
   assert.equal(url.searchParams.has('success'),false);assert.ok(!url.href.includes('private'));
   if(step==='password')assert.match(url.searchParams.get('error'),/kunde inte bekräftas.*nya lösenord/);
  }
  assert.deepEqual(events,['client',...(step==='client'?[]:['identity']),...(step==='password'?['password']:[])]);
 }
});

test('customer logout preserves safe next while default and external destinations keep ordinary login',async()=>{
 for(const next of ['/my-offers',undefined,'https://attacker.invalid','//attacker.invalid']){
  const calls=[];
  const loader=await createSourceLoader({
   'next/navigation':{redirect},'next/headers':{cookies:async()=>({delete:name=>calls.push(['delete',name])})},
   'next/cache':{revalidatePath:()=>assert.fail('No business mutations')},
   './company-context':{getCompanySession:()=>assert.fail('No membership lookup')},
   '@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{signOut:async options=>{calls.push(['signout',options.scope]);return{error:null};}}})},
  });
  const form=new FormData();if(next!==undefined)form.set('next',next);
  try{await loader.load('src/lib/data/actions.ts').signOutAction(next===undefined?undefined:form);assert.fail('Expected redirect');}
  catch(error){assert.equal(error.url,next==='/my-offers'?'/login?next=%2Fmy-offers':'/login');}
  assert.deepEqual(calls,[['signout','global'],['delete','trafexa-company']]);
 }
});


test('ordinary logout reports unconfirmed global revocation on provider errors and initialization failures while clearing selection',async()=>{
 for(const mode of ['returned','throw','client'])for(const next of ['/my-contracts?contract=fixture','//attacker.invalid','/admin']){
  const calls=[],secret='PRIVATE provider Authorization Bearer fixture-secret';
  const loader=await createSourceLoader({
   'next/navigation':{redirect},'next/headers':{cookies:async()=>({delete:name=>calls.push(['delete',name])})},
   'next/cache':{revalidatePath:()=>assert.fail('No business invalidation')},
   './company-context':{getCompanySession:()=>assert.fail('No membership lookup')},
   '@/lib/supabase/server':{createServerSupabaseClient:async()=>{calls.push('client');if(mode==='client')throw Error(secret);return{auth:{
    signOut:async options=>{calls.push(['signout',options.scope]);if(mode==='throw')throw Error(secret);return{error:{message:secret,status:503}};},
    updateUser:()=>assert.fail('No password changes'),verifyOtp:()=>assert.fail('No invitation replay'),
   }};}},
  });
  const form=new FormData();form.set('next',next);
  await assert.rejects(()=>loader.load('src/lib/data/actions.ts').signOutAction(form),error=>{
   const url=new URL(error.url,'https://app.example.invalid');assert.equal(url.pathname,'/login');
   assert.equal(url.searchParams.get('next'),next.startsWith('//')?null:next);
   assert.equal(url.searchParams.get('error'),loader.load('@/lib/auth/sign-out').sessionSignOutUnconfirmedWarning);
   assert.equal(url.searchParams.has('success'),false);assert.doesNotMatch(error.url,/PRIVATE|Bearer|fixture-secret|attacker/);return true;
  });
  assert.deepEqual(calls,['client',...(mode==='client'?[]:[['signout','global']]),['delete','trafexa-company']]);
 }
});
