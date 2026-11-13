import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {startHarness,expect,respond} from './helpers/register-ui/runtime.mjs';
import {snapshot,registerPage} from './helpers/register-ui/fixtures.mjs';
let harness;
before(async()=>{harness=await startHarness();});
after(async()=>{assert.deepEqual(harness?.audit.posts,[]);assert.deepEqual(harness?.audit.errors,[]);await harness?.close();});

async function setup(width=1440){
 const p=await harness.page(width),data=snapshot({size:4});
 const result=registerPage({kind:'customers',rows:data.customers,total:4,filtered:4,counts:{all:4,person:2,business:2}});
 await p.evaluate(({data,result})=>{window.fixture.defaults.register=result;window.mountWorkspace({snapshot:data,section:'customers',demo:false});},{data,result});
 await p.getByRole('button',{name:data.customers[0].name,exact:true}).click();
 await expect(p.getByRole('dialog',{name:'Kundens kontaktlogg'})).toBeVisible();
 return {p,data,result};
}
async function reread(p,data,result,section='customers'){
 const expected=await p.evaluate(()=>window.fixture.reads.filter(row=>row.kind==='register').length+1);
 await p.evaluate(({data,result,section})=>{window.fixture.responses.register=[result];window.mountWorkspace({snapshot:{...data},section,demo:false});},{data,result,section});
 await p.waitForFunction(expected=>window.fixture.reads.filter(row=>row.kind==='register').length>=expected,expected);
}
for(const width of [320,1440])test(`verified customer refresh preserves an open draft but removal closes it at ${width}px`,async()=>{
 const {p,data,result}=await setup(width);
 try{
  await p.getByLabel('Anteckningsutkast',{exact:true}).fill('Osparad anteckning för denna kund');
  await reread(p,data,{wait:true});
  await expect(p.getByLabel('Anteckningsutkast',{exact:true})).toHaveValue('Osparad anteckning för denna kund');
  const pending=await p.evaluate(()=>window.fixture.requests.findLast(row=>row.kind==='register'&&!row.settled).id);
  await respond(p,pending,result);
  await expect(p.locator('section[aria-label="Kundregister"]')).toHaveAttribute('aria-busy','false');
  await expect(p.getByLabel('Anteckningsutkast',{exact:true})).toHaveValue('Osparad anteckning för denna kund');
  const remaining={ok:true,page:{...result.page,rows:result.page.rows.slice(1),totalCount:3,filteredCount:3,counts:{all:3,person:1,business:2}}};
  await reread(p,data,remaining);
  await expect(p.getByRole('dialog')).toHaveCount(0);
  await expect(p.getByRole('button',{name:data.customers[0].name,exact:true})).toHaveCount(0);
  assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }finally{await p.close();}
});

test('a denied customer refresh clears the open contact draft and a late previous read cannot restore it',async()=>{
 const {p,data,result}=await setup();
 try{
  await p.getByLabel('Anteckningsutkast',{exact:true}).fill('Privat osparad kontakt');
  await reread(p,data,{wait:true});
  const old=await p.evaluate(()=>window.fixture.requests.findLast(row=>row.kind==='register'&&!row.settled).id);
  await reread(p,data,{ok:false,error:'Kundregistret får inte längre läsas.'});
  await expect(p.getByRole('alert')).toContainText('får inte längre läsas');
  await expect(p.getByRole('dialog')).toHaveCount(0);
  await respond(p,old,result);
  await expect(p.getByRole('alert')).toContainText('får inte längre läsas');
  await expect(p.getByRole('button',{name:data.customers[0].name,exact:true})).toHaveCount(0);
  await expect(p.getByLabel('Anteckningsutkast',{exact:true})).toHaveCount(0);
  assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
 }finally{await p.close();}
});

test('a paginated customer refresh cannot treat an absent row as a deleted customer or discard its draft',async()=>{
 const {p,data,result}=await setup();
 try{
  await p.getByLabel('Anteckningsutkast',{exact:true}).fill('Behåll när kunden flyttas till nästa sida');
  const partial={ok:true,page:{...result.page,rows:result.page.rows.slice(1),totalCount:1207,filteredCount:1207,counts:{all:1207,person:600,business:607},nextCursor:'next-register-page'}};
  await reread(p,data,partial);
  await expect(p.locator('section[aria-label="Kundregister"]')).toHaveAttribute('aria-busy','false');
  await expect(p.getByRole('button',{name:data.customers[0].name,exact:true})).toHaveCount(0);
  await expect(p.getByLabel('Anteckningsutkast',{exact:true})).toHaveValue('Behåll när kunden flyttas till nästa sida');
  await expect(p.getByRole('dialog')).toBeVisible();
  assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
 }finally{await p.close();}
});

for(const width of [320,1440])test(`inventory refresh retains an edited price when the car moves outside the current page at ${width}px`,async()=>{
 const p=await harness.page(width),data=snapshot({size:4});
 const result=registerPage({kind:'inventory',rows:data.inventory,total:4,filtered:4,counts:{all:4,available:4,reserved:0,sold:0,archived:0}});
 try{
  await p.evaluate(({data,result})=>{window.fixture.defaults.register=result;window.mountWorkspace({snapshot:data,section:'inventory',demo:false});},{data,result});
  await p.getByRole('button',{name:'Visa Volvo V60 0001',exact:true}).click();
  const price=p.getByLabel('Uppdatera totalpris, kr inklusive eventuell moms',{exact:true});
  await price.fill('177000.29');
  await reread(p,data,{wait:true},'inventory');
  const pending=await p.evaluate(()=>window.fixture.requests.findLast(row=>row.kind==='register'&&!row.settled).id);
  await expect(price).toHaveValue('177000.29');
  const partial={ok:true,page:{...result.page,rows:result.page.rows.slice(1),totalCount:1207,filteredCount:1207,counts:{all:1207,available:1207,reserved:0,sold:0,archived:0},nextCursor:'next-register-page'}};
  await respond(p,pending,partial);
  await expect(p.locator('section[aria-label="Fordonsregister"]')).toHaveAttribute('aria-busy','false');
  await expect(p.getByRole('dialog')).toBeVisible();
  await expect(price).toHaveValue('177000.29');
  await expect(p.getByRole('button',{name:'Visa Volvo V60 0001',exact:true})).toHaveCount(0);
  const removed={ok:true,page:{...partial.page,totalCount:3,filteredCount:3,nextCursor:null,counts:{all:3,available:3,reserved:0,sold:0,archived:0}}};
  await reread(p,data,removed,'inventory');
  await expect(p.getByRole('dialog')).toHaveCount(0);
  assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }finally{await p.close();}
});
