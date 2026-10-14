import assert from 'node:assert/strict';
import {test,beforeEach,afterEach} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
let saved;
const keys=['NEXT_PUBLIC_APP_URL','NODE_ENV','VERCEL_ENV'];
beforeEach(()=>{saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));delete process.env.NODE_ENV;delete process.env.VERCEL_ENV;delete process.env.NEXT_PUBLIC_APP_URL;});
afterEach(()=>{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
async function helper(){return (await createSourceLoader()).load('@/lib/auth/app-origin').getAuthAppOrigin;}
test('production callback origin stays on Trafexa despite localhost, foreign or malformed configuration',async()=>{
 const get=await helper();process.env.VERCEL_ENV='production';
 for(const value of ['http://localhost:3000','https://attacker.invalid','not-a-url','https://app.trafexa.com/path']){process.env.NEXT_PUBLIC_APP_URL=value;assert.equal(get('https://untrusted-host.invalid'),'https://app.trafexa.com');}
 delete process.env.VERCEL_ENV;process.env.NODE_ENV='production';assert.equal(get(),'https://app.trafexa.com');
});
test('development and preview allow only explicit valid origins without credentials or URL suffixes',async()=>{
 const get=await helper();process.env.VERCEL_ENV='preview';process.env.NODE_ENV='production';
 for(const value of ['https://review.vercel.app','http://localhost:3000','http://127.0.0.1:3010']){process.env.NEXT_PUBLIC_APP_URL=value;assert.equal(get(),value);}
 for(const value of ['http://attacker.invalid','https://user:password@app.trafexa.com','https://app.trafexa.com/?next=bad','https://app.trafexa.com/#bad','ftp://localhost:3000']){process.env.NEXT_PUBLIC_APP_URL=value;assert.equal(get(),'https://app.trafexa.com');}
});
test('actual signup and recovery send production callbacks preserving admin and password destinations',async()=>{
 process.env.VERCEL_ENV='production';process.env.NEXT_PUBLIC_APP_URL='http://localhost:3000';const calls=[];
 const loader=await createSourceLoader({'next/navigation':{redirect(url){const e=new Error('redirect');e.url=url;throw e;}},'next/headers':{cookies:()=>assert.fail('No cookies in signup/recovery')},'next/cache':{revalidatePath:()=>assert.fail('No business mutation')},'./company-context':{getCompanySession:()=>assert.fail('No membership')},'@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{signUp:async data=>{calls.push(data.options.emailRedirectTo);return{error:null};},resetPasswordForEmail:async(_email,options)=>{calls.push(options.redirectTo);return{error:null};}}})}});
 const actions=loader.load('@/lib/data/actions');const form=new FormData();form.set('email','owner@example.invalid');form.set('password','long-private-fixture-password');form.set('acknowledgement','yes');form.set('next','/admin');
 await assert.rejects(actions.signupAction(form),e=>e.url.startsWith('/login?'));await assert.rejects(actions.forgotPasswordAction(form),e=>e.url.startsWith('/forgot-password?'));
 for(const value of calls){const url=new URL(value);assert.equal(url.origin,'https://app.trafexa.com');assert.equal(url.pathname,'/auth/callback');}
 assert.equal(new URL(calls[0]).searchParams.get('next'),'/admin');const reset=new URL(new URL(calls[1]).searchParams.get('next'),'https://app.trafexa.com');assert.equal(reset.pathname,'/reset-password');assert.equal(reset.searchParams.get('next'),'/admin');
});
test('actual callback exchanges a code only on the server then redirects safely to production',async()=>{
 process.env.VERCEL_ENV='production';process.env.NEXT_PUBLIC_APP_URL='http://localhost:3000';let exchanges=0;
 const loader=await createSourceLoader({'next/server':{NextResponse:{redirect:url=>({url:String(url)})}},'@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{exchangeCodeForSession:async code=>{assert.equal(code,'fixture-code');exchanges++;return{error:null};}}})}});
 const handler=loader.load('src/app/auth/callback/route.ts').GET;
 const result=await handler({nextUrl:new URL('http://localhost:3000/auth/callback?code=fixture-code&next=/admin')});assert.equal(result.url,'https://app.trafexa.com/admin');assert.equal(exchanges,1);
 const external=await handler({nextUrl:new URL('https://host.invalid/auth/callback?code=fixture-code&next=//attacker.invalid')});assert.equal(external.url,'https://app.trafexa.com/dashboard');
 const missing=await handler({nextUrl:new URL('http://localhost:3000/auth/callback?next=/admin')});const destination=new URL(missing.url);assert.equal(destination.origin,'https://app.trafexa.com');assert.equal(destination.searchParams.get('next'),'/admin');assert.equal(destination.searchParams.has('code'),false);
});
