import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createSourceLoader} from './helpers/source-loader.mjs';
import {fixture,call,A,C,id} from './advertising-priced-send-db/fixtures.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{chromium,expect}=require('@playwright/test'),Chromium=require('@sparticuz/chromium').default,{webpack}=require('next/dist/compiled/webpack/webpack');
const helpers=resolve(repo,'tests/helpers/advertising-program-ui'),store=id(80),company={companyId:C,name:'Synthetic Dealer AB',organisationNumber:'5568554884',stores:[{id:store,company_id:C,dealer_code:'fixture',store_name:'Synthetic Shop',periods:[]}]};
const prefix=`trafexa-program-request:v1:${A}:${C}:`;
let browser,directory,bundle,styles;const errors=[];
before(async()=>{
 directory=await mkdtemp(resolve(tmpdir(),'trafexa-program-ui-'));bundle=resolve(directory,'fixture.js');styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');
 const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(helpers,'entry.js'),output:{path:directory,filename:'fixture.js',publicPath:''},resolve:{extensions:['.tsx','.ts','.mjs','.js'],alias:{'@/lib/platform-admin/advertising-program-actions$':resolve(helpers,'actions.js'),'next/navigation$':resolve(helpers,'entry.js'),'@':resolve(repo,'src')}},module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/contract-ui/swc-loader.cjs')}]},plugins:[new webpack.optimize.LimitChunkCountPlugin({maxChunks:1}),new webpack.NormalModuleReplacementPlugin(/^server-only$/,()=>{throw Error('Server-only code in program UI bundle');})]});
 await new Promise((done,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error??Error(stats.toString({all:false,errors:true}))):done())));
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(arg=>arg!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});assert.deepEqual(errors,[]);});
async function mount(page,data=company,overrides={}){
 await page.evaluate(overrides=>{window.programFixture={calls:[],responses:{save:[],resolve:[]},pending:[],refreshes:0,...overrides};},overrides);
 await page.addScriptTag({path:bundle});await page.evaluate(company=>window.mountProgram({company,actorId:'af190000-0000-4000-8000-000000000001'}),data);
 await expect(page.getByRole('heading',{name:`Annonsprogram · ${data.name}`,exact:true})).toBeVisible();
}
async function setup({width=320,overrides={},data=company,init}={}){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(7000);
 page.on('pageerror',error=>errors.push(String(error)));
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:`<html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${styles}</style><div class="wrap" id="root"></div></html>`}):route.abort());
 if(init)await page.addInitScript(init);
 await page.goto('http://localhost/trafexa-program-fixture');await mount(page,data,overrides);
 return page;
}
const newPeriod=page=>page.locator('details').filter({has:page.getByText('Ny avtalsperiod',{exact:true})});
async function fill(page,price='620,00'){
 const form=newPeriod(page);await form.locator('summary').click();
 await form.getByLabel('Avtalsreferens',{exact:true}).fill('Retained agreement reference');
 await form.getByLabel('Önskad start',{exact:true}).fill('2026-12-01');
 await form.getByLabel('Kundpris Blocket per annons (kr exkl. moms)',{exact:true}).fill(price);
 await form.getByLabel('Kundens butiksavgift per månad (kr exkl. moms)',{exact:true}).fill('2900,00');
 return form;
}
const calls=page=>page.evaluate(()=>window.programFixture.calls);

test('invalid money retains all entered values, identifies and focuses the field, then permits correction',async()=>{
 const page=await setup();try{
  const form=await fill(page,'620 kr');await form.getByRole('button',{name:'Spara avtalsperiod',exact:true}).click();
  await expect(form.getByRole('alert')).toContainText('Kontrollera');
  const price=form.getByLabel('Kundpris Blocket per annons (kr exkl. moms)',{exact:true});await expect(price).toHaveValue('620 kr');await expect(price).toBeFocused();
  await expect(form.getByLabel('Avtalsreferens',{exact:true})).toHaveValue('Retained agreement reference');await expect(form.getByLabel('Önskad start',{exact:true})).toHaveValue('2026-12-01');await expect(form.getByLabel('Kundens butiksavgift per månad (kr exkl. moms)',{exact:true})).toHaveValue('2900,00');assert.deepEqual(await calls(page),[]);
  await price.fill('620,00');await form.getByRole('button',{name:'Spara avtalsperiod',exact:true}).click();await expect(form.getByRole('status')).toContainText('Sparningen är verifierad');assert.equal((await calls(page)).length,1);
 }finally{await page.context().close();}
});

test('a pending write blocks duplicate writes, other forms and parent navigation until its outcome is known',async()=>{
 const page=await setup({overrides:{responses:{save:[{hold:true}],resolve:[]}}});try{
  const form=await fill(page);await form.getByRole('button',{name:'Spara avtalsperiod',exact:true}).click();await page.waitForFunction(()=>window.programFixture.pending.length===1);
  await expect(page.getByRole('link',{name:'Tillbaka till superadmin'})).not.toHaveAttribute('href','/admin');
  await page.getByText('Registrera befintlig Blocketbutik',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Registrera butik',exact:true})).toBeDisabled();await expect(form.getByRole('button',{name:'Verifierar sparning…',exact:true})).toBeDisabled();
  await form.getByRole('button',{name:'Verifierar sparning…',exact:true}).evaluate(button=>{button.click();button.click();});assert.equal((await calls(page)).length,1);
  await page.evaluate(()=>window.programFixture.pending[0]({ok:false,code:'unavailable',message:'Synthetic unknown write'}));
  await expect(form.getByRole('button',{name:'Kontrollera tidigare sparning'})).toBeEnabled();await expect(page.getByRole('link',{name:'Tillbaka till superadmin'})).toHaveAttribute('href','/admin');
  const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage)[0])));assert.deepEqual(Object.keys(stored).sort(),['expectedVersion','operation','periodId','requestId','storeId']);
 }finally{await page.context().close();}
});

test('expired sessions retain the draft and offer a separate login; explicit not-saved recovery permits a new request',async()=>{
 const page=await setup({overrides:{responses:{save:[{ok:false,code:'unauthenticated',message:'Logga in i en ny flik.'}],resolve:[{ok:true,state:'not_saved'}]}}});try{
  const form=await fill(page);await form.getByRole('button',{name:'Spara avtalsperiod',exact:true}).click();
  const login=form.getByRole('link',{name:'Logga in i en ny flik och behåll formuläret här'});await expect(login).toHaveAttribute('target','_blank');assert.equal(new URL(await login.getAttribute('href'),'http://localhost').searchParams.get('next'),`/admin/annonsprogram/${C}`);
  await expect(form.getByLabel('Avtalsreferens',{exact:true})).toHaveValue('Retained agreement reference');await expect(form.getByLabel('Avtalsreferens',{exact:true})).toBeDisabled();
  await form.getByRole('button',{name:'Kontrollera tidigare sparning'}).click();await expect(form.getByRole('alert')).toContainText('säkert avslutad');await expect(form.getByLabel('Avtalsreferens',{exact:true})).toBeEnabled();
  await form.getByRole('button',{name:'Spara avtalsperiod',exact:true}).click();await expect(form.getByRole('status')).toContainText('Sparningen är verifierad');const writes=(await calls(page)).filter(c=>c.kind==='save');assert.equal(writes.length,2);assert.notEqual(writes[0].input.requestId,writes[1].input.requestId);
 }finally{await page.context().close();}
});

test('revoked access clears every program form and request metadata instead of retaining private costs',async()=>{
 const page=await setup({overrides:{responses:{save:[{ok:false,code:'access_denied',message:'Access revoked'}],resolve:[]}}});try{
  const form=await fill(page);await form.getByLabel('Trafexas inköpspris Blocket per annons (kr exkl. moms)',{exact:true}).fill('500,00');await form.getByRole('button',{name:'Spara avtalsperiod',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Annonsprogrammet är inte längre tillgängligt.'})).toBeVisible();await expect(page.getByText(company.name,{exact:false})).toHaveCount(0);await expect(page.getByLabel('Avtalsreferens',{exact:true})).toHaveCount(0);assert.equal(await page.evaluate(prefix=>Object.keys(sessionStorage).some(key=>key.startsWith(prefix)),prefix),false);
 }finally{await page.context().close();}
});

test('blocked session storage prevents a write before any transport call',async()=>{
 const page=await setup({init:()=>{Storage.prototype.setItem=function(){throw Error('Synthetic unavailable storage');};}});try{
  const form=await fill(page);await form.getByRole('button',{name:'Spara avtalsperiod',exact:true}).click();await expect(form.getByRole('alert')).toContainText('Ingen ändring skickades');assert.deepEqual(await calls(page),[]);
 }finally{await page.context().close();}
});

for(const width of[320,1440])test(`program validation and error recovery fit ${width}px without external requests`,async()=>{
 const page=await setup({width});try{
  const form=await fill(page,'620 kr');await form.getByRole('button',{name:'Spara avtalsperiod',exact:true}).click();await expect(form.getByRole('alert')).toBeVisible();const size=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(size.document<=width&&size.body<=width,JSON.stringify(size));await page.screenshot({path:`/tmp/trafexa-program-validation-${width}.png`,fullPage:true});
 }finally{await page.context().close();}
});

test('real browser form, actual action and migrated SQL recover one committed period after reload',async()=>{
 const db=await fixture();let page;const state={lose:true};
 try{
  const sdk={auth:{async getUser(){return{data:{user:(await db.query('select id,email,email_confirmed_at::text,is_anonymous from auth.users where id=$1',[A])).rows[0]},error:null};}},rpc(name,args){const entries=Object.entries(args);const p=call(db,`select public.${name}(${entries.map(([k],i)=>`${k}=>$${i+1}`).join(',')}) r`,entries.map(([,v])=>v),A).then(data=>({data,error:null}),error=>({data:null,error:{code:error.code}}));p.abortSignal=()=>p;return p;}};
  const loader=await createSourceLoader({'@/lib/supabase/server':{async createServerSupabaseClient(){return sdk;}},'next/cache':{revalidatePath(){}}});const actions=loader.load('@/lib/platform-admin/advertising-program-actions');
  await call(db,'select public.save_advertising_program($1,$2,$3) r',[C,null,{store_name:'Synthetic Shop',dealer_code:'fixture'}],A);
  const current=()=>call(db,'select public.list_advertising_program($1) r',[C],A);
  page=await setup({data:await current(),overrides:{actual:true}});
  await page.exposeFunction('actualProgramSave',async input=>{const saved=await actions.saveAdvertisingProgramRequestAction(input);if(saved.ok&&state.lose){state.lose=false;throw Error('Synthetic lost browser response after commit');}return saved;});
  await page.exposeFunction('actualProgramResolve',input=>actions.resolveAdvertisingProgramRequestAction(input));
  const form=await fill(page);await form.getByRole('button',{name:'Spara avtalsperiod',exact:true}).click();await expect(form.getByRole('button',{name:'Kontrollera tidigare sparning'})).toBeVisible();assert.equal((await db.query('select count(*)::int n from private.advertising_program_revisions')).rows[0].n,1);
  const original=(await calls(page))[0].input;await page.reload();await mount(page,await current(),{actual:true});const restored=newPeriod(page);await restored.locator('summary').click();await expect(restored.getByRole('alert')).toContainText('tidigare sparning');
  await restored.getByRole('button',{name:'Kontrollera tidigare sparning'}).click();await expect(restored.getByRole('status')).toContainText('Sparningen är verifierad');const recover=(await calls(page))[0];assert.equal(recover.kind,'resolve');assert.equal(recover.input.identity.requestId,original.requestId);
  assert.equal((await db.query('select count(*)::int n from private.advertising_program_revisions')).rows[0].n,1);assert.equal(await page.evaluate(prefix=>Object.keys(sessionStorage).filter(key=>key.startsWith(prefix)).length,prefix),0);
 }finally{await page?.context().close();await db.close();}
});
