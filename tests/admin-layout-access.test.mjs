import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NextRequest} from 'next/server.js';
import {createSourceLoader} from './helpers/source-loader.mjs';
const ACTOR='a2710000-0000-4000-8000-000000000001',OTHER='a2710000-0000-4000-8000-000000000002';
const origin='https://app.trafexa.com',program=`/admin/annonsprogram/${OTHER}?result=saved&filter=a%26b`;
const redirect=url=>{throw Object.assign(Error('redirect'),{url});};
const preparedContexts=new WeakSet();
const notFound=()=>{throw Object.assign(Error('Not found'),{status:404});};
async function fixture(t,{admin=false,user=true,eligible=false,probeActor=ACTOR,probeError=false}={}){
 if(!preparedContexts.has(t)){preparedContexts.add(t);
 const old=[process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY];
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.invalid';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='synthetic-public';
 t.after(()=>{for(const [i,key]of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].entries())if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];});
 }
 const state={user,admin,eligible,header:null,calls:[]};
 const db={auth:{async getUser(){return{data:{user:state.user?{id:ACTOR,email:'admin@fixture.invalid',email_confirmed_at:'2026-11-14T08:00:00Z'}:null},error:null};}},async rpc(name){state.calls.push(name);if(name==='get_platform_admin_session')return state.admin?{data:{user_id:ACTOR,is_platform_admin:true},error:null}:{data:null,error:{code:'42501'}};if(name==='get_platform_admin_activation_access')return{data:{user_id:probeActor,can_activate:state.eligible},error:probeError?{code:'unavailable'}:null};assert.fail('No claims or business reads: '+name);}};
 const loader=await createSourceLoader({
  'next/navigation':{redirect,notFound},'next/headers':{async headers(){return new Headers(state.header?{'x-trafexa-admin-path':state.header}:{});}},
  '@/lib/supabase/server':{createServerSupabaseClient:async()=>db},
  '@supabase/ssr':{createServerClient(_url,_key,{cookies}){return{auth:{async getClaims(){cookies.setAll([{name:'synthetic-session',value:'refreshed',options:{httpOnly:true}}]);return{data:{claims:{sub:ACTOR}},error:null};}}};}},
  '@/components/brand':{Brand:()=>null},'@/lib/data/actions':{signOutAction:()=>assert.fail('No signout during read')},
  '@/components/platform-admin-workspace':{PlatformAdminActivation:()=>null,PlatformAdminWorkspace:()=>null},
  '@/components/email-delivery-status':{EmailDeliveryStatus:()=>null},
  '@/lib/platform-admin/actions':{listPlatformCompaniesAction:()=>assert.fail('No global read for forbidden identity')},
 });
 return{state,proxy:loader.load('src/proxy.ts').proxy,layout:()=>loader.load('src/app/admin/layout.tsx').default({children:'authorized-child'}),page:()=>loader.load('src/app/admin/page.tsx').default(),path:()=>loader.load('src/lib/platform-admin/route-path.ts').platformAdminReturnPath()};
}
test('proxy overwrites forged admin return metadata and keeps refreshed cookies for the server layout',async t=>{
 const h=await fixture(t,{user:false}),response=await h.proxy(new NextRequest(origin+program,{headers:{'x-trafexa-admin-path':'//outside.invalid','cookie':'prior-session=kept'}}));
 assert.equal(response.headers.get('x-middleware-request-x-trafexa-admin-path'),program);
 assert.match(response.headers.get('x-middleware-request-cookie'),/synthetic-session=refreshed/);assert.match(response.headers.get('x-middleware-request-cookie'),/prior-session=kept/);
 h.state.header=response.headers.get('x-middleware-request-x-trafexa-admin-path');
 await assert.rejects(h.layout,error=>new URL(error.url,origin).searchParams.get('next')===program);
 assert.equal(h.state.calls.length,0);
});
test('ordinary verified account sees neither activation nor admin page without an actual reservation',async t=>{
 const h=await fixture(t);await assert.rejects(h.layout,error=>error.status===404);await assert.rejects(h.page,error=>error.status===404);
 assert.deepEqual(new Set(h.state.calls),new Set(['get_platform_admin_session','get_platform_admin_activation_access']));
});
test('only own explicit eligible reservation reaches activation and reads never claim access',async t=>{
 const h=await fixture(t,{eligible:true});const layout=await h.layout();assert.ok(layout);assert.ok(await h.page());
 assert.equal(h.state.calls.some(name=>/claim|list_platform/.test(name)),false);
});
test('mismatched actor and unavailable eligibility fail closed before showing activation',async t=>{
 for(const config of [{eligible:true,probeActor:OTHER},{eligible:true,probeError:true}]){const h=await fixture(t,config);await assert.rejects(h.layout,error=>error.status===404);await assert.rejects(h.page,error=>error.status===404);}
});
test('return metadata is local admin navigation only and never grants administrator authority',async t=>{
 const h=await fixture(t);for(const value of ['https://outside.invalid','//outside.invalid','/inventory','/admin\n','/\\outside.invalid']){h.state.header=value;assert.equal(await h.path(),'/admin');}
 h.state.header=program;assert.equal(await h.path(),program);await assert.rejects(h.layout,error=>error.status===404);
});
test('fresh authorized superadmin can render layout without company membership or activation probes',async t=>{
 const h=await fixture(t,{admin:true});const node=await h.layout();assert.equal(node.props.children[1],'authorized-child');assert.deepEqual(h.state.calls,['get_platform_admin_session']);
});
