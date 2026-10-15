import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createSourceLoader} from './helpers/source-loader.mjs';
function redirect(url){const error=new Error('redirect');error.url=url;throw error;}
async function harness({status='pending',admin=false,unavailable=false,user=true}={}){
 let reads=0;
 const loader=await createSourceLoader({
  'next/navigation':{redirect,notFound(){throw new Error('404');}},'next/link':({children,...props})=>createElement('a',props,children),
  '@/components/auth-shell':{AuthShell:({children,title,subtitle})=>createElement('main',{},createElement('h1',{},title),createElement('p',{},subtitle),children)},
  '@/components/company-onboarding':{CompanyOnboarding:()=>null},'@/components/dealer-workspace':{DealerWorkspace:()=>null},'@/components/customer-offer-reviews':{CustomerOfferReviews:()=>assert.fail('Unapproved business component')},'@/components/company-invitations':{CompanyInvitations:()=>assert.fail('Unapproved invitation component')},'@/components/brand':{Brand:()=>null},
  '@/lib/platform-admin/context':{getPlatformAdminContext:async()=>admin?{userId:'actor'}:null},
  '@/lib/account-access/context':{getAccountAccessContext:async()=>{if(unavailable)throw new Error('Unavailable');return user?{userId:'actor',email:'new@example.invalid',emailVerified:true,status,version:0,isPlatformAdmin:false}:null;}},
  '@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:user?{id:'actor',email:'new@example.invalid',email_confirmed_at:'2026-10-14T08:00:00Z'}:null},error:null})}})},
  '@/lib/data/actions':{signOutAction(){},createCompanyAction(){assert.fail('No company creation');}},
  '@/lib/data/workspace':{getWorkspaceSnapshot:async()=>{reads++;assert.fail('No workspace data before approval');}},
 });return {loader,reads:()=>reads};
}
test('pending, rejected and suspended accounts cannot directly open workspace, onboarding, offers or invitations',async()=>{
 for(const status of ['pending','rejected','suspended']){
  const h=await harness({status});
  for(const [path,args]of [
   ['src/app/(dealer)/[section]/page.tsx',{params:Promise.resolve({section:'inventory'}),searchParams:Promise.resolve({})}],
   ['src/app/onboarding/page.tsx',{searchParams:Promise.resolve({})}],['src/app/my-offers/page.tsx',undefined],['src/app/invitations/page.tsx',undefined],
  ])await assert.rejects(()=>h.loader.load(path).default(args),error=>error.url===(path.includes('my-offers')?'/account-pending?next=%2Fmy-offers':path.includes('invitations')?'/account-pending?next=%2Finvitations':'/account-pending'));
  assert.equal(h.reads(),0);
 }
});
test('pending login destinations including admin are gated while recovery remains reachable',async()=>{
 const h=await harness();const landing=h.loader.load('@/lib/auth/landing').getAuthenticatedLandingPath;
 for(const path of ['/dashboard','/inventory','/onboarding','/my-offers','/invitations'])assert.equal(await landing(path),['/dashboard','/onboarding'].includes(path)?'/account-pending':`/account-pending?${new URLSearchParams({next:path})}`);
 assert.equal(await landing('/reset-password?next=%2Fadmin'),'/reset-password?next=%2Fadmin');assert.equal(await landing('/forgot-password'),'/forgot-password');assert.equal(await landing('/admin'),'/account-pending?next=%2Fadmin');
});
test('waiting page describes actual status with logout and refresh but no company creation, then redirects after approval',async()=>{
 for(const [status,title]of [['pending','inv äntar godkännande'],['rejected','inte godkänts'],['suspended','avstängd']]){
  const h=await harness({status});const html=renderToStaticMarkup(await h.loader.load('src/app/account-pending/page.tsx').default());assert.ok(html.includes(title.replace('inv äntar','inväntar')));assert.match(html,/Logga ut|Kontrollera åtkomst igen|info@trafexa.com/);assert.doesNotMatch(html,/Skapa företagskonto|organisation_number|createCompany/);
 }
 const approved=await harness({status:'approved'});await assert.rejects(()=>approved.loader.load('src/app/account-pending/page.tsx').default(),error=>error.url==='/dashboard');
 const admin=await harness({admin:true});await assert.rejects(()=>admin.loader.load('src/app/account-pending/page.tsx').default(),error=>error.url==='/admin');assert.equal(admin.reads(),0);
});
test('unavailable approval fails closed with retry access and anonymous waiting requests reach login',async()=>{
 const h=await harness({unavailable:true});assert.equal(await h.loader.load('@/lib/auth/landing').getAuthenticatedLandingPath('/inventory'),'/account-pending?next=%2Finventory');
 const html=renderToStaticMarkup(await h.loader.load('src/app/account-pending/page.tsx').default());assert.match(html,/kunde inte verifieras|Kontrollera åtkomst igen/);assert.doesNotMatch(html,/Skapa företag/);
 const anonymous=await harness({user:false});await assert.rejects(()=>anonymous.loader.load('src/app/account-pending/page.tsx').default(),error=>error.url==='/login');
});

test('direct admin denies pending, rejected and suspended accounts; approved verified reservation may reach activation',async()=>{
 class PlatformAdminError extends Error{constructor(code){super(code);this.code=code;}}
 for(const status of ['pending','rejected','suspended','approved']){
  let activated=0;
  const loader=await createSourceLoader({
   'next/navigation':{redirect,notFound(){throw new Error('404');}},
   '@/lib/platform-admin/context':{PlatformAdminError,requirePlatformAdminPageContext:async()=>{throw new PlatformAdminError('forbidden');},requirePlatformAuthenticatedContext:async()=>({userId:'actor'})},
   '@/lib/account-access/context':{getAccountAccessContext:async()=>({emailVerified:true,status})},
   '@/lib/platform-admin/actions':{listPlatformCompaniesAction:()=>assert.fail('No global data')},
   '@/components/platform-admin-workspace':{PlatformAdminActivation:()=>{activated++;return createElement('p',{},'Aktivering');},PlatformAdminWorkspace:()=>assert.fail('No global workspace')},
  });
  if(status==='approved'){const html=renderToStaticMarkup(await loader.load('src/app/admin/page.tsx').default());assert.match(html,/Aktivering/);assert.equal(activated,1);}
  else {await assert.rejects(()=>loader.load('src/app/admin/page.tsx').default(),error=>error.url==='/account-pending?next=%2Fadmin');assert.equal(activated,0);}
 }
});

test('customer and invitation destinations survive pending approval without requiring company onboarding',async()=>{
 for(const next of ['/my-offers','/invitations']){
  const pending=await harness();const url=await pending.loader.load('@/lib/auth/landing').getAuthenticatedLandingPath(next);assert.equal(url,`/account-pending?${new URLSearchParams({next})}`);
  const html=renderToStaticMarkup(await pending.loader.load('src/app/account-pending/page.tsx').default({searchParams:Promise.resolve({next})}));assert.ok(html.includes(`value="${next}"`));assert.ok(html.includes(`/account-pending?next=${encodeURIComponent(next)}`));assert.doesNotMatch(html,/Skapa företagskonto/);
  const approved=await harness({status:'approved'});await assert.rejects(()=>approved.loader.load('src/app/account-pending/page.tsx').default({searchParams:Promise.resolve({next})}),error=>error.url===next);assert.equal(approved.reads(),0);
 }
});
test('unsafe and recursive waiting destinations resolve safely to the default workspace',async()=>{
 for(const next of ['https://evil.invalid','//evil.invalid','/account-pending?next=%2Fmy-offers','/account-pending']){
  const pending=await harness();assert.equal(pending.loader.load('@/lib/auth/landing').getAccountPendingPath(next),'/account-pending');
  const approved=await harness({status:'approved'});await assert.rejects(()=>approved.loader.load('src/app/account-pending/page.tsx').default({searchParams:Promise.resolve({next})}),error=>error.url==='/dashboard');
 }
});
