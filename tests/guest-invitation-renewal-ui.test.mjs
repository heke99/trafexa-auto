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
 directory=await mkdtemp(resolve(tmpdir(),'trafexa-renewal-ui-'));styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');
 const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(repo,'tests/helpers/customer-email-ui/entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/data/guest-invitation-renewal-actions':resolve(repo,'tests/helpers/customer-email-ui/actions.js'),'@/lib/data/customer-email-actions':resolve(repo,'tests/helpers/customer-email-ui/actions.js')}},module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/contract-ui/swc-loader.cjs')}]}});
 await new Promise((done,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error??Error(stats.toString({all:false,errors:true}))):done())));
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(arg=>arg!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function setup(overrides={},fixture={}){
 const page=await browser.newPage({viewport:{width:390,height:1000}});await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:`<style>${styles}</style><main style="padding:20px"><div id="root"></div></main>`}):route.abort());await page.goto('https://fixture.trafexa.test/');
 await page.evaluate(fixture=>{window.fixture={deliveryResponse:{ok:true,delivery:{status:'accepted',transport:'configured'}},renewalReview:{ok:true,review:{expiresAt:'2020-01-01T00:00:00Z',canRenew:true}},...fixture};},fixture);await page.addScriptTag({path:resolve(directory,'fixture.js')});await page.evaluate(props=>window.mountCustomerEmail(props),{...props,...overrides});return page;
}
const reviewButton='Granska förnyelse av kundlänk',submitButton='Förnya och skicka länk';
const consent='Jag har granskat mottagaren och dokumentet och vill förnya kundens utgångna länk.';
async function calls(page){return page.evaluate(()=>window.fixture.renewalCalls?.filter(c=>c.kind==='renew')??[]);}
async function start(page){await page.getByRole('button',{name:reviewButton,exact:true}).click();await expect(page.getByRole('heading',{name:'Kontrollera underlaget för ny kundlänk'})).toBeFocused();}
async function send(page){await start(page);await page.getByRole('checkbox',{name:consent}).check();await page.getByRole('button',{name:submitButton,exact:true}).click();}
test('explicit recipient and document review requires consent; narrow screens fit; back restores focus without sending',async()=>{
 const page=await setup();try{
  await start(page);await expect(page.getByText('Dokumentversion: 2',{exact:true})).toBeVisible();await page.getByText('Dokumentreferens',{exact:true}).click();await expect(page.getByText('Dokumentets kontrollsumma: '+ 'a'.repeat(64),{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:submitButton,exact:true})).toBeDisabled();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(width===320||width===1440)await page.screenshot({path:width===320?'/tmp/trafexa-guest-renewal-review-mobile.png':'/tmp/trafexa-guest-renewal-review-desktop.png',fullPage:true});}
  await page.getByRole('button',{name:'Tillbaka',exact:true}).click();await expect(page.getByRole('button',{name:reviewButton,exact:true})).toBeFocused();assert.equal((await calls(page)).length,0);
 }finally{await page.close();}
});
test('successful renewal uses reviewed CAS and distinct UUID, refreshes email status and does not promise delivery',async()=>{
 const page=await setup();try{
  await send(page);await expect(page.getByText('Förnyelsen har registrerats.',{exact:false})).toBeVisible();const recorded=await calls(page);assert.equal(recorded.length,1);assert.match(recorded[0].input.requestId,/^[0-9a-f-]{36}$/);assert.equal(recorded[0].input.expectedEmailId,'email-1');assert.equal(recorded[0].input.expectedGeneration,0);assert.equal(recorded[0].input.expectedDocumentHash,'a'.repeat(64));assert.equal(recorded[0].input.reviewAcknowledged,true);
  assert.equal(await page.evaluate(()=>sessionStorage.length),0);await expect(page.getByText('detta bekräftar inte leverans till kundens inkorg.',{exact:false})).toBeVisible();assert.ok(await page.evaluate(()=>window.fixture.customerEmailCalls.filter(c=>c.kind==='read').length>=2));
 }finally{await page.close();}
});
test('unknown attempt persists across status refresh and remount and retries exact payload without a fresh UUID',async()=>{
 const page=await setup({}, {renewalResults:[{throw:true},{throw:true}]});try{
  await send(page);await expect(page.getByText('Förnyelsens utfall är oklart.',{exact:false})).toBeVisible();const first=(await calls(page))[0].input;
  await expect(page.getByRole('button',{name:reviewButton,exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Uppdatera mejlinbjudans status',exact:true}).click();await page.getByRole('button',{name:'Kontrollera samma förnyelseförsök',exact:true}).click();assert.deepEqual((await calls(page))[1].input,first);
  await page.evaluate(props=>window.mountCustomerEmail({...props,referenceId:'other-ref'}),props);await expect(page.getByRole('button',{name:reviewButton,exact:true})).toBeVisible();await page.evaluate(props=>window.mountCustomerEmail(props),props);
  await page.getByRole('button',{name:'Kontrollera samma förnyelseförsök',exact:true}).click();await expect(page.getByText('Förnyelsen har registrerats.',{exact:false})).toBeVisible();assert.deepEqual((await calls(page))[2].input,first);
 }finally{await page.close();}
});
test('known conflict requires deliberate fresh review before using a new request UUID',async()=>{
 const page=await setup({}, {renewalResults:[{ok:false,code:'conflict',message:'Underlaget har ändrats.'}]});try{
  await send(page);await expect(page.getByRole('button',{name:'Läs in underlag för ny granskning',exact:true})).toBeVisible();const first=(await calls(page))[0].input;
  await page.getByRole('button',{name:'Läs in underlag för ny granskning',exact:true}).click();await start(page);await expect(page.getByRole('checkbox',{name:consent})).not.toBeChecked();await page.getByRole('checkbox',{name:consent}).check();await page.getByRole('button',{name:submitButton,exact:true}).click();await expect(page.getByText('Förnyelsen har registrerats.',{exact:false})).toBeVisible();assert.notEqual((await calls(page))[1].input.requestId,first.requestId);
 }finally{await page.close();}
});
test('renewal writes respect offer and contract roles while permitted readers see expiry',async()=>{
 for(const [kind,role,write,read] of [['offer_invitation','sales',true,true],['offer_invitation','finance',false,true],['offer_invitation','viewer',false,true],['contract_invitation','admin',true,true],['contract_invitation','finance',false,true],['contract_invitation','sales',false,false],['contract_invitation','viewer',false,false]]){
  const page=await setup({kind,role});try{
   await expect(page.getByRole('region',{name:'Kundlänkens giltighet',exact:true})).toHaveCount(read?1:0);
   if(read)await expect(page.getByText('Kundens länk har gått ut.',{exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:reviewButton,exact:true})).toHaveCount(write?1:0);assert.equal((await calls(page)).length,0);
  }finally{await page.close();}
 }
});
test('completed agreement exposes a separate read-only PDF renewal instead of an invitation panel',async()=>{const page=await setup({kind:'contract_completed'});try{await expect(page.getByRole('button',{name:'Uppdatera färdigmejlets status'})).toBeVisible();await expect(page.getByRole('region',{name:'Länk till färdigsignerat avtal',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Kundlänkens giltighet',exact:true})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.fixture.renewalCalls.filter(c=>c.kind==='read').length),1);assert.equal((await calls(page)).length,0);}finally{await page.close();}});
test('expired pending invitations show support recovery and suppress misleading ordinary retry',async()=>{
 const page=await setup({}, {deliveryResponse:{ok:true,delivery:{status:'pending',transport:'configured'}},renewalReview:{ok:true,review:{status:'pending',expiresAt:'2020-01-01T00:00:00Z',canRenew:false}}});try{
  await expect(page.getByText('Det tidigare mejlet väntar fortfarande.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Granska nytt utskicksförsök',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:reviewButton,exact:true})).toHaveCount(0);assert.equal((await calls(page)).length,0);
 }finally{await page.close();}
});
test('failed renewal read alone does not hide an ordinary pending retry',async()=>{
 const page=await setup({}, {deliveryResponse:{ok:true,delivery:{status:'pending',transport:'configured'}},renewalReview:{ok:false,code:'unavailable',message:'Länkstatus kunde inte läsas.'}});try{await expect(page.getByRole('button',{name:'Granska nytt utskicksförsök',exact:true})).toBeVisible();assert.equal((await calls(page)).length,0);}finally{await page.close();}
});
for(const patch of [{companyId:'other-company'},{dealId:'other-deal'},{referenceId:'other-reference'},{kind:'offer_invitation'},{actorUserId:'other-user'},{actorRole:'finance'}])test('foreign review scope fails closed '+JSON.stringify(patch),async()=>{
 const page=await setup({}, {renewalReview:{ok:true,review:{...patch,expiresAt:'2020-01-01T00:00:00Z',canRenew:true,recipientEmail:'secret@example.test'}}});try{await expect(page.getByRole('alert')).toContainText('kunde inte verifieras');await expect(page.getByText('secret@example.test',{exact:false})).toHaveCount(0);await expect(page.getByRole('button',{name:reviewButton,exact:true})).toHaveCount(0);}finally{await page.close();}
});
test('late previous-account renewal response cannot overwrite current read-only view',async()=>{
 const page=await setup({}, {renewalResults:[{hold:true}]});try{
  await send(page);await page.waitForFunction(()=>typeof window.fixture.releaseRenewal==='function');const attempt=(await calls(page))[0].input;
  await page.evaluate(props=>window.mountCustomerEmail({...props,userId:'finance-2',role:'finance'}),props);await expect(page.getByText('Kundens länk har gått ut.',{exact:true})).toBeVisible();await page.waitForFunction(()=>window.fixture.renewalCalls.some(c=>c.kind==='read'&&c.actorUserId==='finance-2'));
  await page.evaluate(({props,attempt})=>window.fixture.releaseRenewal({ok:true,renewal:{...attempt,actorUserId:props.userId,actorRole:props.role,emailId:'email-2',generation:1,recipientEmail:'private@example.test',documentHash:attempt.expectedDocumentHash,documentVersion:2,dispatchStatus:'accepted'}}),{props,attempt});
  await expect(page.getByText('private@example.test',{exact:false})).toHaveCount(0);await expect(page.getByText('Förnyelsen har registrerats.',{exact:false})).toHaveCount(0);assert.equal(await page.evaluate(()=>sessionStorage.length),1);
 }finally{await page.close();}
});
test('renewal in flight locks parent status refresh and ordinary retry until exact result is resolved',async()=>{
 const page=await setup({}, {renewalResults:[{hold:true}]});try{
  await send(page);await page.waitForFunction(()=>typeof window.fixture.releaseRenewal==='function');await expect(page.getByRole('button',{name:'Uppdatera mejlinbjudans status',exact:true})).toBeDisabled();assert.equal((await calls(page)).length,1);
  const request=(await calls(page))[0].input;await page.evaluate(({request,props})=>window.fixture.releaseRenewal({ok:true,renewal:{...request,actorUserId:props.userId,actorRole:props.role,emailId:'email-2',generation:1,documentHash:request.expectedDocumentHash,recipientEmail:'anna@example.com',documentVersion:2,dispatchStatus:'unknown'}}),{request,props});
  await expect(page.getByText('Förnyelsen har registrerats.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Uppdatera mejlinbjudans status',exact:true})).toBeEnabled();assert.equal((await calls(page)).length,1);
 }finally{await page.close();}
});
test('previously verified expired pending invitation stays blocked when a refresh cannot verify current expiry',async()=>{
 const page=await setup({}, {deliveryResponse:{ok:true,delivery:{status:'pending',transport:'configured'}},renewalReview:{ok:true,review:{status:'pending',expiresAt:'2020-01-01T00:00:00Z',canRenew:false}}});try{
  await expect(page.getByText('Kundens länk har gått ut.',{exact:true})).toBeVisible();await page.evaluate(()=>window.fixture.renewalReview={ok:false,code:'unavailable',message:'Tillfälligt läsfel'});await page.getByRole('button',{name:'Uppdatera mejlinbjudans status',exact:true}).click();await expect(page.getByText('Tillfälligt läsfel',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Granska nytt utskicksförsök',exact:true})).toHaveCount(0);
 }finally{await page.close();}
});
test('corrupt retained request remains untouched and visibly blocks another renewal',async()=>{
 const page=await setup();try{
  await expect(page.getByRole('button',{name:reviewButton,exact:true})).toBeVisible();await page.evaluate(()=>{const key='trafexa:guest-invitation-renewal:v1:'+JSON.stringify(['actor-1','company-1','deal-1','contract_invitation','signing-1','owner']);sessionStorage.setItem(key,'malformed');window.mountCustomerEmail({companyId:'company-1',dealId:'deal-1',referenceId:'other',kind:'contract_invitation',userId:'actor-1',role:'owner'});});
  await expect(page.getByRole('button',{name:reviewButton,exact:true})).toBeVisible();await page.evaluate(props=>window.mountCustomerEmail(props),props);await expect(page.getByText('Ett tidigare förnyelseförsök kunde inte läsas säkert.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:reviewButton,exact:true})).toHaveCount(0);assert.equal((await calls(page)).length,0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('trafexa:guest-invitation-renewal:v1:'+JSON.stringify(['actor-1','company-1','deal-1','contract_invitation','signing-1','owner']))),'malformed');
 }finally{await page.close();}
});
test('unverified mutation receipt preserves the exact pending request rather than allowing another renewal',async()=>{
 const page=await setup({}, {renewalResults:[{ok:true,renewal:{actorUserId:'foreign'}}]});try{await send(page);await expect(page.getByText('Förnyelsens utfall kunde inte verifieras.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Kontrollera samma förnyelseförsök',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>sessionStorage.length),1);await expect(page.getByRole('button',{name:reviewButton,exact:true})).toHaveCount(0);}finally{await page.close();}
});
test('initial panel mount reads renewal once after parent initialization and never mutates',async()=>{
 const page=await setup();try{
  await expect(page.getByRole('button',{name:reviewButton,exact:true})).toBeEnabled();
  assert.equal(await page.evaluate(()=>window.fixture.renewalCalls.filter(c=>c.kind==='read').length),1);
  assert.equal((await calls(page)).length,0);
 }finally{await page.close();}
});
const completedReview='Granska ny läslänk till färdigsignerat avtal';
const completedConsent='Jag har granskat mottagaren och det färdigsignerade avtalet och vill förnya kundens läslänk.';
test('completed PDF link review explains read-only access and requires consent at mobile and desktop sizes',async()=>{
 const page=await setup({kind:'contract_completed'});try{
  await page.getByRole('button',{name:completedReview,exact:true}).click();await expect(page.getByRole('heading',{name:'Kontrollera ny läslänk till färdigsignerat avtal'})).toBeFocused();
  await expect(page.getByText('Kunden ska inte signera eller godkänna igen.',{exact:false})).toBeVisible();await expect(page.getByRole('region',{name:'Granska ny läslänk',exact:true}).getByText('Mottagare: anna@example.com',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Förnya och skicka läslänk',exact:true})).toBeDisabled();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/tmp/trafexa-completed-link-renewal-${width}.png`,fullPage:true});}
  await page.getByRole('checkbox',{name:completedConsent}).check();await page.getByRole('button',{name:'Förnya och skicka läslänk',exact:true}).click();await expect(page.getByText('Förnyelsen har registrerats.',{exact:false})).toBeVisible();assert.equal((await calls(page))[0].input.kind,'contract_completed');
 }finally{await page.close();}
});
test('completed PDF renewal is writable by owner/admin and expiry is read-only for finance',async()=>{
 for(const [role,write,read] of [['owner',true,true],['admin',true,true],['finance',false,true],['sales',false,false],['viewer',false,false]]){
  const page=await setup({kind:'contract_completed',role});try{
   await expect(page.getByRole('region',{name:'Länk till färdigsignerat avtal',exact:true})).toHaveCount(read?1:0);if(read)await expect(page.getByText('Kundens läslänk till det färdigsignerade avtalet har gått ut.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:completedReview,exact:true})).toHaveCount(write?1:0);assert.equal((await calls(page)).length,0);
  }finally{await page.close();}
 }
});
for(const kind of ['offer_invitation','contract_invitation','contract_completed'])test('expired known-unsent pending '+kind+' has distinct explicit replacement review',async()=>{
 const page=await setup({kind},{deliveryResponse:{ok:true,delivery:{status:'pending',transport:'configured'}},renewalReview:{ok:true,review:{status:'pending',expiresAt:'2020-01-01T00:00:00Z',canRenew:false,canRecoverPending:true}}});try{
  await page.getByRole('button',{name:'Granska ny länk för väntande mejl',exact:true}).click();await expect(page.getByText('Det tidigare väntande mejlet stoppas.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Försök skicka mejlet igen',exact:true})).toHaveCount(0);assert.equal((await calls(page)).length,0);
  await page.getByRole('checkbox',{name:kind==='contract_completed'?completedConsent:consent}).check();await page.getByRole('button',{name:kind==='contract_completed'?'Förnya och skicka läslänk':submitButton,exact:true}).click();await expect(page.getByText('Förnyelsen har registrerats.',{exact:false})).toBeVisible();assert.equal((await calls(page)).length,1);assert.equal((await calls(page))[0].input.kind,kind);
 }finally{await page.close();}
});
for(const status of ['unknown','processing','rejected','cancelled'])test('neither completion nor pending recovery can create a new link for '+status,async()=>{
 const page=await setup({kind:'contract_completed'},{renewalReview:{ok:true,review:{status,expiresAt:'2020-01-01T00:00:00Z',canRenew:true,canRecoverPending:true}}});try{
  await expect(page.getByText('Kundens läslänk till det färdigsignerade avtalet har gått ut.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:completedReview,exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Granska ny länk för väntande mejl',exact:true})).toHaveCount(0);assert.equal((await calls(page)).length,0);
 }finally{await page.close();}
});
test('unknown completed-link recovery survives full page reload with exactly the same request and no recipient stored',async()=>{
 const page=await setup({kind:'contract_completed'},{renewalResults:[{throw:true}]});try{
  await page.getByRole('button',{name:completedReview,exact:true}).click();await page.getByRole('checkbox',{name:completedConsent}).check();await page.getByRole('button',{name:'Förnya och skicka läslänk',exact:true}).click();await expect(page.getByText('Förnyelsens utfall är oklart.',{exact:false})).toBeVisible();const original=(await calls(page))[0].input;
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.values(sessionStorage)).includes('anna@example.com')),false);
  await page.reload();await page.evaluate(()=>{window.fixture={deliveryResponse:{ok:true,delivery:{status:'unknown',transport:'configured'}},renewalReview:{ok:true,review:{status:'unknown',expiresAt:'2020-01-01T00:00:00Z',canRenew:false,canRecoverPending:false}}};});await page.addScriptTag({path:resolve(directory,'fixture.js')});await page.evaluate(props=>window.mountCustomerEmail({...props,kind:'contract_completed'}),props);
  await page.getByRole('button',{name:'Kontrollera samma förnyelseförsök',exact:true}).click();await expect(page.getByText('Förnyelsen har registrerats.',{exact:false})).toBeVisible();assert.deepEqual((await calls(page))[0].input,original);assert.equal(await page.evaluate(()=>sessionStorage.length),0);
 }finally{await page.close();}
});
test('expired pending recovery conflict requires a fresh review and consent before a new request',async()=>{
 const page=await setup({}, {renewalReview:{ok:true,review:{status:'pending',expiresAt:'2020-01-01T00:00:00Z',canRenew:false,canRecoverPending:true}},renewalResults:[{ok:false,code:'conflict',message:'Underlaget har ändrats.'}]});try{
  await page.getByRole('button',{name:'Granska ny länk för väntande mejl',exact:true}).click();await page.getByRole('checkbox',{name:consent}).check();await page.getByRole('button',{name:submitButton,exact:true}).click();await page.getByRole('button',{name:'Läs in underlag för ny granskning',exact:true}).click();await page.getByRole('button',{name:'Granska ny länk för väntande mejl',exact:true}).click();await expect(page.getByRole('checkbox',{name:consent})).not.toBeChecked();const first=(await calls(page))[0].input.requestId;
  await page.getByRole('checkbox',{name:consent}).check();await page.getByRole('button',{name:submitButton,exact:true}).click();await expect(page.getByText('Förnyelsen har registrerats.',{exact:false})).toBeVisible();assert.notEqual((await calls(page))[1].input.requestId,first);
 }finally{await page.close();}
});
test('long recipient remains readable in completed PDF review without horizontal scrolling',async()=>{
 const recipient='customer.'.repeat(7)+'@'+'dealer.'.repeat(8)+'example.com';const page=await setup({kind:'contract_completed'},{deliveryResponse:{ok:true,delivery:{status:'accepted',transport:'configured',recipientEmail:recipient}},renewalReview:{ok:true,review:{expiresAt:'2020-01-01T00:00:00Z',canRenew:true,recipientEmail:recipient}}});try{
  await page.getByRole('button',{name:completedReview,exact:true}).click();for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}assert.equal((await calls(page)).length,0);
 }finally{await page.close();}
});
