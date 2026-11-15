import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {startHarness,expect} from './helpers/register-ui/runtime.mjs';
import {snapshot,stock,registerPage} from './helpers/register-ui/fixtures.mjs';
let harness;before(async()=>{harness=await startHarness();});after(async()=>{assert.deepEqual(harness.audit.posts,[]);assert.deepEqual(harness.audit.errors,[]);await harness.close();});
async function setup(section='inventory'){
 const p=await harness.page(320),data=snapshot({size:1}),item=stock(1);
 await p.evaluate(({data,item,result,section})=>{window.fixture.defaults.register=result;window.fixture.defaults.costs={ok:true,companyId:data.organization.id,actorId:data.user.id,role:'owner',stockItemId:item.id,costs:[]};window.mountWorkspace({snapshot:data,section});},{data,item,section,result:registerPage({rows:[item]})});
 return {p,data,item};
}
test('confirmed import explicitly reloads inventory while pending import blocks navigation',async()=>{
 const {p,item}=await setup();try{
  await expect(p.getByTestId('import-boundary')).toHaveCount(1);
  await expect(p.getByRole('button',{name:`${item.vehicles.make} ${item.vehicles.model}`,exact:true})).toBeVisible();
  await p.evaluate(()=>window.fixture.importBusy(true));
  await expect(p.getByRole('button',{name:'Lägg till bil',exact:true})).toBeDisabled();
  await expect(p.getByRole('button',{name:'Uppdatera',exact:true})).toBeDisabled();
  const before=await p.evaluate(()=>window.fixture.requests.filter(row=>row.kind==='register').length);
  await p.evaluate(()=>{const result=window.fixture.defaults.register;window.fixture.defaults.register={...result,page:{...result.page,rows:[],totalCount:0,filteredCount:0}};window.fixture.importCompleted();window.fixture.importBusy(false);});
  await p.waitForFunction(before=>window.fixture.requests.filter(row=>row.kind==='register').length>before,before);
  await expect(p.getByRole('button',{name:'Uppdatera',exact:true})).toBeEnabled();
  await expect(p.getByRole('button',{name:`${item.vehicles.make} ${item.vehicles.model}`,exact:true})).toHaveCount(0);
  await p.evaluate(()=>window.fixture.importDenied('Importbehörigheten har ändrats.'));
  await expect(p.getByRole('alert')).toContainText('Importbehörigheten har ändrats.');
  await expect(p.getByTestId('import-boundary')).toHaveCount(0);
 }finally{await p.close();}
});
for(const source of ['purchase','calculation'])test(`${source} reconciliation stays reachable while vehicle dialog and sibling actions are protected`,async()=>{
 const {p,item}=await setup();try{
  await p.getByRole('button',{name:`${item.vehicles.make} ${item.vehicles.model}`,exact:true}).click();
  await expect(p.getByTestId('calculation-consumer')).toBeVisible();
  const target=p.getByTestId(source==='purchase'?'purchase-boundary':'calculation-consumer');
  await p.evaluate(source=>window.fixture[source+'Busy'](true),source);
  await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeDisabled();
  assert.equal(await target.evaluate(node=>Boolean(node.closest('[inert]'))),false);
  const sibling=p.getByTestId(source==='purchase'?'calculation-consumer':'purchase-boundary');
  assert.equal(await sibling.evaluate(node=>Boolean(node.closest('[inert]'))),true);
  await p.keyboard.press('Escape');await expect(p.getByRole('dialog')).toBeVisible();
  await p.evaluate(source=>window.fixture[source+'Busy'](false),source);
  await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeEnabled();
 }finally{await p.close();}
});
test('dashboard snapshot cannot remove a vehicle with protected purchase underlay',async()=>{
 const {p,data,item}=await setup('dashboard');try{
  await p.getByRole('button',{name:`${item.vehicles.make} ${item.vehicles.model}`,exact:true}).click();
  await p.evaluate(()=>window.fixture.purchaseBusy(true));
  await p.evaluate(data=>window.mountWorkspace({snapshot:{...data,inventory:[]},section:'dashboard'}),data);
  await expect(p.getByTestId('purchase-boundary')).toBeVisible();
  await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeDisabled();
  await p.evaluate(()=>window.fixture.purchaseBusy(false));
  await expect(p.getByRole('dialog')).toHaveCount(0);
 }finally{await p.close();}
});
