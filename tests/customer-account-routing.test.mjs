import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSourceLoader } from './helpers/source-loader.mjs';

function redirect(url){const error=new Error('redirect');error.url=url;throw error;}
async function page(user,error=null){
 let checks=0;
 const loader=await createSourceLoader({
  'next/navigation':{redirect},'next/link':({children,...props})=>createElement('a',props,children),
  '@/components/brand':{Brand:()=>null},
  '@/components/customer-offer-reviews':{CustomerOfferReviews:({userId})=>({type:'div',props:{'data-customer':userId},$$typeof:Symbol.for('react.transitional.element')})},
  '@/lib/data/actions':{signOutAction:()=>{}},
  '@/lib/supabase/server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>{checks++;return {data:{user},error};},getClaims:()=>assert.fail('Fresh user required')}})},
 });
 return {run:()=>loader.load('src/app/my-offers/page.tsx').default(),checks:()=>checks};
}
test('customer account page requires fresh Auth and never routes through company onboarding',async()=>{
 for(const [user,error] of [[null,null],[{id:'buyer'},new Error('Revoked session')]]){
  const h=await page(user,error);await assert.rejects(h.run(),e=>e.url==='/login?next=/my-offers');assert.equal(h.checks(),1);
 }
});
test('unverified and anonymous users cannot mount the customer review component',async()=>{
 for(const user of [{id:'buyer',email:'private@example.invalid'},{id:'buyer',email:'private@example.invalid',email_confirmed_at:'invalid'},{id:'buyer',email:'private@example.invalid',email_confirmed_at:'2026-10-14',is_anonymous:true}]){
  const h=await page(user);const html=renderToStaticMarkup(await h.run());assert.match(html,/Verifiera din e-postadress/);assert.doesNotMatch(html,/data-customer|private@example/);
 }
});
test('verified customer mounts their review list without exposing Auth email in server heading',async()=>{
 const h=await page({id:'buyer',email:'private@example.invalid',email_confirmed_at:'2026-10-14',is_anonymous:false});
 const html=renderToStaticMarkup(await h.run());assert.match(html,/data-customer="buyer"/);assert.match(html,/Mina offerter/);assert.doesNotMatch(html,/private@example|onboarding/);assert.match(html,/info@trafexa.com/);
});

test('customer proxy preserves refreshed cookies and no-store through an unauthenticated redirect',async()=>{
 const make=(location=null)=>({headers:new Map(),location,cookies:{items:[],set(...args){this.items.push(args);},getAll(){return this.items.map(([name,value])=>({name,value}));}}});
 const priorUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,priorKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://project.example.invalid';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='public';
 try{
  const loader=await createSourceLoader({
   'next/server':{NextResponse:{next:()=>make(),redirect:location=>make(location)}},
   '@supabase/ssr':{createServerClient:(_url,_key,{cookies})=>({auth:{getClaims:async()=>{cookies.setAll([{name:'auth',value:'refreshed',options:{httpOnly:true}}]);return {data:{claims:null}};}}})},
  });
  const nextUrl=new URL('https://app.trafexa.com/my-offers');nextUrl.clone=()=>new URL(nextUrl);
  const writes=[];const request={nextUrl,method:'GET',cookies:{getAll:()=>[],set:(...args)=>writes.push(args)}};
  const result=await loader.load('src/proxy.ts').proxy(request);
  assert.equal(result.location.pathname,'/login');assert.equal(result.location.searchParams.get('next'),'/my-offers');
  assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal(result.cookies.items[0][0].name,'auth');
  assert.deepEqual(writes,[['auth','refreshed']]);
 }finally{
  if(priorUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=priorUrl;
  if(priorKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=priorKey;
 }
});
