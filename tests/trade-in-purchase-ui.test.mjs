import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {ACTOR,COMPANY,DEAL,acquisition,id,manual,page as readPage,props,receipt,source,snapshot} from './helpers/trade-in-purchase-ui/fixtures.mjs';
const require=createRequire(import.meta.url),{chromium,expect}=require('@playwright/test'),Chromium=require('@sparticuz/chromium').default,{webpack}=require('next/dist/compiled/webpack/webpack');
const repo=fileURLToPath(new URL('../',import.meta.url)),helpers=resolve(repo,'tests/helpers/trade-in-purchase-ui');
let browser,directory,bundle,styles;const audit={posts:0,errors:[]};
before(async()=>{
 directory=await mkdtemp(resolve(tmpdir(),'trafexa-trade-in-purchase-ui-'));bundle=resolve(directory,'fixture.js');styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');
 const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(helpers,'entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.mjs','.js'],alias:{'@/lib/data/trade-in-acquisition-actions$':resolve(helpers,'actions.js'),'@/lib/data/actions$':resolve(helpers,'actions.js'),'@/lib/data/register-actions$':resolve(helpers,'actions.js'),'@/lib/data/vehicle-cost-actions$':resolve(helpers,'actions.js'),'next/dynamic$':resolve(helpers,'dynamic.js'),'next/link$':resolve(helpers,'unrelated.js'),'next/navigation$':resolve(helpers,'unrelated.js'),'@':resolve(repo,'src')}},module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/contract-ui/swc-loader.cjs')}]},plugins:[new webpack.NormalModuleReplacementPlugin(/^server-only$/,()=>{throw Error('Actual backend code must not enter isolated purchase UI tests.');}),new webpack.NormalModuleReplacementPlugin(/^\.\/(company-team|company-store-profile|vehicle-calculation|purchase-condition|contract-template-workspace|deal-contracts|vehicle-photo-gallery|advertising-workspace|customer-contact-log|deal-cancellation|deal-trade-ins|stock-import|deal-offers|customer-leads|deal-form)$/,resource=>{resource.request=resolve(helpers,'unrelated.js');})]});
 await new Promise((done,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done())));
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(value=>value!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});assert.equal(audit.posts,0);assert.deepEqual(audit.errors,[]);});
async function setup({overrides={},fixture={},width=375,workspace=false}={}){
 const tab=await browser.newPage({viewport:{width,height:1100}});tab.setDefaultTimeout(7000);tab.on('pageerror',error=>audit.errors.push(error.message));tab.on('request',request=>{if(request.method()==='POST')audit.posts++;});await tab.route('**/*',route=>route.abort());await tab.setContent('<main style="padding:12px;min-width:0"><div id="root"></div></main>');await tab.addStyleTag({content:styles});
 await tab.evaluate(({fixture,defaultRead,baseAcquisition})=>{
  let serial=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`20000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`});
  window.fixture={calls:[],responses:{read:[],write:[]},pending:{},defaultRead,baseAcquisition,manual:false,...fixture};
  window.fixture.call=async(kind,input)=>{const f=window.fixture,id=f.calls.length;f.calls.push({id,kind,input:structuredClone(input)});if(f.manual)return new Promise((resolve,reject)=>{f.pending[id]={resolve,reject};});const next=f.responses[kind].shift();if(next?.throw)throw Error('Mocked result unknown');if(next)return next;if(kind==='read')return f.defaultRead;const acquisition={...f.baseAcquisition};for(const key of ['acquiredOn','purchaseAgreementReference','debtConfirmedOre','debtConfirmedOn','debtEvidenceReference','fuel','gearbox','askingPriceOre'])acquisition[key]=input[key];return {ok:true,actorId:f.defaultRead.actorId,role:f.defaultRead.role,companyId:input.companyId,dealId:input.dealId,requestId:input.requestId,acquisition};};
 },{fixture,defaultRead:readPage(),baseAcquisition:acquisition()});
 await tab.addScriptTag({path:bundle});await tab.evaluate(({props,workspace,snapshot})=>workspace?window.mountPurchaseWorkspace(snapshot):window.mountPurchase(props),{props:{...props,...overrides},workspace,snapshot:snapshot(overrides.role??'owner')});return tab;
}
const calls=tab=>tab.evaluate(()=>window.fixture.calls);
const region=tab=>tab.getByRole('region',{name:'Registrera faktiskt inbytesköp',exact:true});
const open=tab=>tab.getByText('Inbytesköp & lagerintag',{exact:true}).click();
const prepare=tab=>tab.getByRole('button',{name:'Granska inbytesköp och lagerintag',exact:true});
const confirm=tab=>tab.getByRole('button',{name:'Bekräfta faktiskt inbytesköp och lagerintag',exact:true});
const confirmAck=tab=>tab.getByRole('checkbox',{name:'Jag har granskat exakt offert, signerat försäljningsavtal, externt inköpsavtal, intyg, skuld och lageruppgifter. Jag vill registrera det faktiska inbytesköpet och lagerintaget.',exact:true});
async function ready(tab){await open(tab);await expect(region(tab).getByText('Fryst säljarnamn',{exact:false})).toBeVisible();}
async function fill(tab,{debt='25000,01',...override}={}){
 await tab.getByLabel('Datum för faktiskt inköp',{exact:true}).fill(override.acquiredOn??manual.acquiredOn);await tab.getByLabel('Verifierad extern inköpsavtalsreferens',{exact:true}).fill(override.purchaseAgreementReference??manual.purchaseAgreementReference);
 await tab.getByLabel('Avstämd skuld (kr), även 0',{exact:true}).fill(debt);await tab.getByLabel('Datum för skuldavstämning',{exact:true}).fill(override.debtConfirmedOn??manual.debtConfirmedOn);await tab.getByLabel('Underlagsreferens för skuldavstämning, även vid 0 kr',{exact:true}).fill(override.debtEvidenceReference??manual.debtEvidenceReference);
 await tab.getByRole('combobox',{name:'Inbytesbilens drivmedel',exact:true}).selectOption('diesel');await tab.getByRole('combobox',{name:'Inbytesbilens växellåda',exact:true}).selectOption('manual');await tab.getByLabel('Utpris inklusive eventuell moms (kr)',{exact:true}).fill('169000,29');
 const checks=tab.locator('form input[type="checkbox"]');for(let index=0;index<3;index++)await checks.nth(index).check();
}
async function review(tab,options){await fill(tab,options);await prepare(tab).click();await expect(tab.getByRole('heading',{name:'Granska faktiskt inbytesköp och lagerintag',exact:true})).toBeFocused();}
async function respond(tab,id,result,reject=false){await tab.evaluate(({id,result,reject})=>{const pending=window.fixture.pending[id];delete window.fixture.pending[id];reject?pending.reject(Error('Mocked acknowledgement lost')):pending.resolve(result);},{id,result,reject});}
const recorded=tab=>expect(tab.getByRole('heading',{name:'Inbytesköpet och lagerintaget är registrerade.',exact:true})).toBeVisible();

test('actual workspace purchase panel is lazy and uses frozen seller and full gross trade-in value without live customer substitution',async()=>{
 const tab=await setup({workspace:true});try{await expect(tab.getByText('Inbytesköp & lagerintag',{exact:true})).toBeVisible();assert.deepEqual(await calls(tab),[]);await ready(tab);assert.deepEqual((await calls(tab)).map(call=>call.kind),['read']);await expect(region(tab)).toContainText('125 000,02 kr');await expect(tab.getByRole('combobox',{name:'Inbytesbilens drivmedel',exact:true})).toHaveValue('');await expect(tab.getByRole('combobox',{name:'Inbytesbilens växellåda',exact:true})).toHaveValue('');await expect(tab.getByLabel('Utpris inklusive eventuell moms (kr)',{exact:true})).toHaveValue('');await expect(region(tab).getByText('Senare ändrat kundnamn',{exact:false})).toHaveCount(0);await expect(region(tab).locator('input[name="purchase_price"]')).toHaveCount(0);}finally{await tab.close();}
});

test('three independent purchase/ownership, received and debt attestations precede a separate unchecked review acknowledgement and exact receipt',async()=>{
 const tab=await setup();try{await ready(tab);await expect(prepare(tab)).toBeDisabled();await fill(tab);await tab.locator('form input[type="checkbox"]').nth(2).uncheck();await expect(prepare(tab)).toBeDisabled();await tab.locator('form input[type="checkbox"]').nth(2).check();await prepare(tab).click();await expect(tab.getByRole('heading',{name:'Granska faktiskt inbytesköp och lagerintag',exact:true})).toBeFocused();await expect(confirmAck(tab)).not.toBeChecked();await expect(confirm(tab)).toBeDisabled();assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,0);await confirmAck(tab).check();assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,0);await confirm(tab).click();await recorded(tab);const write=(await calls(tab)).find(call=>call.kind==='write').input;assert.deepEqual(write,{companyId:COMPANY,dealId:DEAL,expectedSourceSha256:source.sourceSha256,...manual,purchaseConfirmed:true,receivedConfirmed:true,debtConfirmed:true,attestationVersion:'2026-10-15',reviewAcknowledged:true,requestId:'20000000-0000-4000-8000-000000000001'});assert.equal('purchasePriceOre'in write,false);assert.equal('sellerCustomerId'in write,false);await expect(tab.getByRole('link',{name:'Öppna lagret',exact:true})).toHaveAttribute('href','/inventory');await expect(region(tab)).toContainText('Inköpspris vid intag: 125 000,02 kr');await expect(region(tab)).toContainText('Lagerstatus vid intag: Tillgänglig');}finally{await tab.close();}
});

test('debt must exactly match frozen source and known zero still requires its own date and reference',async()=>{
 const tab=await setup();try{await ready(tab);await fill(tab,{debt:'25000,02'});await prepare(tab).click();await expect(tab.getByRole('alert')).toContainText('exakt matcha');await expect(confirm(tab)).toHaveCount(0);assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,0);}finally{await tab.close();}
 const zeroSource=structuredClone(source);Object.assign(zeroSource.offerSnapshot.trade_in,{debt_ore:'0',net_trade_in_ore:'12500002',amount_to_pay_ore:'7400027'});const zero=await setup({fixture:{defaultRead:readPage({source:zeroSource}),baseAcquisition:acquisition({source:zeroSource})}});
 try{await ready(zero);await fill(zero,{debt:'0',debtConfirmedOn:'',debtEvidenceReference:''});await prepare(zero).click();await expect(confirm(zero)).toHaveCount(0);assert.equal(await zero.getByLabel('Datum för skuldavstämning',{exact:true}).evaluate(input=>input.validity.valueMissing),true);await zero.getByLabel('Datum för skuldavstämning',{exact:true}).fill('2026-10-15');await prepare(zero).click();await expect(confirm(zero)).toHaveCount(0);await zero.getByLabel('Underlagsreferens för skuldavstämning, även vid 0 kr',{exact:true}).fill('Skuldfri enligt intyg');await prepare(zero).click();await confirmAck(zero).check();await confirm(zero).click();await recorded(zero);assert.equal((await calls(zero)).find(call=>call.kind==='write').input.debtConfirmedOre,'0');}finally{await zero.close();}
});

test('business date bounds both dates to 1900 through the server Stockholm date before review',async()=>{
 const tab=await setup();try{await ready(tab);await fill(tab,{acquiredOn:'1899-12-31',debtConfirmedOn:'2026-10-16'});await prepare(tab).click();await expect(confirm(tab)).toHaveCount(0);const purchase=tab.getByLabel('Datum för faktiskt inköp',{exact:true}),debt=tab.getByLabel('Datum för skuldavstämning',{exact:true});assert.equal(await purchase.evaluate(input=>input.validity.rangeUnderflow),true);assert.equal(await debt.evaluate(input=>input.validity.rangeOverflow),true);await expect(purchase).toHaveAttribute('max','2026-10-15');await expect(debt).toHaveAttribute('min','1900-01-01');assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,0);}finally{await tab.close();}
});

test('unknown acknowledgement retains reviewed fields consent and exact request across close/reopen retry',async()=>{
 const tab=await setup({fixture:{responses:{read:[],write:[{throw:true}]}}});try{await ready(tab);await review(tab);await confirmAck(tab).check();await confirm(tab).click();await expect(tab.getByRole('alert')).toContainText('kunde inte bekräftas');await expect(confirmAck(tab)).toBeChecked();await open(tab);await open(tab);await expect(confirmAck(tab)).toBeChecked();await expect(region(tab)).toContainText(manual.purchaseAgreementReference);await confirm(tab).click();await recorded(tab);const writes=(await calls(tab)).filter(call=>call.kind==='write');assert.equal(writes.length,2);assert.deepEqual(writes[0].input,writes[1].input);}finally{await tab.close();}
});

test('changing a reviewed reference after unknown result requires new acknowledgement and a new request ID',async()=>{
 const tab=await setup({fixture:{responses:{read:[],write:[{throw:true}]}}});try{await ready(tab);await review(tab);await confirmAck(tab).check();await confirm(tab).click();await expect(tab.getByRole('alert')).toContainText('kunde inte bekräftas');await tab.getByRole('button',{name:'Tillbaka och ändra',exact:true}).click();await tab.getByLabel('Verifierad extern inköpsavtalsreferens',{exact:true}).fill('NYTT-INKOP-15');await prepare(tab).click();await expect(confirmAck(tab)).not.toBeChecked();await confirmAck(tab).check();await confirm(tab).click();await recorded(tab);const writes=(await calls(tab)).filter(call=>call.kind==='write');assert.notEqual(writes[0].input.requestId,writes[1].input.requestId);assert.equal(writes[1].input.purchaseAgreementReference,'NYTT-INKOP-15');}finally{await tab.close();}
});

test('pending purchase blocks duplicate clicks and keeps a verified late receipt over close/reopen',async()=>{
 const tab=await setup();try{await ready(tab);await review(tab);await confirmAck(tab).check();await tab.evaluate(()=>window.fixture.manual=true);await confirm(tab).evaluate(button=>{button.click();button.click();});await tab.waitForFunction(()=>window.fixture.calls.length===2);await expect(confirm(tab)).toBeDisabled();await expect(tab.getByRole('button',{name:'Kontrollera inköpsstatus',exact:true})).toBeDisabled();await open(tab);const request=(await calls(tab))[1].input;await respond(tab,1,receipt(request.requestId));await open(tab);await recorded(tab);assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,1);}finally{await tab.close();}
});

for(const reason of ['no_accepted_trade_in','contract_incomplete','deal_unavailable','vehicle_exists']){
 test(`verified ${reason} eligibility never exposes an acquisition form or creates a purchase`,async()=>{
  const tab=await setup({fixture:{defaultRead:readPage({canAcquire:false,reason,source:reason==='no_accepted_trade_in'?null:source})}});try{await open(tab);await expect(tab.getByText(reason==='vehicle_exists'?'Registreringsnumret finns redan i företagets fordonsregister, även om bilen är historisk. Ett nytt lagerintag kan inte registreras här.':reason==='contract_incomplete'?'Försäljningsavtalet för exakt den accepterade offerten måste vara färdigsignerat av båda parter.':reason==='deal_unavailable'?'Affärens aktuella status tillåter inte ett nytt inbytesköp.':'Affären behöver en accepterad offertversion med ett fryst inbytesunderlag.',{exact:true})).toBeVisible();await expect(prepare(tab)).toHaveCount(0);assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,0);}finally{await tab.close();}
 });
}

test('transient read failure differs from ineligible source and preserves filled input for retry',async()=>{
 const tab=await setup();try{await ready(tab);await fill(tab);await tab.evaluate(()=>window.fixture.responses.read.push({ok:false,code:'unavailable',error:'QA underlag kan inte verifieras just nu.'}));await tab.getByRole('button',{name:'Kontrollera inköpsstatus',exact:true}).click();await expect(tab.getByRole('alert')).toContainText('QA underlag kan inte verifieras');await expect(prepare(tab)).toHaveCount(0);await tab.getByRole('button',{name:'Kontrollera inköpsstatus',exact:true}).click();await expect(tab.getByLabel('Verifierad extern inköpsavtalsreferens',{exact:true})).toHaveValue(manual.purchaseAgreementReference);await expect(tab.getByLabel('Avstämd skuld (kr), även 0',{exact:true})).toHaveValue('25000,01');assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,0);}finally{await tab.close();}
});

test('conflict discards confirmation and requires fresh eligibility before another reviewed attempt',async()=>{
 const tab=await setup({fixture:{responses:{read:[],write:[{ok:false,code:'conflict',error:'QA bilen finns redan.'}]}}});try{await ready(tab);await review(tab);await confirmAck(tab).check();await confirm(tab).click();await expect(tab.getByText('QA bilen finns redan.',{exact:true})).toBeVisible();await expect(confirm(tab)).toHaveCount(0);await expect(prepare(tab)).toHaveCount(0);await tab.evaluate(source=>window.fixture.defaultRead={...window.fixture.defaultRead,canAcquire:false,reason:'vehicle_exists',source},source);await tab.getByRole('button',{name:'Kontrollera inköpsstatus',exact:true}).click();await expect(tab.getByText(/Registreringsnumret finns redan/)).toBeVisible();await expect(prepare(tab)).toHaveCount(0);assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,1);}finally{await tab.close();}
});

for(const role of ['sales','viewer','customer','unknown']){
 test(`${role} receives no new purchase UI, DTO read or mutation`,async()=>{
  const tab=await setup({overrides:{role}});try{await expect(tab.locator('details')).toHaveCount(0);assert.deepEqual(await calls(tab),[]);if(role==='sales'||role==='viewer'){await tab.evaluate(snapshot=>window.mountPurchaseWorkspace(snapshot),snapshot(role));await expect(tab.getByRole('heading',{name:'Affärer',exact:true})).toBeVisible();await expect(tab.getByText('Inbytesköp & lagerintag',{exact:true})).toHaveCount(0);assert.deepEqual(await calls(tab),[]);}}finally{await tab.close();}
 });
}

test('finance sees verified source and historic receipt but no purchase attestations or write controls',async()=>{
 const tab=await setup({overrides:{role:'finance'},fixture:{defaultRead:readPage({role:'finance',canAcquire:false})}});try{await ready(tab);await expect(tab.getByRole('checkbox')).toHaveCount(0);await expect(prepare(tab)).toHaveCount(0);await tab.evaluate(acquisition=>window.fixture.defaultRead={...window.fixture.defaultRead,canAcquire:false,reason:'already_acquired',acquisition},acquisition({actorLabel:'Kollega'}));await tab.getByRole('button',{name:'Kontrollera inköpsstatus',exact:true}).click();await recorded(tab);await expect(region(tab)).toContainText('Lagerstatus vid intag: Tillgänglig');await expect(region(tab)).toContainText('Utpris vid intag inklusive eventuell moms: 169 000,29 kr');await expect(tab.getByRole('link',{name:'Öppna lagret',exact:true})).toHaveAttribute('href','/inventory');assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,0);}finally{await tab.close();}
});

test('demo panel explains read-only mode and performs no new reads or writes',async()=>{
 const tab=await setup({overrides:{demo:true}});try{await open(tab);await expect(region(tab)).toContainText('Inga inköpsuppgifter hämtas');await expect(tab.getByRole('checkbox')).toHaveCount(0);assert.deepEqual(await calls(tab),[]);}finally{await tab.close();}
});

for(const [field,value] of [['companyId',id(90)],['dealId',id(91)],['actorId',id(92)],['role','finance']]){
 test(`mismatched read ${field} never exposes private source or enables an acquisition`,async()=>{
  const tab=await setup({fixture:{defaultRead:readPage({[field]:value})}});try{await open(tab);await expect(tab.getByRole('alert')).toContainText('kunde inte verifieras');await expect(region(tab).getByText('Fryst säljarnamn',{exact:false})).toHaveCount(0);await expect(prepare(tab)).toHaveCount(0);}finally{await tab.close();}
 });
}

for(const variant of ['actor','source','purchasePrice']){
 test(`mismatched ${variant} mutation receipt never claims a registered purchase`,async()=>{
  const tab=await setup();try{await ready(tab);await review(tab);await confirmAck(tab).check();await tab.evaluate(()=>window.fixture.manual=true);await confirm(tab).click();await tab.waitForFunction(()=>window.fixture.calls.length===2);const input=(await calls(tab))[1].input;const result=receipt(input.requestId);if(variant==='actor')result.actorId=id(99);if(variant==='source')result.acquisition.source={...source,sourceSha256:'f'.repeat(64)};if(variant==='purchasePrice')result.acquisition.purchasePriceOre='10000001';await respond(tab,1,result);await expect(tab.getByRole('alert')).toContainText('kunde inte verifieras');await expect(tab.getByRole('heading',{name:'Inbytesköpet och lagerintaget är registrerade.',exact:true})).toHaveCount(0);await expect(tab.getByRole('link',{name:'Öppna lagret',exact:true})).toHaveCount(0);}finally{await tab.close();}
 });
}

for(const [field,value] of [['companyId',id(90)],['userId',id(91)],['role','finance']]){
 test(`${field} switch clears reviewed purchase and ignores late previous-scope receipt`,async()=>{
  const tab=await setup();try{await ready(tab);await review(tab);await confirmAck(tab).check();await tab.evaluate(()=>window.fixture.manual=true);await confirm(tab).click();await tab.waitForFunction(()=>window.fixture.calls.length===2);const input=(await calls(tab))[1].input;await tab.evaluate(props=>window.mountPurchase(props),{...props,[field]:value});await expect(confirm(tab)).toHaveCount(0);await expect(region(tab).getByText('Fryst säljarnamn',{exact:false})).toHaveCount(0);await respond(tab,1,receipt(input.requestId));await expect(tab.getByRole('link',{name:'Öppna lagret',exact:true})).toHaveCount(0);assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,1);}finally{await tab.close();}
 });
}

for(const width of [320,1280]){
 test(`reviewed purchase keyboard focus and long references fit ${width}px`,async()=>{
  const tab=await setup({width});try{await tab.getByText('Inbytesköp & lagerintag',{exact:true}).focus();await tab.keyboard.press('Enter');await expect(prepare(tab)).toBeVisible();await review(tab,{purchaseAgreementReference:'A'.repeat(160),debtEvidenceReference:'B'.repeat(160)});await expect(confirm(tab)).toBeDisabled();const dimensions=await tab.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(dimensions.document<=width&&dimensions.body<=width,JSON.stringify(dimensions));assert.equal((await calls(tab)).filter(call=>call.kind==='write').length,0);}finally{await tab.close();}
 });
}
