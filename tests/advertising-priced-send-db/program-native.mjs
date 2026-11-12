// Real PostgreSQL sessions in an isolated network-none test database; no hosted IO.
import {before,test} from 'node:test';import assert from 'node:assert/strict';
import {bootstrap,sql,session,waitForLock} from './program-native-helpers.mjs';
import {fixtureSql,id,A,U,C,L} from './fixtures.mjs';
before(bootstrap);
const begin=u=>`begin;set local role authenticated;set local request.jwt.claim.sub='${u}';`;
const asUser=(u,s)=>JSON.parse(sql(`${begin(u)}select to_jsonb(${s});commit;`));
let store,period;
const input=(version=0,price='62000')=>({version,period_id:period,agreement_reference:'Native reviewed agreement',desired_start:'2026-01-01',confirmed_start:'2026-01-01',blocket_price_ore:price,monthly_fee_ore:'100',partial_month_rule:'full'});
const saveCall=(version=1,price='78000')=>`public.save_advertising_program('${C}','${store}','${JSON.stringify(input(version,price))}'::jsonb)`;
const quoteCall=()=>`public.get_advertising_send_quote('${C}','${L}',2,array['blocket'])`;
const billingCall=()=>`public.get_platform_advertising_billing('${C}','2026-09')`;
const closeCall=token=>`public.lock_advertising_billing_period('${C}','2026-09','${token}',true,false,'${id(730)}')`;
function seed(){
 sql(`begin;truncate auth.users,private.advertising_dispatchers cascade;${fixtureSql}commit;`);period=id(701);
 store=asUser(A,`public.save_advertising_program('${C}',null,'{"store_name":"Native Store","dealer_code":"fixture"}')`);
 asUser(A,saveCall(0,'62000'));
 asUser(U,`public.bind_advertising_listing_program('${C}','${L}',2,'${store}','${id(702)}')`);
 sql("alter table private.advertising_usage_tracking disable trigger immutable_advertising_tracking;update private.advertising_usage_tracking set started_at='2025-01-01T00:00:00Z';alter table private.advertising_usage_tracking enable trigger immutable_advertising_tracking;");
}
test('legacy program save holds shared billing lock: blocked quote reads committed latest customer price',async()=>{
 seed();const a=session('program_save_wins'),b=session('program_quote_waits');try{await a.ready();await b.ready();await a.query(`${begin(A)}select ${saveCall()};`);
 const waiting=b.query(`${begin(U)}select ${quoteCall()};commit;`);await waitForLock('program_quote_waits');await a.query('commit;');const q=JSON.parse(await waiting);assert.equal(q.items[0].unitPriceOre,'78000');assert.equal(q.items[0].program.version,2);
 }finally{a.close();b.close();}
});
test('quoted program lock serializes legacy price edit; stale accepted quote creates no jobs or charge',async()=>{
 seed();const a=session('program_quote_wins'),b=session('program_save_waits');try{await a.ready();await b.ready();const q=JSON.parse(await a.query(`${begin(U)}select ${quoteCall()};`));
 const waiting=b.query(`${begin(A)}select ${saveCall()};commit;`);await waitForLock('program_save_waits');await a.query('commit;');await waiting;
 assert.throws(()=>asUser(U,`public.send_vehicle_advertisement_priced('${C}','${L}',2,array['blocket'],'${id(703)}','${q.reviewToken}')`),/quote changed/);assert.equal(sql('select count(*) from private.advertising_jobs'),'0');assert.equal(sql('select count(*) from private.advertising_charge_commitments'),'0');
 }finally{a.close();b.close();}
});
test('fee review commit prevents stale concurrent period lock; closing freezes fee before waiting program revision',async()=>{
 seed();const old=asUser(A,billingCall()),a=session('fee_review_wins'),b=session('fee_lock_waits');try{await a.ready();await b.ready();
 await a.query(`${begin(A)}select public.review_advertising_store_fee('${C}','${store}','2026-09','${period}',1,'100','2026-09-30','Native manually reviewed month',true,'${id(704)}');`);
 const waiting=b.query(`${begin(A)}select ${closeCall(old.reviewToken)};commit;`);await waitForLock('fee_lock_waits');await a.query('commit;');await assert.rejects(waiting,/Period changed/);assert.equal(sql('select count(*) from private.advertising_billing_periods'),'0');
 }finally{a.close();b.close();}
 const page=asUser(A,billingCall()),x=session('fee_close_wins'),y=session('fee_save_waits_close');try{await x.ready();await y.ready();await x.query(`${begin(A)}select ${closeCall(page.reviewToken)};`);
 const waiting=y.query(`${begin(A)}select ${saveCall()};commit;`);await waitForLock('fee_save_waits_close');await x.query('commit;');await waiting;
 const current=asUser(A,billingCall());assert.equal(current.locked.totalOre,'100');assert.equal(current.locked.storeFees[0].programVersion,1);assert.equal(current.feeReviewRequired,true);assert.equal(sql('select count(*) from private.advertising_billing_periods'),'1');
 }finally{x.close();y.close();}
});
