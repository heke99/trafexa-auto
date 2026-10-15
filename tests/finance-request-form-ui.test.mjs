import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {startHarness,expect} from './helpers/finance-request-ui/runtime.mjs';
import {snapshot,deal,registerPage,COMPANY,OTHER_COMPANY} from './helpers/register-ui/fixtures.mjs';
let h;before(async()=>{h=await startHarness();});after(async()=>{await h?.close();});
async function setup({width=1280,demo=false}={}){const p=await h.page(width),s=snapshot({size:1});await p.evaluate(({s,demo})=>{window.fixture.defaults.register=null;window.mountFinance({snapshot:s,companyId:s.organization.id,demo});},{s,demo});return {p,s};}
async function answer(p,result){await p.evaluate(result=>{window.fixture.responses.register=[result];},result);}
async function open(p,result){await answer(p,result);await p.getByRole('button',{name:'Välj affär',exact:true}).click();await expect(p.locator('section[aria-label="Affärsregister"]')).toHaveAttribute('aria-busy','false');}
const pageFor=(rows,extra={})=>registerPage({kind:'deals',rows,total:1207,...extra});
test('remote choice beyond 500 uses search and paging, distinguishes identical customer/prices by car and submits all original fields',async()=>{
 const {p}=await setup();try{
 const first=deal(501),second=deal(1001);second.customer={...first.customer};second.sale_price_ore=first.sale_price_ore;second.created_at='2026-10-15T23:30:00Z';
 await open(p,pageFor([first],{nextCursor:'qa:next'}));
 await answer(p,pageFor([first,second]));await p.getByRole('button',{name:'Nästa',exact:true}).click();
 const choose=p.getByRole('button',{name:`Välj ${second.stockItem.vehicles.registration_number}`,exact:true});await expect(choose).toBeEnabled();
 await expect(p.getByText(new RegExp(second.stockItem.vehicles.registration_number)).first()).toBeVisible();
 await expect(choose.locator('..')).toContainText('2026-10-16');
 await choose.click();await expect(p.locator('input[name=deal_id]')).toHaveValue(second.id);
 const form=p.getByRole('form',{name:'Anmäl finansbehov',exact:true});await form.getByLabel('Önskat finansbelopp, kr').fill('123456.78');await form.getByLabel('Kontantinsats, kr').fill('10000');await form.getByLabel('Önskad löptid, månader',{exact:false}).fill('36');await form.getByLabel('Beskriv behovet').fill('Fiktivt behov');await form.getByLabel('Vad gäller behovet?').selectOption('stock');
 assert.equal(await p.locator('form form').count(),0);
 await form.getByRole('button',{name:'Skicka intresseanmälan'}).click();await p.waitForFunction(()=>window.fixture.writes.length===1);
 const submitted=await p.evaluate(()=>window.fixture.writes[0]);assert.equal(submitted.kind,'createFinanceIntakeRequest');assert.match(submitted.input.requestId,/^[a-f0-9-]{36}$/);const {requestId,...payload}=submitted.input;assert.deepEqual(payload,{companyId:COMPANY,dealId:second.id,product:'stock',requestedAmount:'123456.78',deposit:'10000',termMonths:'36',note:'Fiktivt behov'});
 const calls=await p.evaluate(()=>window.fixture.reads);assert.equal(calls[1].input.cursor,'qa:next');
 }finally{await p.close();}
});
test('search finds an older remote deal omitted from the initial workspace snapshot',async()=>{
 const {p,s}=await setup();try{const old=deal(1100);assert.ok(!s.deals.some(row=>row.id===old.id));await open(p,pageFor([]));await answer(p,pageFor([old],{filtered:1}));await p.getByRole('searchbox').fill(old.stockItem.vehicles.registration_number);await p.getByRole('button',{name:'Sök',exact:true}).click();await p.getByRole('button',{name:`Välj ${old.stockItem.vehicles.registration_number}`,exact:true}).click();await expect(p.locator('[name=deal_id]')).toHaveValue(old.id);assert.equal(await p.evaluate(()=>window.fixture.reads.at(-1).input.query),old.stockItem.vehicles.registration_number);}finally{await p.close();}
});
test('optional no-deal path needs no reads and clearing a selection preserves usable picker',async()=>{
 const {p}=await setup();try{assert.equal(await p.evaluate(()=>window.fixture.reads.length),0);await expect(p.locator('[name=deal_id]')).toHaveValue('');const row=deal(1);await open(p,pageFor([row]));const choose=p.getByRole('button',{name:`Välj ${row.stockItem.vehicles.registration_number}`,exact:true});await choose.click();await p.getByRole('button',{name:'Ta bort koppling'}).click();await expect(p.locator('[name=deal_id]')).toHaveValue('');await expect(choose).toBeEnabled();await choose.click();await expect(p.locator('[name=deal_id]')).toHaveValue(row.id);}finally{await p.close();}
});
test('denied refresh immediately clears chosen deal and its private identity',async()=>{
 const {p}=await setup();try{const row=deal(1);await open(p,pageFor([row]));await p.getByRole('button',{name:`Välj ${row.stockItem.vehicles.registration_number}`,exact:true}).click();await answer(p,{ok:false,error:'Åtkomst nekad'});await p.getByRole('button',{name:'Uppdatera',exact:true}).click();await expect(p.locator('[name=deal_id]')).toHaveValue('');await expect(p.getByRole('alert')).toContainText('Åtkomst nekad');await expect(p.getByText(row.stockItem.vehicles.registration_number,{exact:false})).toHaveCount(0);}finally{await p.close();}
});
test('company and actor/role changes clear selection and late previous-company reads cannot restore it',async()=>{
 const {p,s}=await setup();try{const row=deal(1);await open(p,pageFor([row]));await p.getByRole('button',{name:`Välj ${row.stockItem.vehicles.registration_number}`,exact:true}).click();await p.evaluate(()=>{window.fixture.manual=true;});await p.getByRole('button',{name:'Uppdatera',exact:true}).click();await p.waitForFunction(()=>window.fixture.requests.some(call=>!call.settled));const pending=await p.evaluate(()=>window.fixture.requests.find(call=>!call.settled).id);
 const other=snapshot({size:1,companyId:OTHER_COMPANY,userId:'10000000-0000-4000-8000-000000000009',role:'sales'});await p.evaluate(s=>window.mountFinance({snapshot:s,companyId:s.organization.id}),other);await expect(p.locator('[name=deal_id]')).toHaveValue('');await expect(p.locator('[name=expected_company_id]')).toHaveValue(OTHER_COMPANY);await p.evaluate(({id,result})=>window.fixture.respond(id,result),{id:pending,result:pageFor([row])});await expect(p.getByRole('button',{name:`Välj ${row.stockItem.vehicles.registration_number}`,exact:true})).toHaveCount(0);
 await p.evaluate(s=>window.mountFinance({snapshot:{...s,membership:{...s.membership,role:'viewer'}},companyId:s.organization.id}),s);await expect(p.getByRole('status')).toContainText('inte behörighet');await expect(p.locator('form')).toHaveCount(0);
 }finally{await p.close();}
});
test('snapshot refresh clears chosen deal before verification and changed status cannot restore it',async()=>{
 const {p,s}=await setup();try{const row=deal(1);await open(p,pageFor([row]));await p.getByRole('button',{name:`Välj ${row.stockItem.vehicles.registration_number}`,exact:true}).click();await p.evaluate(()=>window.fixture.manual=true);await p.evaluate(s=>window.mountFinance({snapshot:{...s},companyId:s.organization.id}),s);await expect(p.locator('[name=deal_id]')).toHaveValue('');await expect(p.getByRole('button',{name:`Välj ${row.stockItem.vehicles.registration_number}`,exact:true})).toBeDisabled();const changed={...row,status:'cancelled'};await p.waitForFunction(()=>window.fixture.requests.some(call=>!call.settled));await p.evaluate(result=>{const call=window.fixture.requests.find(call=>!call.settled);window.fixture.respond(call.id,result);},pageFor([changed]));await expect(p.locator('[name=deal_id]')).toHaveValue('');}finally{await p.close();}
});
test('mobile and demo remain usable without nested forms or remote reads in demo',async()=>{
 const {p}=await setup({width:320,demo:true});try{await p.getByRole('button',{name:'Välj affär',exact:true}).click();await expect(p.getByRole('button',{name:/^Välj QA/}).first()).toBeDisabled();assert.equal(await p.evaluate(()=>window.fixture.reads.length),0);await expect(p.getByRole('button',{name:'Skicka intresseanmälan'})).toBeDisabled();assert.equal(await p.locator('form form').count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}finally{await p.close();}
});

test('wrong-actor register refresh clears the hidden selection instead of accepting mismatched data',async()=>{
 const {p}=await setup({width:320});try{const row=deal(1);await open(p,pageFor([row]));await p.getByRole('button',{name:`Välj ${row.stockItem.vehicles.registration_number}`,exact:true}).click();await answer(p,pageFor([row],{actorId:'10000000-0000-4000-8000-000000000099'}));await p.getByRole('button',{name:'Uppdatera',exact:true}).click();await expect(p.getByRole('alert')).toContainText('behörigheten har ändrats');await expect(p.locator('[name=deal_id]')).toHaveValue('');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}finally{await p.close();}
});
