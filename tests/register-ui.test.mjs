import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {startHarness,expect,readCount,idleRegister,rowIds,normalize,respond,queueRegister,searchRegister,installOptionBackend} from './helpers/register-ui/runtime.mjs';
import {COMPANY,USER,OTHER_COMPANY,OTHER_USER,uid,customer,stock,deal,snapshot,registerPage,optionsPage,registerProps} from './helpers/register-ui/fixtures.mjs';
let harness;
const results=[];
before(async()=>{harness=await startHarness();});
after(async()=>{if(harness){await harness.writeReport(results);await harness.close();}});
function scenario(name,operation){test(name,async()=>{try{const evidence=await operation();results.push({name,ok:true,evidence});}catch(error){results.push({name,ok:false,error:String(error)});throw error;}});}
async function setupRegister(kind='inventory',result=registerPage({kind}),overrides={},manual=false){
 const page=await harness.page();
 await page.evaluate(data=>{window.fixture.defaults.register=data.result;window.fixture.manual=data.manual;window.mountRegisters(data.props);},{result,manual,props:registerProps(kind,overrides)});
 if(!overrides.demo){await readCount(page,1);if(!manual)await idleRegister(page);}
 return page;
}
for(const [kind,factory] of [['inventory',stock],['customers',customer],['deals',deal]]){
 scenario(`${kind}: search finds a remote row absent from the first 500 snapshot records`,async()=>{
  const page=await setupRegister(kind,registerPage({kind,rows:Array.from({length:50},(_,i)=>factory(i+1)),nextCursor:'first-page-cursor'}));
  try{
   const target=factory(1205);
   await queueRegister(page,registerPage({kind,rows:[target],filtered:1}));
   await searchRegister(page,'  Träff 1205  ');await idleRegister(page);
   assert.deepEqual(await rowIds(page),[target.id]);
   const read=await page.evaluate(()=>window.fixture.reads.at(-1).input);
   assert.equal(read.query,'Träff 1205');assert.equal(read.cursor,null);assert.equal(read.expectedCompanyId,COMPANY);
   assert.match(normalize(await page.locator('.table-footer').innerText()),/1 207/);
   return {snapshotRows:500,remoteId:target.id,query:read.query};
  }finally{await page.close();}
 });
}
for(const [kind,sort] of [['inventory','recent'],['inventory','price_asc'],['deals','price_desc']]){
 scenario(`${kind}/${sort}: tied dates and prices preserve opaque cursors and previous-page history`,async()=>{
  const factory=kind==='inventory'?stock:deal;
  const first=Array.from({length:50},(_,i)=>factory(i+1)),second=Array.from({length:50},(_,i)=>factory(i+51));
  const initial=registerPage({kind,rows:first,total:100,filtered:100,nextCursor:'opaque-equal-key-page2'});
  const page=await setupRegister(kind,initial);
  try{
   if(sort!=='recent'){await queueRegister(page,initial);await page.getByRole('combobox',{name:kind==='inventory'?'Sortera bilar':'Sortera affärer'}).selectOption(sort);await idleRegister(page);}
   await queueRegister(page,registerPage({kind,rows:second,total:100,filtered:100}));
   await page.getByRole('button',{name:'Nästa',exact:true}).click();await idleRegister(page);
   assert.deepEqual(await rowIds(page),second.map(row=>row.id));
   const latest=await page.evaluate(()=>window.fixture.reads.at(-1).input);
   assert.equal(latest.cursor,'opaque-equal-key-page2');assert.equal(latest.sort,sort);
   await expect(page.getByRole('button',{name:'Nästa',exact:true})).toBeDisabled();
   await expect(page.getByRole('navigation',{name:'Registersidor'})).toContainText('Sida 2');
   await queueRegister(page,initial);await page.getByRole('button',{name:'Tidigare',exact:true}).click();await idleRegister(page);
   assert.deepEqual(await rowIds(page),first.map(row=>row.id));assert.equal((await page.evaluate(()=>window.fixture.reads.at(-1).input)).cursor,null);
   assert.equal(new Set([...first,...second].map(row=>row.id)).size,100);
   return {sort,distinctRows:100,equalPriceOre:19900029,equalDates:true};
  }finally{await page.close();}
 });
}
scenario('register failure is distinct from verified zero matches and retry preserves the query',async()=>{
 const page=await setupRegister('customers');
 try{
  await queueRegister(page,{ok:false,error:'QA: register unavailable'});await searchRegister(page,'Kvarvarande sökning');await idleRegister(page);
  await expect(page.getByRole('alert')).toContainText('QA: register unavailable');await expect(page.locator('.empty-state')).toHaveCount(0);
  assert.equal((await rowIds(page)).length,0);await expect(page.getByRole('searchbox')).toHaveValue('Kvarvarande sökning');
  await expect(page.locator('.table-footer')).toContainText('Antalet visas när registret har verifierats.');
  await queueRegister(page,registerPage({kind:'customers',rows:[],filtered:0}));await page.getByRole('button',{name:'Försök igen',exact:true}).click();await idleRegister(page);
  await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.locator('.empty-state')).toContainText('Inga kunder matchar');
  assert.equal((await page.evaluate(()=>window.fixture.reads.at(-1).input)).query,'Kvarvarande sökning');
  return {errorIsNotEmpty:true,retryPreservesQuery:true};
 }finally{await page.close();}
});
scenario('query/filter changes during in-flight reads discard stale rows, counts and cursors',async()=>{
 const page=await setupRegister('inventory',registerPage(),{},true);
 try{
  await respond(page,0,registerPage({rows:[stock(1)],nextCursor:'old-cursor'}));await idleRegister(page);
  await searchRegister(page,'OldQuery');await readCount(page,2);assert.equal((await rowIds(page)).length,0);
  await searchRegister(page,'NewQuery');await readCount(page,3);
  await page.getByRole('combobox',{name:'Lagerstatus'}).selectOption('reserved');await readCount(page,4);
  const reads=await page.evaluate(()=>window.fixture.reads);
  assert.equal(reads.at(-1).input.query,'NewQuery');assert.equal(reads.at(-1).input.status,'reserved');assert.equal(reads.at(-1).input.cursor,null);
  await respond(page,3,registerPage({rows:[stock(905,{status:'reserved'})],filtered:1}));
  await respond(page,2,registerPage({rows:[stock(904)],filtered:1}));await respond(page,1,registerPage({rows:[stock(903)],filtered:1}));await idleRegister(page);
  assert.deepEqual(await rowIds(page),[stock(905).id]);
  const applied=await page.evaluate(()=>window.fixture.pages.map(page=>page.rows.map(row=>row.id)));
  assert.ok(applied.every(ids=>!ids.includes(stock(903).id)&&!ids.includes(stock(904).id)));
  await expect(page.getByRole('searchbox')).toHaveValue('NewQuery');return {requests:reads.length,discardedResponses:2};
 }finally{await page.close();}
});
for(const [field,value] of [['companyId',OTHER_COMPANY],['userId',OTHER_USER],['role','viewer']]){
 scenario(`register ${field} change clears cached private rows before the next read`,async()=>{
  const page=await setupRegister('customers',registerPage({kind:'customers',rows:[customer(701,'Private old scope')]}));
  try{
   await page.evaluate(()=>window.fixture.manual=true);const props=registerProps('customers',{[field]:value});await page.evaluate(props=>window.mountRegisters(props),props);await readCount(page,2);
   assert.equal((await rowIds(page)).length,0);await expect(page.getByRole('searchbox')).toHaveValue('');
   await respond(page,1,registerPage({kind:'customers',rows:[customer(702,'Current scope')],companyId:props.companyId,actorId:props.userId,role:props.role}));await idleRegister(page);
   assert.deepEqual(await rowIds(page),[customer(702).id]);return {field,cachedRowsCleared:true};
  }finally{await page.close();}
 });
}
for(const [field,value] of [['companyId',OTHER_COMPANY],['actorId',OTHER_USER],['role','viewer'],['kind','inventory']]){
 scenario(`register rejects a response with a mismatched ${field}`,async()=>{
  const response=registerPage({kind:'customers',rows:[customer(901,'Must never appear')]});response.page[field]=value;
  const page=await setupRegister('customers',response);
  try{await expect(page.getByRole('alert')).toHaveCount(1);assert.equal((await rowIds(page)).length,0);await expect(page.locator('.table-footer')).toContainText('Antalet visas när registret har verifierats.');return {field,privateRowsHidden:true};}finally{await page.close();}
 });
}
for(const width of [320,1280])for(const kind of ['inventory','customers','deals']){
 scenario(`demo ${kind} pages and searches locally with zero actions at ${width}px`,async()=>{
  const page=await harness.page(width);
  try{
   const data=snapshot({size:75});if(kind==='deals')data.deals=Array.from({length:75},(_,i)=>{const {customer,stockItem,...row}=deal(i+1);return row;});
   await page.evaluate(props=>window.mountRegisters(props),registerProps(kind,{demo:true,snapshot:data}));
   assert.equal((await rowIds(page)).length,50);await page.getByRole('button',{name:'Nästa',exact:true}).click();assert.equal((await rowIds(page)).length,25);
   await searchRegister(page,kind==='customers'?'Kund 0075':'V60 0075');assert.equal((await rowIds(page)).length,1);
   await expect(page.getByRole('navigation',{name:'Registersidor'})).toContainText('Sida 1');assert.equal(await page.evaluate(()=>window.fixture.reads.length),0);
   const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(dimensions.document<=width&&dimensions.body<=width,JSON.stringify(dimensions));
   return {width,localPages:[50,25],actions:0,dimensions};
  }finally{await page.close();}
 });
}
async function setupDeal({width=1280,data,props={}}={}){
 const page=await harness.page(width);
 const optionData=data??{customers:[...Array.from({length:55},(_,i)=>customer(i+1)),customer(1205,'Fjärrkund 1205')],inventory:[...Array.from({length:55},(_,i)=>stock(i+1,{status:i===1?'reserved':'available',price:i===2?25000020:19900029})),stock(1205,{make:'Fjärrbil'})]};
 await installOptionBackend(page,optionData);
 await page.evaluate(props=>window.mountDeal(props),{snapshot:snapshot(),...props});
 if(!props.demo){await readCount(page,2);await readyPickers(page);}else await readyPickers(page);
 return page;
}
const customerPicker=page=>page.getByRole('combobox',{name:'Kund',exact:true});
const inventoryPicker=page=>page.getByRole('combobox',{name:'Bil',exact:true});
const dealPrice=page=>page.locator('input[name="sale_price"]');
const createDeal=page=>page.getByRole('button',{name:'Skapa affär',exact:true});
async function readyPickers(page){await expect(customerPicker(page)).toBeEnabled();await expect(inventoryPicker(page)).toBeEnabled();}
async function choosePair(page,customerId=customer(1).id,stockId=stock(1).id){await customerPicker(page).selectOption(customerId);await readyPickers(page);await inventoryPicker(page).selectOption(stockId);await readyPickers(page);await expect(createDeal(page)).toBeEnabled();}
scenario('deal selectors find customer and available stock beyond the first 500 snapshot records',async()=>{
 const page=await setupDeal();
 try{
  await page.getByRole('searchbox',{name:'Sök kund',exact:true}).fill('1205');await expect(customerPicker(page).locator(`option[value="${customer(1205).id}"]`)).toHaveCount(1);await expect(customerPicker(page)).toBeEnabled();
  await customerPicker(page).selectOption(customer(1205).id);await readyPickers(page);
  await page.getByRole('searchbox',{name:'Sök tillgänglig bil',exact:true}).fill('01205');await expect(inventoryPicker(page).locator(`option[value="${stock(1205).id}"]`)).toHaveCount(1);await expect(inventoryPicker(page)).toBeEnabled();
  await inventoryPicker(page).selectOption(stock(1205).id);await readyPickers(page);
  await expect(dealPrice(page)).toHaveValue('199000.29');await expect(createDeal(page)).toBeEnabled();
  const reads=await page.evaluate(()=>window.fixture.reads.filter(read=>read.kind==='options').map(read=>read.input));
  assert.ok(reads.some(read=>read.kind==='customers'&&read.query==='1205'&&read.expectedCompanyId===COMPANY));
  assert.ok(reads.some(read=>read.kind==='inventory'&&read.query==='01205'&&read.expectedCompanyId===COMPANY));
  return {snapshotRows:500,customer:customer(1205).id,stock:stock(1205).id,exactInputPrice:'199000.29'};
 }finally{await page.close();}
});
scenario('deal selector pagination preserves selected records and opaque cursor/back history',async()=>{
 const page=await setupDeal();
 try{
  await choosePair(page);await page.getByRole('button',{name:'Nästa kunder',exact:true}).click();await readyPickers(page);
  await expect(customerPicker(page)).toHaveValue(customer(1).id);
  const next=await page.evaluate(()=>window.fixture.reads.filter(read=>read.kind==='options'&&read.input.kind==='customers').at(-1).input);
  assert.equal(next.cursor,'qa:50');assert.equal(next.selectedId,customer(1).id);
  await expect(customerPicker(page).locator(`option[value="${customer(1).id}"]`)).toHaveCount(1);
  await expect(customerPicker(page).locator(`option[value="${customer(1205).id}"]`)).toHaveCount(1);
  await page.getByRole('button',{name:'Föregående kunder',exact:true}).click();await readyPickers(page);
  assert.equal((await page.evaluate(()=>window.fixture.reads.filter(read=>read.kind==='options'&&read.input.kind==='customers').at(-1).input)).cursor,null);
  await page.getByRole('button',{name:'Nästa bilar',exact:true}).click();await readyPickers(page);
  await expect(inventoryPicker(page)).toHaveValue(stock(1).id);await expect(dealPrice(page)).toHaveValue('199000.29');
  return {cursor:'qa:50',selectedCustomerPinned:true,selectedStockPinned:true};
 }finally{await page.close();}
});
scenario('deal search reconciliation pins valid selections and preserves a manually edited total price',async()=>{
 const page=await setupDeal();
 try{
  await choosePair(page);await dealPrice(page).fill('187 500,29');
  await page.getByRole('searchbox',{name:'Sök kund',exact:true}).fill('does-not-match');await expect(page.getByText('Inga val matchar sökningen.',{exact:true})).toHaveCount(1);await readyPickers(page);
  await expect(customerPicker(page)).toHaveValue(customer(1).id);
  await page.evaluate(id=>window.fixture.optionData.inventory.find(row=>row.id===id).asking_price_ore=29900095,stock(1).id);
  await page.getByRole('searchbox',{name:'Sök tillgänglig bil',exact:true}).fill('01205');await readyPickers(page);
  await expect(inventoryPicker(page)).toHaveValue(stock(1).id);await expect(dealPrice(page)).toHaveValue('187 500,29');await expect(createDeal(page)).toBeEnabled();
  await inventoryPicker(page).selectOption(stock(1205).id);await readyPickers(page);await expect(dealPrice(page)).toHaveValue('199000.29');
  return {validSelectionsPreserved:true,manualPrice:'187 500,29',newSelectionRefillsExactPrice:true};
 }finally{await page.close();}
});
scenario('deal options errors are distinct from empty search results and keep the search for retry',async()=>{
 const page=await setupDeal();
 try{
  await page.evaluate(()=>window.fixture.responses.options=[{ok:false,error:'QA: customer search failed'}]);
  await page.getByRole('searchbox',{name:'Sök kund',exact:true}).fill('unavailable-query');await expect(page.getByRole('alert')).toContainText('QA: customer search failed');
  await expect(page.getByText('Inga val matchar sökningen.',{exact:true})).toHaveCount(0);await expect(customerPicker(page)).toBeDisabled();await expect(createDeal(page)).toBeDisabled();
  await page.getByRole('button',{name:'Försök igen med kunder',exact:true}).click();await readyPickers(page);
  await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByText('Inga val matchar sökningen.',{exact:true})).toHaveCount(1);
  await expect(page.getByRole('searchbox',{name:'Sök kund',exact:true})).toHaveValue('unavailable-query');return {errorIsNotEmpty:true,retryPreservesSearch:true};
 }finally{await page.close();}
});
scenario('deal options ignore slow earlier search responses without dropping selected IDs or manual price',async()=>{
 const page=await setupDeal();
 try{
  await choosePair(page);await dealPrice(page).fill('180000,20');await page.evaluate(()=>window.fixture.manual=true);
  const count=await page.evaluate(()=>window.fixture.reads.length);
  await page.getByRole('searchbox',{name:'Sök kund',exact:true}).fill('SlowQuery');await readCount(page,count+1);
  const old=await page.evaluate(()=>window.fixture.reads.at(-1).id);await expect(createDeal(page)).toBeDisabled();
  await page.getByRole('searchbox',{name:'Sök kund',exact:true}).fill('FastQuery');await readCount(page,count+2);
  const current=await page.evaluate(()=>window.fixture.reads.at(-1).id);
  await respond(page,current,optionsPage({rows:[customer(1205,'Fast query match')],selected:customer(1),filtered:1}));
  await respond(page,old,optionsPage({rows:[customer(905,'Must not appear')],selected:customer(1),filtered:1}));await readyPickers(page);
  await expect(customerPicker(page)).toHaveValue(customer(1).id);await expect(customerPicker(page).locator(`option[value="${customer(905).id}"]`)).toHaveCount(0);
  await expect(customerPicker(page).locator(`option[value="${customer(1205).id}"]`)).toHaveCount(1);await expect(dealPrice(page)).toHaveValue('180000,20');
  return {staleResponseDiscarded:true,selectedCustomer:customer(1).id,manualPrice:'180000,20'};
 }finally{await page.close();}
});
for(const [field,value] of [['companyId',OTHER_COMPANY],['userId',OTHER_USER],['role','sales']]){
 scenario(`deal form ${field} switch resets selected customer, stock and price`,async()=>{
  const page=await setupDeal();
  try{await choosePair(page);await dealPrice(page).fill('199999,20');const next=snapshot({[field]:value});await page.evaluate(data=>window.mountDeal(data),{snapshot:next});await readyPickers(page);await expect(customerPicker(page)).toHaveValue('');await expect(inventoryPicker(page)).toHaveValue('');await expect(dealPrice(page)).toHaveValue('');await expect(createDeal(page)).toBeDisabled();return {field,selectionsReset:true,priceReset:true};}finally{await page.close();}
 });
}
scenario('deal form loss of edit role removes cached form and makes no further option requests',async()=>{
 const page=await setupDeal();
 try{await choosePair(page);const before=await page.evaluate(()=>window.fixture.reads.length);await page.evaluate(data=>window.mountDeal(data),{snapshot:snapshot({role:'viewer'})});await expect(page.locator('form')).toHaveCount(0);await expect(page.getByRole('status')).toContainText('inte behörighet');assert.equal(await page.evaluate(()=>window.fixture.reads.length),before);return {role:'viewer',formRemoved:true,furtherReads:0};}finally{await page.close();}
});
for(const [field,value] of [['companyId',OTHER_COMPANY],['actorId',OTHER_USER],['role','viewer'],['kind','inventory']]){
 scenario(`deal picker rejects response ${field} mismatch`,async()=>{
  const page=await harness.page();
  try{
   await page.evaluate(data=>{window.fixture.manual=true;window.mountDeal(data);},{snapshot:snapshot()});await readCount(page,2);
   const requests=await page.evaluate(()=>window.fixture.reads);const customerRead=requests.find(read=>read.input.kind==='customers'),stockRead=requests.find(read=>read.input.kind==='inventory');
   const wrong=optionsPage();wrong.page[field]=value;
   await respond(page,customerRead.id,wrong);await respond(page,stockRead.id,optionsPage({kind:'inventory'}));
   await expect(page.getByRole('alert')).toContainText('behörighet har ändrats');await expect(customerPicker(page)).toBeDisabled();await expect(createDeal(page)).toBeDisabled();
   return {field,responseRejected:true};
  }finally{await page.close();}
 });
}
scenario('deal picker clears a stock selection that is no longer available instead of silently reusing it',async()=>{
 const page=await setupDeal();
 try{
  await choosePair(page);await page.evaluate(id=>window.fixture.optionData.inventory.find(row=>row.id===id).status='reserved',stock(1).id);
  await page.getByRole('searchbox',{name:'Sök tillgänglig bil',exact:true}).fill('Volvo');await readyPickers(page);
  await expect(inventoryPicker(page)).toHaveValue('');await expect(dealPrice(page)).toHaveValue('');await expect(page.getByRole('alert')).toContainText('inte längre tillgänglig');await expect(createDeal(page)).toBeDisabled();
  await expect(customerPicker(page)).toHaveValue(customer(1).id);return {unavailableStockCleared:true,customerPreserved:true};
 }finally{await page.close();}
});
scenario('deal submission sends selected remote IDs and exact user price to the in-memory action only',async()=>{
 const page=await setupDeal();
 try{
  await choosePair(page);await dealPrice(page).fill('187 500,29');await createDeal(page).click();await page.waitForFunction(()=>window.fixture.writes.length===1);
  const write=await page.evaluate(()=>window.fixture.writes[0]);assert.equal(write.kind,'createDeal');assert.equal(write.input.customer_id,customer(1).id);assert.equal(write.input.stock_item_id,stock(1).id);assert.equal(write.input.sale_price,'187 500,29');
  return {mockedActionCalls:1,selectedCustomer:write.input.customer_id,selectedStock:write.input.stock_item_id,rawPrice:write.input.sale_price};
 }finally{await page.close();}
});
for(const width of [320,1280]){
 scenario(`demo deal selectors search/page/select with zero backend calls and no overflow at ${width}px`,async()=>{
  const data=snapshot({size:75});data.inventory[1].status='reserved';
  const page=await setupDeal({width,props:{snapshot:data,demo:true}});
  try{
   await customerPicker(page).selectOption(customer(1).id);await readyPickers(page);await inventoryPicker(page).selectOption(stock(1).id);await readyPickers(page);
   await expect(createDeal(page)).toBeDisabled();await page.getByRole('button',{name:'Nästa kunder',exact:true}).click();await readyPickers(page);await expect(customerPicker(page)).toHaveValue(customer(1).id);
   await page.getByRole('searchbox',{name:'Sök tillgänglig bil',exact:true}).fill('00075');await readyPickers(page);await expect(inventoryPicker(page).locator(`option[value="${stock(75).id}"]`)).toHaveCount(1);
   const text=await page.locator('form').innerText();assert.match(text,/74 tillgängliga bilar i företaget/);
   assert.equal(await page.evaluate(()=>window.fixture.reads.length),0);assert.equal(await page.evaluate(()=>window.fixture.writes.length),0);
   const dimensions=await page.evaluate(()=>({document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(dimensions.document<=width&&dimensions.body<=width,JSON.stringify(dimensions));
   return {width,availableTotal:74,excludedReserved:1,reads:0,writes:0,dimensions};
  }finally{await page.close();}
 });
}

scenario('register invalid-cursor errors offer a first-page recovery without losing criteria',async()=>{
 const first=registerPage({kind:'customers',rows:[customer(1205)],nextCursor:'invalid-after-change'});
 const page=await setupRegister('customers',first);
 try{
  await queueRegister(page,first);await searchRegister(page,'Behåll kriterier');await idleRegister(page);
  await queueRegister(page,{ok:false,error:'QA: cursor is no longer valid'});await page.getByRole('button',{name:'Nästa',exact:true}).click();await idleRegister(page);
  await expect(page.getByRole('alert')).toContainText('cursor is no longer valid');await expect(page.getByRole('button',{name:'Till första sidan',exact:true})).toBeVisible();
  assert.equal((await rowIds(page)).length,0);
  await queueRegister(page,first);await page.getByRole('button',{name:'Till första sidan',exact:true}).click();await idleRegister(page);
  const input=await page.evaluate(()=>window.fixture.reads.at(-1).input);assert.equal(input.cursor,null);assert.equal(input.query,'Behåll kriterier');
  await expect(page.getByRole('navigation',{name:'Registersidor'})).toContainText('Sida 1');await expect(page.getByRole('searchbox')).toHaveValue('Behåll kriterier');
  return {invalidCursorRecoverable:true,criteriaPreserved:true};
 }finally{await page.close();}
});
scenario('register and deal search controls enforce the backend 120-character boundary',async()=>{
 const register=await setupRegister();const chooser=await setupDeal();
 try{
  const inputs=[register.getByRole('searchbox'),chooser.getByRole('searchbox',{name:'Sök kund',exact:true}),chooser.getByRole('searchbox',{name:'Sök tillgänglig bil',exact:true})];
  for(const input of inputs){await expect(input).toHaveAttribute('maxlength','120');await input.fill('x'.repeat(130));assert.equal((await input.inputValue()).length,120);}
  return {controls:3,maxLength:120};
 }finally{await register.close();await chooser.close();}
});

const remoteStock=()=>stock(1205,{make:'Fjärrbil'});
const costRecord=(item=remoteStock())=>({id:uid(900001),stock_item_id:item.id,category:'transport',description:'Känd verifierad transport',amount_ore:250050,incurred_on:'2026-10-15',created_at:'2026-10-15T12:00:00Z'});
const costResponse=({item=remoteStock(),costs=[costRecord(item)],...identity}={})=>({ok:true,companyId:COMPANY,actorId:USER,role:'owner',stockItemId:item.id,costs,...identity});
async function setupWorkspace({width=1280,section='inventory',item=remoteStock(),result,costs=costResponse({item}),data=snapshot({size:1}),demo=false}={}){
 const page=await harness.page(width);
 await page.evaluate(config=>{window.fixture.defaults.register=config.result;window.fixture.defaults.costs=config.costs;window.mountWorkspace(config.props);},{result:result??registerPage({kind:section,rows:[item]}),costs,props:{section,snapshot:data,demo}});
 if(section!=='dashboard'&&!demo){await readCount(page,1);await idleRegister(page);}
 return page;
}
const costSurface=page=>page.getByRole('region',{name:'Bilens kostnader och kalkyl',exact:true});
const costSubmit=page=>costSurface(page).getByRole('button',{name:'Registrera kostnad',exact:true});
async function openStock(page,item=remoteStock()){
 await page.getByRole('button',{name:`${item.vehicles.make} ${item.vehicles.model}`,exact:true}).click();
 const modal=page.getByRole('dialog',{name:`${item.vehicles.make} ${item.vehicles.model}`,exact:true});await expect(modal).toBeVisible();return modal;
}
scenario('workspace deal table renders joined customer and vehicle absent from the snapshot sample',async()=>{
 const row=deal(1205);row.customer.name='Fjärrkund från hela registret';row.stockItem.vehicles.make='Fjärrbil från hela registret';
 const page=await setupWorkspace({section:'deals',result:registerPage({kind:'deals',rows:[row]}),data:snapshot({size:1})});
 try{
  const register=page.getByRole('region',{name:'Affärsregister',exact:true});
  await expect(register).toContainText(row.customer.name);await expect(register).toContainText(`${row.stockItem.vehicles.make} ${row.stockItem.vehicles.model}`);await expect(register).toContainText(row.stockItem.vehicles.registration_number);
  assert.equal(await page.evaluate(()=>window.fixture.reads.filter(read=>read.kind==='costs'||read.kind==='options').length),0);
  return {joinedCustomer:row.customer.id,joinedStock:row.stockItem.id,snapshotRows:1,lazyReads:0};
 }finally{await page.close();}
});
scenario('workspace remote stock opens a named modal and lazily verifies costs rather than treating read failure as zero',async()=>{
 const page=await setupWorkspace({costs:{ok:false,error:'QA: costs unavailable'}});
 try{
  assert.equal(await page.evaluate(()=>window.fixture.reads.filter(read=>read.kind==='costs').length),0);
  const modal=await openStock(page);await expect(modal.getByRole('alert')).toContainText('QA: costs unavailable');
  const read=await page.evaluate(()=>window.fixture.reads.find(read=>read.kind==='costs').input);assert.deepEqual(read,{stockItemId:remoteStock().id,expectedCompanyId:COMPANY});
  await expect(costSurface(page).getByText('Inga kostnader har registrerats på bilen ännu.',{exact:true})).toHaveCount(0);await expect(costSubmit(page)).toHaveCount(0);await expect(modal.getByTestId('calculation-consumer')).toHaveCount(0);
  await page.evaluate(result=>window.fixture.responses.costs=[result],costResponse({costs:[]}));await modal.getByRole('button',{name:'Försök igen med kostnaderna',exact:true}).click();
  await expect(costSurface(page)).toContainText('Inga kostnader har registrerats på bilen ännu.');await expect(costSubmit(page)).toBeEnabled();await expect(modal.getByTestId('calculation-consumer')).toHaveText('Verifierade kostnadsposter: 0');
  assert.equal(await page.evaluate(()=>window.fixture.writes.length),0);return {remoteStock:remoteStock().id,costReads:2,errorIsNotZero:true,verifiedEmptyAccepted:true,writes:0};
 }finally{await page.close();}
});
for(const [field,value] of [['companyId',OTHER_COMPANY],['actorId',OTHER_USER],['role','viewer'],['stockItemId',stock(9).id]]){
 scenario(`workspace cost dialog rejects response ${field} mismatch`,async()=>{
  const page=await setupWorkspace({costs:costResponse({[field]:value})});
  try{
   const modal=await openStock(page);await expect(modal.getByRole('alert')).toContainText('behörigheten har ändrats');
   await expect(costSurface(page).getByText(costRecord().description,{exact:true})).toHaveCount(0);await expect(modal.getByTestId('calculation-consumer')).toHaveCount(0);await expect(costSubmit(page)).toHaveCount(0);
   return {field,mismatchedCostsHidden:true};
  }finally{await page.close();}
 });
}
scenario('workspace cost draft survives same-scope snapshot refresh, deferred failure and verified retry',async()=>{
 const page=await setupWorkspace();
 try{
  const modal=await openStock(page);await expect(modal.getByTestId('calculation-consumer')).toHaveText('Verifierade kostnadsposter: 1');await expect(costSubmit(page)).toBeEnabled();
  const description=costSurface(page).locator('input[name="description"]'),amount=costSurface(page).locator('input[name="amount"]');
  await description.fill('Utkast som ska överleva');await amount.fill('1234.56');
  const before=await page.evaluate(()=>window.fixture.reads.length);
  await page.evaluate(()=>{window.fixture.responses.costs=[{wait:true}];const props=window.fixture.workspaceProps;window.mountWorkspace({...props,snapshot:structuredClone(props.snapshot)});});
  await readCount(page,before+2);await expect(costSurface(page).getByRole('status')).toContainText('Hämtar bilens kostnader');await expect(costSubmit(page)).toBeDisabled();
  await expect(description).toHaveValue('Utkast som ska överleva');await expect(amount).toHaveValue('1234.56');await expect(modal.getByTestId('calculation-consumer')).toHaveCount(0);await expect(costSurface(page).getByText(costRecord().description,{exact:true})).toHaveCount(0);
  const pending=await page.evaluate(()=>window.fixture.requests.findLast(request=>request.kind==='costs'&&!request.settled).id);
  await respond(page,pending,{ok:false,error:'QA: refreshed costs failed'});await expect(costSurface(page).getByRole('alert')).toContainText('refreshed costs failed');
  await expect(description).toHaveValue('Utkast som ska överleva');await expect(amount).toHaveValue('1234.56');await expect(costSubmit(page)).toBeDisabled();await expect(modal.getByTestId('calculation-consumer')).toHaveCount(0);await expect(costSurface(page).getByText(costRecord().description,{exact:true})).toHaveCount(0);
  await page.evaluate(result=>window.fixture.responses.costs=[result],costResponse());await modal.getByRole('button',{name:'Försök igen med kostnaderna',exact:true}).click();
  await expect(costSubmit(page)).toBeEnabled();await expect(description).toHaveValue('Utkast som ska överleva');await expect(amount).toHaveValue('1234.56');await expect(modal.getByTestId('calculation-consumer')).toHaveText('Verifierade kostnadsposter: 1');await expect(costSurface(page).getByText(costRecord().description,{exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.fixture.writes.length),0);return {draftPreservedAcross:['loading','error','retry'],staleAmountsHidden:true,submitBlockedUntilVerified:true,writes:0};
 }finally{await page.close();}
});
scenario('workspace register refresh updates modal prices for a stock row outside the snapshot',async()=>{
 const page=await setupWorkspace();
 try{
  const modal=await openStock(page);await expect(costSubmit(page)).toBeEnabled();
  const price=modal.locator('.detail-list div').filter({has:page.locator('dt',{hasText:'Totalpris inklusive eventuell moms'})}).locator('dd');await expect(price).toHaveText(/199\s*000,29 kr/);
  const updated=remoteStock();updated.asking_price_ore=21900059;
  await page.evaluate(result=>{window.fixture.defaults.register=result;const props=window.fixture.workspaceProps;window.mountWorkspace({...props,snapshot:structuredClone(props.snapshot)});},registerPage({rows:[updated]}));
  await expect(price).toHaveText(/219\s*000,59 kr/);await expect(costSubmit(page)).toBeEnabled();
  return {snapshotMissingStock:true,oldPriceOre:19900029,newPriceOre:21900059};
 }finally{await page.close();}
});
scenario('workspace dashboard snapshot refresh updates the selected vehicle detail price',async()=>{
 const item=stock(1),page=await setupWorkspace({section:'dashboard',item,costs:costResponse({item})});
 try{
  const modal=await openStock(page,item);await expect(costSubmit(page)).toBeEnabled();
  const price=modal.locator('.detail-list div').filter({has:page.locator('dt',{hasText:'Totalpris inklusive eventuell moms'})}).locator('dd');await expect(price).toHaveText(/199\s*000,29 kr/);
  await page.evaluate(()=>{const props=window.fixture.workspaceProps,next=structuredClone(props.snapshot);next.inventory[0].asking_price_ore=20100027;window.mountWorkspace({...props,snapshot:next});});
  await expect(price).toHaveText(/201\s*000,27 kr/);return {source:'dashboard snapshot',newPriceOre:20100027};
 }finally{await page.close();}
});
for(const [field,value] of [['companyId',OTHER_COMPANY],['userId',OTHER_USER],['role','viewer']]){
 scenario(`workspace ${field} change closes the private stock/cost modal before the next response`,async()=>{
  const page=await setupWorkspace();
  try{
   await openStock(page);await expect(costSubmit(page)).toBeEnabled();
   await page.evaluate(props=>{window.fixture.manual=true;window.mountWorkspace(props);},{snapshot:snapshot({size:1,[field]:value}),section:'inventory'});
   await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText(costRecord().description,{exact:true})).toHaveCount(0);
   return {field,privateModalClosed:true};
  }finally{await page.close();}
 });
}
for(const width of [320,1280]){
 scenario(`demo workspace remote-register and cost-dialog integration stays local at ${width}px`,async()=>{
  const data=snapshot({size:75});data.vehicle_costs=[costRecord(data.inventory[0])];
  const page=await setupWorkspace({width,demo:true,data});
  try{
   await page.getByRole('button',{name:'Nästa',exact:true}).click();await expect(page.getByRole('region',{name:'Fordonsregister',exact:true})).toContainText('Sida 2');
   await searchRegister(page,'QA00075');const modal=await openStock(page,stock(75));await expect(modal.getByTestId('calculation-consumer')).toHaveText('Verifierade kostnadsposter: 0');await expect(costSubmit(page)).toHaveCount(0);
   const dimensions=await page.evaluate(()=>({document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(dimensions.document<=width&&dimensions.body<=width,JSON.stringify(dimensions));
   assert.equal(await page.evaluate(()=>window.fixture.reads.length),0);assert.equal(await page.evaluate(()=>window.fixture.writes.length),0);
   return {width,localPaging:true,localCosts:true,reads:0,writes:0,dimensions};
  }finally{await page.close();}
 });
}
scenario('register UI harness performs zero HTTP POSTs and has no uncaught browser errors',async()=>{
 assert.deepEqual(harness.audit.posts,[]);assert.deepEqual(harness.audit.errors,[]);return {httpPosts:0,uncaughtBrowserErrors:0};
});
