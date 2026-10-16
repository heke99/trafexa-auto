import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium,expect}=require('@playwright/test'),Chromium=require('@sparticuz/chromium').default,{webpack}=require('next/dist/compiled/webpack/webpack');
const repo=fileURLToPath(new URL('../',import.meta.url));
const props={companyId:'company-1',dealId:'deal-1',referenceId:'signing-1',kind:'contract_invitation',userId:'actor-1',role:'owner'};
const ack='Jag har granskat mottagaren och vill försöka skicka den väntande mejlinbjudan igen.';
let browser,directory,styles;
before(async()=>{
 directory=await mkdtemp(resolve(tmpdir(),'trafexa-customer-email-ui-'));styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');
 const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(repo,'tests/helpers/customer-email-ui/entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/data/customer-email-actions':resolve(repo,'tests/helpers/customer-email-ui/actions.js')}},module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/contract-ui/swc-loader.cjs')}]}});
 await new Promise((done,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error??Error(stats.toString({all:false,errors:true}))):done())));
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(arg=>arg!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function setup(overrides={},fixture={}){
 const page=await browser.newPage({viewport:{width:390,height:1000}});await page.route('**/*',route=>route.abort());await page.setContent(`<style>${styles}</style><main style="padding:20px"><div id="root"></div></main>`);
 await page.evaluate(fixture=>{window.fixture={deliveryResponse:{ok:true,delivery:{status:'pending',transport:'configured'}},...fixture};},fixture);await page.addScriptTag({path:resolve(directory,'fixture.js')});await page.evaluate(props=>window.mountCustomerEmail(props),{...props,...overrides});return page;
}
async function review(page){await page.getByRole('button',{name:'Granska nytt utskicksförsök'}).click();await expect(page.getByRole('heading',{name:'Kontrollera mottagaren före nytt försök'})).toBeFocused();}
async function retryCalls(page){return page.evaluate(()=>window.fixture.customerEmailCalls?.filter(call=>call.kind==='retry')??[]);}
test('owner retries only after recipient review and consent, locks double clicks and reports provider acceptance honestly',async()=>{
 const page=await setup({}, {customerEmailRetries:[{hold:true}]});try{
  await review(page);await expect(page.getByRole('button',{name:'Försök skicka mejlet igen',exact:true})).toBeDisabled();assert.deepEqual(await retryCalls(page),[]);
  await page.getByRole('checkbox',{name:ack}).check();await page.getByRole('button',{name:'Försök skicka mejlet igen',exact:true}).dblclick();
  await page.waitForFunction(()=>typeof window.fixture.releaseCustomerEmailRetry==='function');assert.equal((await retryCalls(page)).length,1);
  await page.evaluate(props=>window.fixture.releaseCustomerEmailRetry({ok:true,delivery:{...props,actorUserId:props.userId,actorRole:props.role,recipientEmail:'anna@example.com',status:'accepted',transport:'configured'}}),props);
  await expect(page.getByText('Mejltjänsten har tagit emot inbjudan',{exact:true})).toBeVisible();await expect(page.getByText('Mejlet har accepterats för utskick. Leverans till kundens inkorg är ännu inte bekräftad.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Granska nytt utskicksförsök'})).toHaveCount(0);
  assert.deepEqual((await retryCalls(page))[0].input,{companyId:props.companyId,dealId:props.dealId,referenceId:props.referenceId,kind:props.kind,acknowledged:true});
 }finally{await page.close();}
});
for(const [status,transport,role] of [['pending','configured','finance'],['unknown','configured','owner'],['accepted','configured','owner'],['rejected','configured','owner'],['processing','configured','owner'],['cancelled','configured','owner'],[null,'configured','owner'],['pending','paused','owner'],['pending','unconfigured','owner']])test(`retry absent for ${role} ${status}/${transport}`,async()=>{
 const page=await setup({role},{deliveryResponse:{ok:true,delivery:{status,transport}}});try{await expect(page.getByRole('button',{name:'Uppdatera mejlinbjudans status'})).toBeEnabled();await expect(page.getByRole('button',{name:'Granska nytt utskicksförsök'})).toHaveCount(0);assert.deepEqual(await retryCalls(page),[]);}finally{await page.close();}
});
test('offer retry preserves sales rights while viewer reads and sales cannot read contract delivery',async()=>{
 const sales=await setup({role:'sales',kind:'offer_invitation'});try{await review(sales);await sales.getByRole('checkbox',{name:ack}).check();await sales.getByRole('button',{name:'Försök skicka mejlet igen',exact:true}).click();await expect(sales.getByText('Mejltjänsten har tagit emot inbjudan',{exact:true})).toBeVisible();assert.equal((await retryCalls(sales)).length,1);}finally{await sales.close();}
 const viewer=await setup({role:'viewer',kind:'offer_invitation'});try{await expect(viewer.getByText('Mejlinbjudan väntar på utskick',{exact:true})).toBeVisible();await expect(viewer.getByRole('button',{name:'Granska nytt utskicksförsök'})).toHaveCount(0);}finally{await viewer.close();}
 const blocked=await setup({role:'sales'});try{await expect(blocked.getByRole('region',{name:'Kundens mejlinbjudan'})).toHaveCount(0);assert.deepEqual(await blocked.evaluate(()=>window.fixture.customerEmailCalls??[]),[]);}finally{await blocked.close();}
});
test('unknown transport clears the pending snapshot and requires a fresh read before another review',async()=>{
 const page=await setup({}, {customerEmailRetries:[{throw:true}]});try{await review(page);await page.getByRole('checkbox',{name:ack}).check();await page.getByRole('button',{name:'Försök skicka mejlet igen',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Uppdatera mejlstatus');await expect(page.getByText('anna@example.com',{exact:false})).toHaveCount(0);await expect(page.getByRole('button',{name:'Granska nytt utskicksförsök'})).toHaveCount(0);await page.evaluate(()=>window.fixture.deliveryResponse={ok:true,delivery:{status:'unknown',transport:'configured'}});await page.getByRole('button',{name:'Uppdatera mejlinbjudans status'}).click();await expect(page.getByText('Utskickets utfall behöver kontrolleras',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Granska nytt utskicksförsök'})).toHaveCount(0);assert.equal((await retryCalls(page)).length,1);}finally{await page.close();}
});
test('actor mismatch in a retry response purges recipient and confirmation without a second attempt',async()=>{
 const page=await setup({}, {customerEmailRetries:[{ok:true,delivery:{actorUserId:'other-actor',recipientEmail:'secret@example.test',status:'accepted',transport:'configured'}}]});try{await review(page);await page.getByRole('checkbox',{name:ack}).check();await page.getByRole('button',{name:'Försök skicka mejlet igen',exact:true}).click();await expect(page.getByRole('alert')).toContainText('kunde inte verifieras');await expect(page.getByText('secret@example.test',{exact:false})).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);assert.equal((await retryCalls(page)).length,1);}finally{await page.close();}
});
for(const width of [320,390,1440])test(`retry review fits ${width}px without sending`,async()=>{
 const page=await setup();try{await page.setViewportSize({width,height:1000});await review(page);await expect(page.getByRole('button',{name:'Försök skicka mejlet igen',exact:true})).toBeDisabled();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(process.env.TRAFEXA_CUSTOMER_EMAIL_SCREENSHOTS){await mkdir(process.env.TRAFEXA_CUSTOMER_EMAIL_SCREENSHOTS,{recursive:true});await page.screenshot({path:resolve(process.env.TRAFEXA_CUSTOMER_EMAIL_SCREENSHOTS,`retry-${width}.png`),fullPage:true});}assert.deepEqual(await retryCalls(page),[]);}finally{await page.close();}
});

test('a late retry result from a previous actor cannot replace the current read-only scope',async()=>{
 const page=await setup({}, {customerEmailRetries:[{hold:true}]});try{
  await review(page);await page.getByRole('checkbox',{name:ack}).check();await page.getByRole('button',{name:'Försök skicka mejlet igen',exact:true}).click();await page.waitForFunction(()=>typeof window.fixture.releaseCustomerEmailRetry==='function');
  await page.evaluate(props=>window.mountCustomerEmail({...props,userId:'finance-actor',role:'finance'}),props);await expect(page.getByText('Mejlinbjudan väntar på utskick',{exact:true})).toBeVisible();
  await page.evaluate(props=>window.fixture.releaseCustomerEmailRetry({ok:true,delivery:{...props,actorUserId:props.userId,actorRole:props.role,recipientEmail:'old-secret@example.test',status:'accepted',transport:'configured'}}),props);
  await expect(page.getByText('old-secret@example.test',{exact:false})).toHaveCount(0);await expect(page.getByText('Mejltjänsten har tagit emot inbjudan',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Granska nytt utskicksförsök'})).toHaveCount(0);assert.equal((await retryCalls(page)).length,1);
 }finally{await page.close();}
});
