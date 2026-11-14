import assert from 'node:assert/strict';
import{test,before,after}from'node:test';
import{readFile}from'node:fs/promises';
import{createRequire}from'node:module';
import{createElement}from'react';
import{renderToStaticMarkup}from'react-dom/server';
import{createSourceLoader}from'./helpers/source-loader.mjs';
const require=createRequire(import.meta.url),{chromium,expect}=require('@playwright/test'),Chromium=require('@sparticuz/chromium').default;
let browser,html,css;
before(async()=>{
 const loader=await createSourceLoader({'next/link':({href,...props})=>createElement('a',{...props,href}),
  '@/lib/platform-admin/context':{requirePlatformAdminPageContext:async()=>({userId:'a2710000-0000-4000-8000-000000000001'})},
  '@/lib/data/actions':{signOutAction:'/synthetic-signout'},'@/components/platform-admin-workspace':{PlatformAdminActivation:()=>null}});
 html=renderToStaticMarkup(await loader.load('src/app/admin/layout.tsx').default({children:createElement('main',{},'Administration')}));
 css=await readFile(new URL('../src/app/globals.css',import.meta.url),'utf8');
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(x=>x!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();});
for(const width of[320,390,1440])test(`actual admin layout header has visible usable navigation at ${width}px`,async()=>{
 const page=await browser.newPage({viewport:{width,height:800}});try{
  await page.route('**/*',r=>r.abort());await page.setContent(`<html lang="sv"><style>${css}</style>${html}</html>`);
  await expect(page.getByRole('link',{name:'Trafexa, till startsidan'})).toBeVisible();
  for(const item of[page.getByRole('link',{name:'Kontakta Trafexa'}),page.getByRole('button',{name:'Logga ut'})]){
   await expect(item).toBeVisible();const box=await item.boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=width+1,'Header action overflows viewport');assert.ok(box.height>=44,'Header action is too small for touch');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await page.close();}
});
