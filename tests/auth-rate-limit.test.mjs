import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';

async function setup(error){
 const calls=[];
 const loader=await createSourceLoader({
  'next/navigation':{redirect(url){throw Object.assign(new Error('redirect'),{url,digest:'NEXT_REDIRECT;'+url});}},
  '@/lib/supabase/server':{async createServerSupabaseClient(){return{auth:{async signInWithPassword(input){calls.push(input);return{error};}}};}},
  '@/lib/auth/landing':{async getAuthenticatedLandingPath(next){return next;}},
 });
 return{calls,async submit(next='/my-contracts'){
  const form=new FormData();form.set('email','buyer@example.invalid');form.set('password','private-test-password');form.set('next',next);
  try{await loader.load('src/lib/data/actions.ts').loginAction(form);assert.fail('Expected redirect');}
  catch(e){assert.match(e.digest??'',/^NEXT_REDIRECT/);return new URL(e.url,'https://app.trafexa.com');}
 }};
}
test('login distinguishes provider throttling without exposing account or diagnostic details',async()=>{
 for(const error of [{status:429,message:'private account diagnostic'},{code:'over_request_rate_limit',message:'private limit diagnostic'},{code:'over_email_send_rate_limit',message:'private email diagnostic'}]){
  const h=await setup(error),url=await h.submit();assert.equal(url.pathname,'/login');assert.equal(url.searchParams.get('next'),'/my-contracts');
  assert.match(url.searchParams.get('error'),/För många inloggningsförsök/);assert.doesNotMatch(url.searchParams.get('error'),/Kontrollera e-post|private|buyer@example/);assert.equal(h.calls.length,1);
 }
});
test('non-throttled login failures retain the same account-safe message',async()=>{
 const messages=[];
 for(const error of [{status:400,code:'invalid_credentials',message:'private wrong password'},{status:400,code:'user_not_found',message:'private missing user'},{status:503,message:'private unavailable'}]){
  const h=await setup(error),url=await h.submit('https://evil.invalid/');assert.equal(url.pathname,'/login');assert.equal(url.searchParams.get('next'),'/dashboard');messages.push(url.searchParams.get('error'));
 }
 assert.deepEqual(messages,Array(3).fill('Inloggningen misslyckades. Kontrollera e-post och lösenord.'));
});
test('successful login remains on the verified landing path',async()=>{
 const h=await setup(null),url=await h.submit();assert.equal(url.pathname,'/my-contracts');assert.equal(url.searchParams.has('error'),false);assert.equal(h.calls.length,1);
});
