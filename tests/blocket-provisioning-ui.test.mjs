import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium,expect}=require('@playwright/test'),Chromium=require('@sparticuz/chromium').default,{webpack}=require('next/dist/compiled/webpack/webpack');
const repo=fileURLToPath(new URL('../',import.meta.url)),helpers=resolve(repo,'tests/helpers/blocket-provisioning-ui');
const id=n=>`bf170000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),company=id(2),groupId=id(3),connectionId=id(4);
const group={id:groupId,version:1,groupReference:'Verified dealer group',credentialReference:'blocket_group_main',scope:'dealer_group',status:'active',updatedAt:'2026-10-15T12:00:00Z'};
const initialPage={actorUserId:actor,companyId:company,legalName:'Fixture Dealer AB',organisationNumber:'5568554884',groups:[group],nextPageKey:null,connectionVersion:2,binding:null};
let browser,directory,bundle,styles;const audit={requests:[],errors:[]};
before(async()=>{
 directory=await mkdtemp(resolve(tmpdir(),'trafexa-blocket-admin-ui-'));bundle=resolve(directory,'fixture.js');styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');
 const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(helpers,'entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/blocket-provisioning/actions$':resolve(helpers,'actions.js'),'@':resolve(repo,'src')}},module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/contract-ui/swc-loader.cjs')}]},plugins:[new webpack.NormalModuleReplacementPlugin(/^server-only$/,()=>{throw Error('Real backend entered browser harness');})]});
 await new Promise((done,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done())));
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(arg=>arg!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});assert.deepEqual(audit.requests,[]);assert.deepEqual(audit.errors,[]);});
async function setup({page=initialPage,width=375,responses={}}={}){
 const tab=await browser.newPage({viewport:{width,height:1000}});tab.setDefaultTimeout(7000);tab.on('pageerror',error=>audit.errors.push(error.message));tab.on('request',request=>audit.requests.push(request.url()));await tab.route('**/*',route=>route.abort());
 await tab.setContent('<main style="padding:12px;min-width:0"><div id="root"></div></main>');await tab.addStyleTag({content:styles});
 await tab.evaluate(({page,responses,connectionId})=>{
  let serial=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`bf180000-0000-4000-8000-${String(++serial).padStart(12,'0')}`});
  window.fixture={page,connectionId,responses,calls:[],receipts:{},manual:false,pending:{},denied:[],call:async function(kind,input){
   const id=this.calls.length;this.calls.push({id,kind,input:structuredClone(input)});
   if(this.manual)return new Promise((resolve,reject)=>this.pending[id]={resolve,reject});
   const next=this.responses[kind]?.shift();if(next?.throw)throw Error('Lost response');if(next&&!next.throwAfterCommit)return next;
   if(kind==='read')return{ok:true,...structuredClone(this.page)};
   const key=kind+':'+input.requestId;
   if(!this.receipts[key]){
    if(kind==='group'){const group={id:input.groupId,version:input.expectedVersion+1,groupReference:input.groupReference,credentialReference:input.credentialReference,scope:input.scope,status:input.status,updatedAt:'2026-10-15T12:00:00Z'};this.page.groups=this.page.groups.filter(old=>old.id!==group.id).concat(group).sort((a,b)=>a.id.localeCompare(b.id));this.receipts[key]={ok:true,actorUserId:this.page.actorUserId,requestId:input.requestId,group};}
    else{const binding=kind==='bind'?{companyId:input.companyId,connectionId:this.connectionId,connectionVersion:input.expectedConnectionVersion+1,groupId:input.groupId,groupVersion:input.expectedGroupVersion,dealerCode:input.dealerCode,evidenceReference:input.evidenceReference,validUntil:input.validUntil,status:'verified'}:{...this.page.binding,connectionVersion:input.expectedConnectionVersion+1,status:'disabled'};this.page.binding=binding;this.page.connectionVersion=binding.connectionVersion;this.receipts[key]={ok:true,actorUserId:this.page.actorUserId,requestId:input.requestId,companyId:input.companyId,binding};}
   }
   if(next?.throwAfterCommit)throw Error('Lost persisted response');return structuredClone(this.receipts[key]);
  }};
 },{page,responses,connectionId});await tab.addScriptTag({path:bundle});await tab.evaluate(({companyId,userId})=>window.mountBlocketFixture({companyId,userId,onAccessDenied:message=>window.fixture.denied.push(message)}),{companyId:company,userId:actor});return tab;
}
const calls=tab=>tab.evaluate(()=>window.fixture.calls),writes=async tab=>(await calls(tab)).filter(call=>call.kind!=='read');
const ack=tab=>tab.getByRole('checkbox',{name:'Jag har granskat omfattningen och det manuella underlaget. Ändringen ska registreras.',exact:true});
async function open(tab){await tab.locator('summary').click();await expect(tab.getByRole('heading',{name:'Fixture Dealer AB · 5568554884'})).toBeVisible();}
async function fillGroup(tab){await tab.getByLabel('Gruppreferens',{exact:true}).fill('New group');await tab.getByLabel('Serverns nyckelreferens (etikett)',{exact:true}).fill('blocket_secondary');await tab.getByLabel('Motivering för gruppändring',{exact:true}).fill('Reviewed scope with partner');}
async function fillBind(tab){await tab.getByLabel('Aktiv Blocketgrupp',{exact:true}).selectOption(groupId);await tab.getByLabel('Blockets återförsäljarkod',{exact:true}).fill('dealer-a');await tab.getByLabel('Referens till granskat behörighetsunderlag',{exact:true}).fill('Partner case 123');await tab.getByLabel('Giltig till (din lokala tid, högst 90 dagar)',{exact:true}).fill(new Date(Date.now()+7*86400000).toISOString().slice(0,16));await tab.getByLabel('Motivering för företagskoppling',{exact:true}).fill('Authority manually checked');}

test('panel is lazy, explicit group review plus acknowledgement precedes any write and unknown persisted result retries the same UUID',async()=>{
 const tab=await setup({responses:{group:[{throwAfterCommit:true}]}});try{
  assert.deepEqual(await calls(tab),[]);await open(tab);await fillGroup(tab);await tab.getByRole('button',{name:'Granska gruppändring',exact:true}).click();await expect(tab.getByRole('heading',{name:'Granska gruppändring',exact:true})).toBeFocused();const confirm=tab.getByRole('button',{name:'Bekräfta gruppändring',exact:true});await expect(confirm).toBeDisabled();assert.deepEqual(await writes(tab),[]);await ack(tab).check();await confirm.click();await expect(tab.getByRole('alert')).toContainText('samma uppgifter');await expect(ack(tab)).toBeChecked();await tab.locator('summary').click();await tab.locator('summary').click();await expect(ack(tab)).toBeChecked();await confirm.evaluate(button=>{button.click();button.click();});await expect(tab.getByRole('status')).toContainText('registrerad');const saved=await writes(tab);assert.equal(saved.length,2);assert.deepEqual(saved[0].input,saved[1].input);assert.equal(saved[0].input.expectedVersion,0);assert.equal(saved[0].input.credentialReference,'blocket_secondary');
 }finally{await tab.close();}
});

test('company binding takes actual existing requested-connection version, reviewed group version and future evidence, then reloads current state',async()=>{
 const tab=await setup();try{
  await open(tab);await fillBind(tab);await tab.getByRole('button',{name:'Granska företagskoppling',exact:true}).click();const button=tab.getByRole('button',{name:'Bekräfta företagskoppling',exact:true});await expect(button).toBeDisabled();assert.deepEqual(await writes(tab),[]);await ack(tab).check();await button.click();await expect(tab.getByText('Manuellt verifierat underlag',{exact:false})).toBeVisible();const saved=(await writes(tab))[0].input;assert.equal(saved.companyId,company);assert.equal(saved.expectedConnectionVersion,2);assert.equal(saved.expectedGroupVersion,1);assert.equal(saved.dealerCode,'dealer-a');assert.equal(saved.acknowledged,true);assert.ok((await calls(tab)).filter(call=>call.kind==='read').length>=2);
 }finally{await tab.close();}
});

test('conflict blocks confirmation until a fresh reload; a malformed or foreign read never exposes its data',async()=>{
 const tab=await setup({responses:{bind:[{ok:false,code:'conflict',error:'Kopplingen har ändrats. Läs in aktuella uppgifter.'}]}});try{await open(tab);await fillBind(tab);await tab.getByRole('button',{name:'Granska företagskoppling',exact:true}).click();await ack(tab).check();await tab.getByRole('button',{name:'Bekräfta företagskoppling',exact:true}).click();await expect(tab.getByRole('alert')).toContainText('ändrats');await expect(tab.getByRole('button',{name:'Bekräfta företagskoppling',exact:true})).toBeDisabled();await tab.getByRole('button',{name:'Läs in aktuellt Blocketunderlag',exact:true}).click();await expect(ack(tab)).toHaveCount(0);}finally{await tab.close();}
 const foreign=await setup({responses:{read:[{ok:true,...initialPage,companyId:id(99),legalName:'FOREIGN SECRET'}]}});try{await foreign.locator('summary').click();await expect(foreign.getByRole('alert')).toContainText('kunde inte verifieras');await expect(foreign.getByText('FOREIGN SECRET',{exact:false})).toHaveCount(0);assert.deepEqual(await writes(foreign),[]);}finally{await foreign.close();}
});

test('access revocation purges private data and a scope switch ignores late mutation replies',async()=>{
 const tab=await setup({responses:{group:[{ok:false,code:'access_denied',error:'Administratörsåtkomst återkallad.'}]}});try{await open(tab);await fillGroup(tab);await tab.getByRole('button',{name:'Granska gruppändring',exact:true}).click();await ack(tab).check();await tab.getByRole('button',{name:'Bekräfta gruppändring',exact:true}).click();await expect(tab.getByRole('alert')).toContainText('återkallad');await expect(tab.getByText('Verified dealer group',{exact:true})).toHaveCount(0);await expect(ack(tab)).toHaveCount(0);assert.equal(await tab.evaluate(()=>window.fixture.denied.length),1);}finally{await tab.close();}
 const late=await setup();try{await open(late);await fillBind(late);await late.getByRole('button',{name:'Granska företagskoppling',exact:true}).click();await ack(late).check();await late.evaluate(()=>window.fixture.manual=true);await late.getByRole('button',{name:'Bekräfta företagskoppling',exact:true}).click();await late.waitForFunction(()=>window.fixture.calls.length===2);await late.evaluate(userId=>window.mountBlocketFixture({companyId:window.fixture.page.companyId,userId}),id(99));await expect(late.locator('details')).not.toHaveAttribute('open','');await late.evaluate(()=>{const call=window.fixture.calls[1];window.fixture.pending[1].resolve({ok:true,actorUserId:window.fixture.page.actorUserId,companyId:call.input.companyId,requestId:call.input.requestId,binding:{companyId:call.input.companyId,connectionId:window.fixture.connectionId,connectionVersion:3,groupId:call.input.groupId,groupVersion:1,dealerCode:call.input.dealerCode,evidenceReference:call.input.evidenceReference,validUntil:call.input.validUntil,status:'verified'}});});await expect(late.getByText('Ändringen är registrerad.',{exact:false})).toHaveCount(0);assert.equal((await writes(late)).length,1);}finally{await late.close();}
});

test('disable requires a reviewed reason and preserves exact connection CAS',async()=>{
 const binding={companyId:company,connectionId,connectionVersion:3,groupId,groupVersion:1,dealerCode:'dealer-a',evidenceReference:'Partner case',validUntil:new Date(Date.now()+86400000).toISOString(),status:'verified'};
 const tab=await setup({page:{...initialPage,connectionVersion:3,binding}});try{await open(tab);await tab.getByLabel('Motivering för spärr',{exact:true}).fill('Dealer authority withdrawn');await tab.getByRole('button',{name:'Granska spärr',exact:true}).click();await ack(tab).check();await tab.getByRole('button',{name:'Bekräfta spärr',exact:true}).click();await expect(tab.getByText('Spärrad eller inte längre giltig koppling',{exact:false})).toBeVisible();const saved=(await writes(tab))[0];assert.equal(saved.kind,'disable');assert.equal(saved.input.expectedConnectionVersion,3);assert.equal(saved.input.companyId,company);}finally{await tab.close();}
});

test('a dealer request after a prior disabled binding reads current connection version and binds without overwriting its historical CAS',async()=>{
 const binding={companyId:company,connectionId,connectionVersion:3,groupId,groupVersion:1,dealerCode:'dealer-old',evidenceReference:'Earlier manual evidence',validUntil:new Date(Date.now()+86400000).toISOString(),status:'disabled'};
 const tab=await setup({page:{...initialPage,connectionVersion:4,binding}});try{
  await open(tab);await expect(tab.getByText('Spärrad eller inte längre giltig koppling',{exact:false})).toBeVisible();await fillBind(tab);await tab.getByRole('button',{name:'Granska företagskoppling',exact:true}).click();await ack(tab).check();await tab.getByRole('button',{name:'Bekräfta företagskoppling',exact:true}).click();await expect(tab.getByText('Manuellt verifierat underlag',{exact:false})).toBeVisible();const saved=(await writes(tab))[0].input;assert.equal(saved.expectedConnectionVersion,4);assert.equal(saved.expectedGroupVersion,1);assert.equal(saved.dealerCode,'dealer-a');
 }finally{await tab.close();}
});

for(const width of [320,1280])test(`keyboard review fits ${width}px and token-shaped key input never becomes a write`,async()=>{
 const tab=await setup({width});try{await open(tab);await fillGroup(tab);await tab.getByLabel('Serverns nyckelreferens (etikett)',{exact:true}).fill('eyJ.header.signature');await tab.getByRole('button',{name:'Granska gruppändring',exact:true}).click();assert.deepEqual(await writes(tab),[]);await expect(ack(tab)).toHaveCount(0);await tab.getByLabel('Serverns nyckelreferens (etikett)',{exact:true}).fill('safe_label');await tab.getByRole('button',{name:'Granska gruppändring',exact:true}).focus();await tab.keyboard.press('Enter');await expect(tab.getByRole('heading',{name:'Granska gruppändring',exact:true})).toBeFocused();const dimensions=await tab.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));assert.ok(dimensions.body<=width&&dimensions.document<=width,JSON.stringify(dimensions));assert.deepEqual(await writes(tab),[]);}finally{await tab.close();}
});
