import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSourceLoader } from './helpers/source-loader.mjs';

const require=createRequire(import.meta.url);
const {chromium,expect}=require('@playwright/test');
const Chromium=require('@sparticuz/chromium').default;
const invitationId='bb300000-0000-4000-8000-000000000001';
const token=randomBytes(32).toString('base64url');
let browser,server,origin,handler;
const requests=[];

before(async()=>{
 const loader=await createSourceLoader({
  '@/lib/auth/app-origin':{getAuthAppOrigin:()=>origin},
  '@/lib/supabase/server':{createServerSupabaseClient:()=>assert.fail('Document GET must not use Auth or mutate SQL')},
  'next/server':{NextResponse:{redirect:url=>{
   const changes=[];
   return{url:String(url),headers:new Headers(),changes,cookies:{set:(name,value,options)=>changes.push(`${name}=${value}; Path=${options.path}; HttpOnly; SameSite=Lax; Max-Age=${options.maxAge}`)}};
  }}},
 });
 handler=loader.load('src/app/customer-document/invitation/route.ts').GET;
 server=createServer(async(request,response)=>{
  requests.push({path:new URL(request.url,origin).pathname,method:request.method,cookie:request.headers.cookie||''});
  if(request.url.startsWith('/customer-document/invitation')){
   const result=await handler({nextUrl:new URL(request.url,origin)});
   response.writeHead(307,{...Object.fromEntries(result.headers),Location:result.url,'Set-Cookie':result.changes});response.end();return;
  }
  // Transport fixture only: SQL authorization and the real document UI are tested separately.
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'});
  response.end('<!doctype html><html lang="sv"><main><h1>Granska dokumentet</h1><p>Ingen inloggning eller lösenord krävs.</p></main></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(value=>value!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});

test('scanner GET does not consume the personal link and a separate anonymous phone receives only a scoped HttpOnly guest capability',async()=>{
 const scanner=await browser.newContext();const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 try{
  const link=`${origin}/customer-document/invitation?invitation=${invitationId}&token=${token}`;
  const scan=await scanner.newPage();await scan.goto(link);await expect(scan).toHaveURL(`${origin}/customer-document`);
  assert.deepEqual(await phone.cookies(),[]);
  const page=await phone.newPage();await page.goto(link);await expect(page).toHaveURL(`${origin}/customer-document`);
  await expect(page.getByRole('heading',{name:'Granska dokumentet'})).toBeVisible();
  const cookies=await phone.cookies();assert.equal(cookies.length,1);
  assert.equal(cookies[0].name,'trafexa-guest-document');assert.equal(cookies[0].httpOnly,true);assert.equal(cookies[0].path,'/customer-document');assert.equal(cookies[0].sameSite,'Lax');
  assert.equal(cookies[0].value,`v1.${invitationId}.${token}`);
  assert.equal(await page.evaluate(()=>document.cookie),'');
  assert.ok(!page.url().includes(token));assert.equal(requests.every(item=>item.method==='GET'),true);
  const final=requests.filter(item=>item.path==='/customer-document').at(-1);
  assert.match(final.cookie,/trafexa-guest-document=/);assert.doesNotMatch(final.cookie,/sb-|auth|admin/i);
 }finally{await scanner.close();await phone.close();}
});
