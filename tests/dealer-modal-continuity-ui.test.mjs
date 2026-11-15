import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {startHarness,expect} from './helpers/register-ui/runtime.mjs';
import {snapshot,registerPage} from './helpers/register-ui/fixtures.mjs';
let harness;
before(async()=>{harness=await startHarness();});
after(async()=>{assert.deepEqual(harness.audit.posts,[]);assert.deepEqual(harness.audit.errors,[]);await harness.close();});
async function setup(section,width=390){
 const p=await harness.page(width),data=snapshot({size:2});
 await p.evaluate(({data,section,result})=>{window.fixture.defaults.register=result;window.mountWorkspace({snapshot:data,section,demo:false});},{data,section,result:registerPage({kind:'customers',rows:data.customers,total:2})});
 return {p,data};
}
for(const section of ['customers','finance'])test(`${section} modal preserves pending and unknown create until the same request is confirmed`,async()=>{
 const {p}=await setup(section);
 try{
  const customer=section==='customers',kind=customer?'createCustomerRequest':'createFinanceIntakeRequest';
  await p.getByRole('button',{name:customer?'Lägg till kund':'Anmäl finansbehov',exact:true}).click();
  if(customer)await p.getByLabel('Namn / företagsnamn').fill('Testkund för avstämning');
  else await p.getByLabel('Önskat finansbelopp, kr').fill('125000');
  await p.evaluate(kind=>window.fixture.responses[kind]=[{wait:true}],kind);
  await p.getByRole('dialog').getByRole('button',{name:customer?'Lägg till kund':'Skicka intresseanmälan',exact:true}).click();
  await p.waitForFunction(()=>window.fixture.createDeferred?.length===1);
  await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeDisabled();
  await p.keyboard.press('Escape');await expect(p.getByRole('dialog')).toBeVisible();
  const sent=await p.evaluate(()=>window.fixture.writes[0].input);
  await p.evaluate(()=>window.fixture.createDeferred.shift()({ok:false,code:'unavailable',message:'Obekräftat testsvar'}));
  await expect(p.getByRole('button',{name:'Kontrollera samma begäran',exact:true})).toBeVisible();
  await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeDisabled();
  await expect(p.getByLabel(customer?'Namn / företagsnamn':'Önskat finansbelopp, kr')).toBeDisabled();
  await p.keyboard.press('Escape');await expect(p.getByRole('dialog')).toBeVisible();
  if(customer)await p.evaluate(()=>{const result=window.fixture.defaults.register;window.fixture.defaults.register={...result,page:{...result.page,rows:[{...result.page.rows[0],id:'90000000-0000-4000-8000-000000000001',name:'Testkund för avstämning'},...result.page.rows],totalCount:3,filteredCount:3}};});
  await p.getByRole('button',{name:'Kontrollera samma begäran',exact:true}).click();
  await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeEnabled();
  assert.deepEqual(await p.evaluate(()=>window.fixture.writes[1].input),sent);
  if(customer)await expect(p.getByLabel('Namn / företagsnamn')).toHaveValue('');
  else await expect(p.getByLabel('Önskat finansbelopp, kr')).toHaveValue('');
  await p.getByRole('button',{name:'Stäng',exact:true}).click();await expect(p.getByRole('dialog')).toHaveCount(0);
  if(customer)await expect(p.getByRole('button',{name:'Testkund för avstämning',exact:true})).toBeVisible();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await p.close();}
});
test('contact parent guards modal and register then invalidates followups after confirmed change',async()=>{
 const {p,data}=await setup('customers',320);
 try{
  await p.getByRole('button',{name:data.customers[0].name,exact:true}).click();
  await expect(p.getByTestId('followups-boundary')).toHaveAttribute('data-revision','0');
  await p.evaluate(()=>window.fixture.contactBusy(true));
  await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeDisabled();
  await p.keyboard.press('Escape');await expect(p.getByRole('dialog')).toBeVisible();
  await expect(p.getByRole('searchbox')).toBeDisabled();
  await p.evaluate(()=>{window.fixture.contactChanged();window.fixture.contactBusy(false);});
  await expect(p.getByTestId('followups-boundary')).toHaveAttribute('data-revision','1');
  await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeEnabled();
  await p.getByRole('button',{name:'Stäng',exact:true}).click();await expect(p.getByRole('dialog')).toHaveCount(0);
 }finally{await p.close();}
});
