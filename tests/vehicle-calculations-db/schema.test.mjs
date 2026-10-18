import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, asRole, runSqlTests } from './helpers.mjs';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C=id(100), C2=id(101), STOCK=id(200), STOCK2=id(201), COST=id(300);
const users={owner:id(1),admin:id(2),sales:id(3),finance:id(4),viewer:id(5),other:id(6),unverified:id(7),anonymous:id(8)};
async function rpc(db,user,name,args,role='authenticated') {
 return asRole(db,role,user,async tx=>(await tx.query(`select public.${name}(${Object.keys(args).map((key,index)=>`${key}=>$${index+1}`).join(',')}) as result`,Object.values(args))).rows[0].result);
}
const get=(db,user=users.owner,stock=STOCK,company=C)=>rpc(db,user,'get_vehicle_calculation',{p_company_id:company,p_stock_item_id:stock});
const totals=(db,user=users.owner,company=C)=>rpc(db,user,'inventory_dashboard_totals',{p_company_id:company});
async function save(db,{user=users.owner,stock=STOCK,company=C,version,purchase='2000000',confirmed=false,costs=[{costId:COST,deductibleVatOre:'250000'}]}={}) {
 if(version===undefined)version=(await get(db,user,stock,company)).version;
 return rpc(db,user,'save_vehicle_calculation_metadata',{p_company_id:company,p_stock_item_id:stock,p_expected_version:version,p_purchase_vat_ore:purchase,p_vat_basis_confirmed:confirmed,p_cost_vat:JSON.stringify(costs)});
}
const fails=(run,code)=>assert.rejects(run,error=>{assert.equal(error.code,code,`${error.code}: ${error.message}`);return true;});
async function fixture() {
 const db=await createDatabase();
 for(const [name,user] of Object.entries(users)) await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,case when $3 then null else now() end,$4)',[user,`${name}@example.test`,name==='unverified',name==='anonymous']);
 await db.query("insert into public.companies(id,name,organisation_number,created_by) values($1,'Fixture A','1234567890',$3),($2,'Fixture B','1234567891',$4)",[C,C2,users.owner,users.other]);
 for(const role of ['owner','admin','sales','finance','viewer'])await db.query('insert into public.memberships(company_id,user_id,role) values($1,$2,$3)',[C,users[role],role]);
 for(const name of ['unverified','anonymous'])await db.query("insert into public.memberships(company_id,user_id,role) values($1,$2,'owner')",[C,users[name]]);
 await db.query("insert into public.memberships(company_id,user_id,role) values($1,$2,'owner')",[C2,users.other]);
 await db.query("insert into public.vehicles(id,company_id,registration_number,make,model,model_year) values($1,$3,'CAL001','Fixture','A',2020),($2,$4,'CAL002','Fixture','B',2020)",[id(400),id(401),C,C2]);
 await db.query("insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme) values($1,$3,$5,10000000,12500000,'standard'),($2,$4,$6,9007199254740993,9007199254741003,'unknown')",[STOCK,STOCK2,C,C2,id(400),id(401)]);
 await db.query("insert into public.vehicle_costs(id,company_id,stock_item_id,category,description,amount_ore) values($1,$2,$3,'repair','Explicit repair receipt',1250000)",[COST,C,STOCK]);
 return db;
}
test('actual complete migration chain and rollback SQL grant/security contract',async()=>{const result=await runSqlTests();assert.ok(result.some(x=>x.rows.some(r=>r.result?.startsWith('PASS:'))));});
test('exact private financial reads allow owner admin finance, deny sales viewer and retain unsafe numeric amounts as text',async()=>{
 const db=await fixture();try{
  for(const role of ['owner','admin','finance']){const source=await get(db,users[role]);assert.equal(source.purchaseGrossOre,'10000000');assert.equal(source.costs[0].grossOre,'1250000');assert.equal(source.purchaseVatOre,null);assert.equal(typeof source.version,'string');}
  const precise=await get(db,users.other,STOCK2,C2);assert.equal(precise.purchaseGrossOre,'9007199254740993');
  for(const user of [null,users.sales,users.viewer,users.other,users.unverified,users.anonymous])await fails(()=>get(db,user),'42501');
  await fails(()=>get(db,users.owner,STOCK2,C),'P0002');
  for(const role of ['anon','service_role'])await fails(()=>rpc(db,users.owner,'inventory_dashboard_totals',{p_company_id:C},role),'42501');
  await db.query("update public.memberships set status='suspended' where company_id=$1 and user_id=$2",[C,users.owner]);await fails(()=>get(db),'42501');
 }finally{await db.close();}
});
test('explicit metadata saves use financial CAS and owner/admin authorization, deny finance sales viewer and direct grants',async()=>{
 const db=await fixture();try{
  for(const user of [users.owner,users.admin]){const current=await get(db,user);const result=await save(db,{user,version:current.version});assert.equal(result.purchaseVatOre,'2000000');assert.equal(result.costs[0].deductibleVatOre,'250000');}
  for(const user of [users.finance,users.sales,users.viewer,users.other])await fails(()=>save(db,{user,version:'1'}),'42501');
  await fails(()=>asRole(db,'authenticated',users.owner,tx=>tx.query('update public.stock_items set purchase_vat_ore=0 where id=$1',[STOCK])),'42501');
  await fails(()=>asRole(db,'authenticated',users.owner,tx=>tx.query('update public.vehicle_costs set deductible_vat_ore=0 where id=$1',[COST])),'42501');
  await fails(()=>asRole(db,'authenticated',users.owner,tx=>tx.query("insert into public.vehicle_costs(company_id,stock_item_id,category,description,amount_ore,deductible_vat_ore) values($1,$2,'other','forged',100,20)",[C,STOCK])),'42501');
  const before=await get(db);await db.query("update public.companies set status='suspended' where id=$1",[C]);await fails(()=>save(db,{version:before.version}),'42501');
 }finally{await db.close();}
});
test('price or VAT-model changes clear purchase/VMB assertions and old CAS versions cannot reapply them',async()=>{
 const db=await fixture();try{
  const saved=await save(db);assert.equal(saved.purchaseVatOre,'2000000');
  await asRole(db,'authenticated',users.sales,tx=>tx.query('update public.stock_items set asking_price_ore=asking_price_ore+1 where id=$1',[STOCK]));
  const changed=await get(db);assert.equal(changed.purchaseVatOre,null);assert.ok(BigInt(changed.version)>BigInt(saved.version));
  await fails(()=>save(db,{version:saved.version}),'40001');
  await db.query("update public.stock_items set vat_scheme='vmb' where id=$1",[STOCK]);
  const vmb=await save(db,{purchase:null,confirmed:true});assert.equal(vmb.vatBasisConfirmed,true);
  await db.query('update public.stock_items set purchase_price_ore=purchase_price_ore+1 where id=$1',[STOCK]);
  assert.equal((await get(db)).vatBasisConfirmed,false);await fails(()=>save(db,{purchase:null,confirmed:true,version:vmb.version}),'40001');
 }finally{await db.close();}
});
test('cost changes reset that receipt deduction and advance the aggregate financial version',async()=>{
 const db=await fixture();try{
  const saved=await save(db);
  const deniedUpdate=await asRole(db,'authenticated',users.sales,tx=>tx.query('update public.vehicle_costs set amount_ore=amount_ore+1 where id=$1',[COST]));assert.equal(deniedUpdate.affectedRows,0);
  const updated=await asRole(db,'authenticated',users.owner,tx=>tx.query('update public.vehicle_costs set amount_ore=amount_ore+1 where id=$1',[COST]));assert.equal(updated.affectedRows,1);
  const changed=await get(db);assert.equal(changed.costs[0].deductibleVatOre,null);assert.ok(BigInt(changed.version)>BigInt(saved.version));
  await fails(()=>save(db,{version:saved.version}),'40001');
  await db.query("insert into public.vehicle_costs(company_id,stock_item_id,category,description,amount_ore) values($1,$2,'other','new receipt',0)",[C,STOCK]);
  const inserted=await get(db);assert.ok(BigInt(inserted.version)>BigInt(changed.version));
  await fails(()=>save(db,{version:inserted.version}),'40001');
  await db.query('delete from public.vehicle_costs where id=$1',[COST]);assert.ok(BigInt((await get(db)).version)>BigInt(inserted.version));
 }finally{await db.close();}
});
test('evidence is bounded to its purchase/cost gross and exact full cost set; VMB never permits purchase VAT deduction',async()=>{
 const db=await fixture();try{
  await fails(()=>save(db,{purchase:'10000001'}),'22023');
  await fails(()=>save(db,{purchase:'2000001'}),'22023');
  await fails(()=>save(db,{costs:[{costId:COST,deductibleVatOre:'1250001'}]}),'22023');
  await fails(()=>save(db,{costs:[{costId:COST,deductibleVatOre:'250001'}]}),'22023');
  await fails(()=>save(db,{costs:[{costId:id(999),deductibleVatOre:'0'}]}),'22023');
  await fails(()=>save(db,{costs:[] }),'40001');
  await fails(()=>save(db,{confirmed:true}),'22023');
  await db.query("update public.stock_items set vat_scheme='vmb' where id=$1",[STOCK]);
  await fails(()=>save(db,{purchase:'1',confirmed:true}),'22023');
  const source=await save(db,{purchase:null,confirmed:true,costs:[{costId:COST,deductibleVatOre:'0'}]});assert.equal(source.costs[0].deductibleVatOre,'0');
  const alpha='aaaaaaaa-0000-4000-8000-000000000001';
  await db.query("insert into public.vehicle_costs(id,company_id,stock_item_id,category,description,amount_ore) values($1,$2,$3,'other','Second receipt',100)",[alpha,C,STOCK]);
  await fails(()=>save(db,{purchase:null,confirmed:true,costs:[{costId:alpha,deductibleVatOre:'0'},{costId:alpha.toUpperCase(),deductibleVatOre:'0'}]}),'40001');
 }finally{await db.close();}
});
test('full-company dashboard masks viewer purchase totals while authorized counts/sums cover more than500 rows and exceed PGbigint',async()=>{
 const db=await fixture();try{
  await db.query('update public.stock_items set purchase_price_ore=9223372036854775807 where id=$1',[STOCK]);
  await db.query("insert into public.vehicles(company_id,registration_number,make,model,model_year) select $1,'CAL'||n,'Fixture','Bulk',2020 from generate_series(1,501) n",[C]);
  await db.query("insert into public.stock_items(company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme) select $1,id,9223372036854775807,0,'unknown' from public.vehicles where company_id=$1 and registration_number<>'CAL001'",[C]);
  await db.query("insert into public.customers(company_id,name) select $1,'Customer '||n from generate_series(1,501) n",[C]);
  const masked=await totals(db,users.viewer);assert.equal(masked.purchaseValueOre,null);
  const result=await totals(db,users.owner);
  assert.equal(result.activeStockCount,'502');assert.equal(result.availableStockCount,'502');assert.equal(result.customerCount,'501');
  assert.equal(result.purchaseValueOre,(9223372036854775807n*502n).toString());
  assert.equal(typeof result.purchaseValueOre,'string');
  const other=await totals(db,users.other,C2);assert.equal(other.activeStockCount,'1');assert.equal(other.purchaseValueOre,'9007199254740993');
 }finally{await db.close();}
});
