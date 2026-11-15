import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {startHarness,expect} from './helpers/register-ui/runtime.mjs';
import {snapshot,stock,registerPage} from './helpers/register-ui/fixtures.mjs';
let harness;before(async()=>{harness=await startHarness();});after(async()=>{assert.deepEqual(harness.audit.posts,[]);assert.deepEqual(harness.audit.errors,[]);await harness.close();});
async function setup(section){const p=await harness.page(320),data=snapshot({size:1}),item=stock(1);await p.evaluate(({data,section,result})=>{window.fixture.defaults.register=result;window.mountWorkspace({snapshot:data,section});},{data,section,result:registerPage({rows:[item]})});return{p,item};}
test('protected photo operation keeps its own controls reachable and locks vehicle siblings and dialog',async()=>{
 const {p,item}=await setup('inventory');try{
  await p.getByRole('button',{name:`${item.vehicles.make} ${item.vehicles.model}`,exact:true}).click();
  await expect(p.getByTestId('photo-boundary')).toBeVisible();
  await p.evaluate(()=>window.fixture.photoBusy(true));
  await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeDisabled();
  assert.equal(await p.getByTestId('photo-boundary').evaluate(node=>Boolean(node.closest('[inert]'))),false);
  assert.equal(await p.getByTestId('purchase-boundary').evaluate(node=>Boolean(node.closest('[inert]'))),true);
  assert.equal(await p.getByTestId('paper-sale-boundary').evaluate(node=>Boolean(node.closest('[inert]'))),true);
  await p.keyboard.press('Escape');await expect(p.getByRole('dialog')).toBeVisible();
  await p.evaluate(()=>window.fixture.photoBusy(false));await expect(p.getByRole('button',{name:'Stäng',exact:true})).toBeEnabled();
  await p.evaluate(()=>window.fixture.photoDenied('Bildbehörigheten har ändrats.'));
  await expect(p.getByRole('alert')).toContainText('Bildbehörigheten har ändrats.');await expect(p.getByRole('dialog')).toHaveCount(0);
 }finally{await p.close();}
});
for(const kind of ['store','public-store','branches','team'])test(`${kind} mutation protects enclosing settings while its exact retry remains reachable`,async()=>{
 const {p}=await setup('settings');try{
  const target=p.getByTestId(kind+'-boundary');await expect(target).toBeVisible();
  await p.evaluate(kind=>window.fixture[kind+'Busy'](true),kind);
  assert.equal(await target.evaluate(node=>Boolean(node.closest('[inert]'))),false);
  for(const other of ['store','public-store','branches','team'].filter(value=>value!==kind))assert.equal(await p.getByTestId(other+'-boundary').evaluate(node=>Boolean(node.closest('[inert]'))),true);
  assert.equal(await p.locator('#settings-account').evaluate(node=>node.inert),true);
  assert.equal(await p.locator('#settings-team').evaluate(node=>node.inert),kind!=='team');
  const link=p.locator('a[href="/inventory"]').first(),url=p.url();await link.evaluate(node=>node.click());assert.equal(p.url(),url);
  await p.evaluate(kind=>window.fixture[kind+'Busy'](false),kind);
  assert.equal(await p.locator('#settings-account').evaluate(node=>node.inert),false);
  await p.evaluate(kind=>window.fixture[kind+'Denied']('Inställningarnas behörighet har ändrats.'),kind);
  await expect(p.getByRole('alert')).toContainText('Inställningarnas behörighet har ändrats.');await expect(target).toHaveCount(0);
 }finally{await p.close();}
});

test('confirmed store profile change invalidates public manager without remounting it',async()=>{
 const {p}=await setup('settings');try{
  const panel=p.getByTestId('public-store-boundary');await expect(panel).toHaveAttribute('data-revision','0');
  await panel.evaluate(node=>node.dataset.unsavedIdentity='keep-public-review');
  await p.evaluate(()=>window.fixture.storeChanged());
  await expect(panel).toHaveAttribute('data-revision','1');await expect(panel).toHaveAttribute('data-unsaved-identity','keep-public-review');
  assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
 }finally{await p.close();}
});
