import assert from 'node:assert/strict';
import {createSourceLoader} from '../../../tests/helpers/source-loader.mjs';
const previous={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY};
process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.invalid';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='synthetic-public';
const response=()=>({headers:new Map(),cookies:{items:[],set(...v){this.items.push(v)},getAll(){return[];}}});
try{
 const loader=await createSourceLoader({'next/server':{NextResponse:{next:response,redirect:url=>({...response(),url})}},'@supabase/ssr':{createServerClient:()=>({auth:{async getClaims(){return{data:{claims:null}};}}})}});
 const proxy=loader.load('src/proxy.ts').proxy;
 const results=[];
 for(const path of ['/admin/annonsprogram/10000000-0000-4000-8000-000000000001','/admin/annonsprogram/10000000-0000-4000-8000-000000000001?result=saved','/my-contracts?contract=10000000-0000-4000-8000-000000000001']){
  const nextUrl=new URL('https://app.trafexa.com'+path);nextUrl.clone=()=>new URL(nextUrl);
  const actual=await proxy({method:'GET',nextUrl,cookies:{getAll:()=>[],set(){}}});
  results.push({original:path,login:actual.url.pathname,next:actual.url.searchParams.get('next')});
 }
 assert.equal(results[0].next,'/admin');assert.equal(results[1].next,'/admin');assert.equal(results[2].next,results[2].original);
 const artifact={sourceCommit:'681df2dbbbc884218cd2d58b03c2ae037446c84c',defect:'Admin deep link destination is lost on session expiry',result:'REPRODUCED',results,boundary:'Actual proxy and routing source; controlled anonymous Auth, local fake NextResponse. No production requests or changes.'};
 console.log(JSON.stringify(artifact,null,2));
}finally{for(const [key,value]of[['NEXT_PUBLIC_SUPABASE_URL',previous.url],['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',previous.key]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
