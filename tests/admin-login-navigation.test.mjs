import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
const id='a1400000-0000-4000-8000-000000000001';
function redirect(url){const error=new Error('redirect');error.url=url;error.digest='NEXT_REDIRECT';throw error;}
async function harness({admin=true,user={id,email:'owner@example.invalid',email_confirmed_at:'2026-10-14T08:00:00Z'},rpcError=null,snapshotCompany=false,approved=true}={}){
 const calls=[];
 const db={auth:{getUser:async()=>{calls.push('fresh-user');return {data:{user},error:null};},signInWithPassword:async()=>({error:null}),exchangeCodeForSession:async()=>({error:null})},rpc:async(name)=>{calls.push(name);return {data:{is_platform_admin:admin,user_id:id},error:rpcError};}};
 const snapshot={user:{id,email:'owner@example.invalid'},organization:snapshotCompany?{id:'company'}:null,memberships:snapshotCompany?[{}]:[]};
 const loader=await createSourceLoader({
  'next/navigation':{redirect,notFound:()=>assert.fail('known route')},
  'next/headers':{cookies:async()=>({})},'next/cache':{revalidatePath:()=>{}},
  'next/server':{NextResponse:{redirect:url=>({url:String(url)})}},
  '@/lib/supabase/server':{createServerSupabaseClient:async()=>db},
  '@/lib/data/workspace':{getWorkspaceSnapshot:async()=>snapshot},
  '@/lib/account-access/context':{getAccountAccessContext:async()=>user?{userId:id,emailVerified:true,status:approved?'approved':'pending',isPlatformAdmin:admin}:null},
  '@/components/dealer-workspace':{DealerWorkspace:()=>null},'@/components/auth-shell':{AuthShell:()=>null},
 });
 return {loader,calls};
}
async function destination(fn){try{await fn();return null;}catch(error){assert.equal(error.digest,'NEXT_REDIRECT');return error.url;}}
test('default landing validates fresh verified Auth and private UUID registry, never an email or metadata claim',async()=>{
 for(const options of [{},{admin:false},{rpcError:{code:'42501'}},{user:{id,email:'hekmat.h@trafexa.com',email_confirmed_at:null,user_metadata:{is_platform_admin:true}}},{user:{id,email:'owner@example.invalid',email_confirmed_at:'invalid'}},{user:{id,email:'owner@example.invalid',email_confirmed_at:'2026-10-14',is_anonymous:true}}]){
  const h=await harness(options);const result=await h.loader.load('@/lib/auth/landing').getAuthenticatedLandingPath('/dashboard');
  assert.equal(result,Object.keys(options).length===0?'/admin':'/dashboard');assert.ok(h.calls.includes('fresh-user'));
 }
});
test('explicit customer, invitation and dealer routes retain destinations for approved accounts; recovery bypasses probes',async()=>{
 const h=await harness();const landing=h.loader.load('@/lib/auth/landing').getAuthenticatedLandingPath;
 for(const path of ['/my-offers','/invitations','/reset-password?next=%2Fadmin','/inventory','/settings','/admin'])assert.equal(await landing(path),path);
 assert.ok(h.calls.includes('get_platform_admin_session'));assert.equal(await landing('//attacker.invalid'),'/admin');
 const recovery=await harness({admin:false,approved:false});assert.equal(await recovery.loader.load('@/lib/auth/landing').getAuthenticatedLandingPath('/reset-password?next=%2Fadmin'),'/reset-password?next=%2Fadmin');assert.deepEqual(recovery.calls,[]);
});
test('password login and already logged-in login page send superadmin directly to admin',async()=>{
 const h=await harness();const form=new FormData();form.set('email','owner@example.invalid');form.set('password','private-password');
 assert.equal(await destination(()=>h.loader.load('src/lib/data/actions.ts').loginAction(form)),'/admin');
 assert.equal(await destination(()=>h.loader.load('src/app/login/page.tsx').default({searchParams:Promise.resolve({})})),'/admin');
 form.set('next','/my-offers');assert.equal(await destination(()=>h.loader.load('src/lib/data/actions.ts').loginAction(form)),'/my-offers');
});
test('app dashboard and onboarding never require a company from an active superadmin; company inventory is preserved',async()=>{
 const h=await harness();const page=h.loader.load('src/app/(dealer)/[section]/page.tsx').default;
 assert.equal(await destination(()=>page({params:Promise.resolve({section:'dashboard'}),searchParams:Promise.resolve({})})),'/admin');
 assert.equal(await destination(()=>h.loader.load('src/app/onboarding/page.tsx').default({searchParams:Promise.resolve({})})),'/admin');
 const dealer=await harness({admin:false});assert.equal(await destination(()=>dealer.loader.load('src/app/(dealer)/[section]/page.tsx').default({params:Promise.resolve({section:'dashboard'}),searchParams:Promise.resolve({})})),'/onboarding');
 const company=await harness({snapshotCompany:true});assert.equal(await destination(()=>company.loader.load('src/app/(dealer)/[section]/page.tsx').default({params:Promise.resolve({section:'inventory'}),searchParams:Promise.resolve({})})),null);
});
test('successful Auth callback chooses admin only for default dashboard, preserves reset and invitations',async()=>{
 const h=await harness();const callback=h.loader.load('src/app/auth/callback/route.ts').GET;
 for(const [next,expected] of [['','/admin'],['/reset-password','/reset-password'],['/invitations','/invitations'],['/my-offers','/my-offers']]){
  const result=await callback({nextUrl:new URL('https://app.trafexa.com/auth/callback?'+new URLSearchParams({code:'test-code',...(next?{next}:{})}))});assert.equal(new URL(result.url).pathname,expected);
 }
});
