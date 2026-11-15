import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {startHarness,expect} from './helpers/register-ui/runtime.mjs';
import {snapshot} from './helpers/register-ui/fixtures.mjs';
let harness;before(async()=>{harness=await startHarness();});after(async()=>{assert.deepEqual(harness.audit.posts,[]);assert.deepEqual(harness.audit.errors,[]);await harness.close();});
for(const width of [320,1440])test(`protected advertising work blocks enclosing workspace navigation at ${width}px`,async()=>{
 const p=await harness.page(width);try{
  await p.evaluate(data=>window.mountWorkspace({snapshot:data,section:'advertising'}),snapshot({size:1}));
  await expect(p.getByTestId('advertising-boundary')).toBeVisible();
  await p.evaluate(()=>window.fixture.advertisingBusy(true));
  const prevented=await p.locator('a[href="/inventory"]').first().evaluate(node=>!node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
  assert.equal(prevented,true);
  assert.equal(await p.getByTestId('advertising-boundary').evaluate(node=>Boolean(node.closest('[inert]'))),false);
  await p.evaluate(()=>window.fixture.advertisingBusy(false));
  await p.evaluate(()=>window.fixture.advertisingDenied('Annonsbehörigheten har ändrats.'));
  await expect(p.getByRole('alert')).toContainText('Annonsbehörigheten har ändrats.');await expect(p.getByTestId('advertising-boundary')).toHaveCount(0);
 }finally{await p.close();}
});
