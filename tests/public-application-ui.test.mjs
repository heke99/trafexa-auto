import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium,expect}=require('@playwright/test'),Chromium=require('@sparticuz/chromium').default,{webpack}=require('next/dist/compiled/webpack/webpack');
const repo=resolve('.');let browser,directory,bundle,styles;
before(async()=>{
 directory=await mkdtemp(resolve(tmpdir(),'trafexa-public-application-ui-'));bundle=resolve(directory,'fixture.js');styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');
 const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(repo,'tests/helpers/public-application-ui/entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js']},module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/register-ui/swc-loader.cjs')}]}});
 await new Promise((done,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done())));
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(arg=>arg!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function setup(width=390){
 const page=await browser.newPage({viewport:{width,height:950}}),posts=[],errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/demo-requests'){
   const payload=request.postDataJSON();posts.push(payload);
   await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({success:true,receipt:{requestId:payload.requestId,accepted:true}})});return;
  }
  if(request.url()==='https://public-application.trafexa.invalid/')return route.fulfill({contentType:'text/html',body:'<html lang="sv"></html>'});
  await route.abort();
 });
 await page.goto('https://public-application.trafexa.invalid/');await page.setContent(`<html lang="sv"><meta name="viewport" content="width=device-width"><style>${styles}</style><main class="wrap" style="max-width:640px;padding:16px;box-sizing:border-box"><div id="root"></div></main></html>`);await page.addScriptTag({path:bundle});
 await expect(page.getByRole('button',{name:'Skicka ansökan',exact:true})).toBeEnabled();
 await page.getByLabel('Företag',{exact:true}).fill('Fiktiv Bilfirma AB');await page.getByLabel('Ditt namn',{exact:true}).fill('Fiktiv Sökande');await page.getByLabel('Mejladress',{exact:true}).fill('isolated@example.invalid');await page.getByLabel('Telefon',{exact:true}).fill('070 123 45 67');
 await page.getByRole('checkbox',{name:'Trafexa-systemet',exact:true}).check();await page.getByLabel('Beskriv vad ni söker',{exact:true}).fill('Fiktivt ansökningsunderlag, ingen riktig ansökan.');await page.locator('[name=privacyAcknowledged]').check();
 return{page,posts,errors};
}
for(const value of ['5568554884','556855-4884','556855 - 4884','165568554884',' 16 556855-4884 '])test(`public application accepts and canonicalizes supported org number ${JSON.stringify(value)}`,async()=>{
 const{page,posts,errors}=await setup();try{
  await page.getByLabel('Organisationsnummer',{exact:true}).fill(value);await page.getByRole('button',{name:'Skicka ansökan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Tack. Vi hörs snart.'})).toBeVisible();assert.equal(posts.length,1);assert.equal(posts[0].organisationNumber,'5568554884');assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
for(const width of [320,1440])test(`invalid org number makes no request, then corrected copied number submits at ${width}px`,async()=>{
 const{page,posts,errors}=await setup(width);try{
  await page.getByLabel('Organisationsnummer',{exact:true}).fill('556855-4885');await page.getByRole('button',{name:'Skicka ansökan',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('kontrollsiffra');assert.equal(posts.length,0);assert.equal(await page.getByLabel('Organisationsnummer',{exact:true}).evaluate(node=>node.validity.customError),true);
  await page.getByLabel('Organisationsnummer',{exact:true}).fill('16 556855-4884');assert.equal(await page.getByLabel('Organisationsnummer',{exact:true}).evaluate(node=>node.validity.customError),false);
  await page.getByRole('button',{name:'Skicka ansökan',exact:true}).click();await expect(page.getByRole('heading',{name:'Tack. Vi hörs snart.'})).toBeVisible();assert.equal(posts.length,1);assert.equal(posts[0].organisationNumber,'5568554884');assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await page.close();}
});
