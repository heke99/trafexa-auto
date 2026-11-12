import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,id,A,U,C,L,SALES,FOREIGN,call,quote,rate,send,counts,fail,publish} from './fixtures.mjs';
const save=(db,store,input)=>call(db,'select public.save_advertising_program($1,$2,$3) r',[C,store,input],A);
const bind=(db,store,request=id(500),user=U)=>call(db,'select public.bind_advertising_listing_program($1,$2,2,$3,$4) r',[C,L,store,request],user);
const start='2026-01-01';
const program=(price='62000')=>({version:0,agreement_reference:'Signed customer agreement',desired_start:start,confirmed_start:start,blocket_price_ore:price,bytbil_price_ore:'123',monthly_fee_ore:'0',partial_month_rule:'full',blocket_cost_ore:'987654321',monthly_cost_ore:'999999999'});
async function setup(db,price='62000',code='fixture') {const store=await save(db,null,{store_name:'Stockholm',dealer_code:code});await save(db,store,program(price));return store;}
async function nextRevision(db,store,patch) {const page=await call(db,'select public.list_advertising_program($1) r',[C],A),period=page.stores.find(s=>s.id===store).periods[0];await save(db,store,{...period,...patch,version:period.version});return period;}

test('explicit store selection supersedes company rate without disclosing supplier costs or mapping Bytbil to Wayke',async()=>{const db=await fixture();try{
 await rate(db,'blocket','111');await rate(db,'wayke','444',0,id(501));const store=await setup(db);let q=await quote(db);assert.equal(q.items[0].blockedReason,'store_required');assert.equal(q.items[0].unitPriceOre,null);assert.equal(q.items[1].unitPriceOre,'444');assert.equal(q.totalOre,null);
 const bound=await bind(db,store);assert.equal(bound.storeId,store);assert.deepEqual(await bind(db,store),bound);await fail(bind(db,store,id(500),FOREIGN),'42501');
 q=await quote(db,['blocket','wayke'],SALES);assert.equal(q.items[0].unitPriceOre,'62000');assert.equal(q.items[0].rateId,null);assert.equal(q.items[0].program.storeId,store);assert.equal(q.items[1].unitPriceOre,'444');assert.equal(q.totalOre,'62444');assert.equal(JSON.stringify(q).includes('987654321'),false);assert.equal(JSON.stringify(q).includes('cost'),false);assert.equal(q.selectedProgramStoreId,store);
 await fail(send(db,q,q.channels,id(502)), '40001'); // actor-bound quote cannot be accepted by another actor
}finally{await db.close();}});

test('accepted program price and revision survive changes, retries and real publication pricing exactly once',async()=>{const db=await fixture();try{
 const store=await setup(db);await bind(db,store);const old=await quote(db,['blocket']);await nextRevision(db,store,{blocket_price_ore:'78000'});await fail(send(db,old),'40001');const q=await quote(db,['blocket']),sent=await send(db,q);assert.equal(q.items[0].program.version,2);assert.equal(sent.jobs.length,1);
 await nextRevision(db,store,{blocket_price_ore:'99900'});assert.deepEqual(await send(db,q),sent);const frozen=await quote(db,['blocket']);assert.equal(frozen.items[0].unitPriceOre,'78000');assert.equal(frozen.items[0].program.version,2);assert.equal(frozen.reviewToken,q.reviewToken);
 const c=(await db.query('select * from private.advertising_charge_commitments')).rows[0];assert.equal(c.program_store_id,store);assert.equal(c.program_version,2);assert.equal(c.rate_id,null);
 const job=(await db.query('select * from private.advertising_job_price_commitments')).rows[0];assert.equal(job.program_version,2);
 await publish(db,sent.jobs[0]);const p=(await db.query('select * from private.advertising_publication_prices')).rows[0];assert.equal(p.source,'program');assert.equal(p.unit_price_ore,78000);assert.equal(p.program_store_id,store);assert.equal(p.program_version,2);assert.equal(p.rate_id,null);assert.equal((await quote(db,['blocket'])).items[0].chargeOre,'0');assert.equal((await counts(db)).prices,1);
 await fail(db.query('update private.advertising_charge_commitments set unit_price_ore=1'),'55000');await fail(db.query('delete from private.advertising_job_price_commitments'),'55000');
}finally{await db.close();}});

test('two stores retain distinct zero/null prices; immutable accepted destination cannot move to another store',async()=>{const db=await fixture();try{
 const first=await setup(db,'0');const second=await save(db,null,{store_name:'Göteborg',dealer_code:'another-dealer'});await save(db,second,program('78000'));
 await bind(db,second);let q=await quote(db,['blocket']);assert.equal(q.items[0].unitPriceOre,'78000');assert.equal(q.items[0].blockedReason,'destination_mismatch');await fail(send(db,q),'22023');assert.equal((await counts(db)).jobs,0);
 await bind(db,first,id(503));q=await quote(db,['blocket']);assert.equal(q.totalOre,'0');await send(db,q);await fail(bind(db,second,id(504)),'40001');await nextRevision(db,first,{blocket_price_ore:null});assert.equal((await quote(db,['blocket'])).items[0].unitPriceOre,'0');
 await fail(bind(db,first,id(500)),'40001'); // same nonce, different payload (prior requested second? tested below)
}finally{await db.close();}});

test('unconfirmed starts, missing price and unconfirmed overdue end block new acceptance; confirmed end is exclusive',async()=>{const db=await fixture();try{
 const store=await save(db,null,{store_name:'Pending',dealer_code:'fixture'});await save(db,store,{...program(null),confirmed_start:null});await bind(db,store);let q=await quote(db,['blocket']);assert.equal(q.items[0].blockedReason,'agreement_inactive');await nextRevision(db,store,{confirmed_start:start});q=await quote(db,['blocket']);assert.equal(q.items[0].blockedReason,'program_price_missing');await fail(send(db,q),'22023');await nextRevision(db,store,{blocket_price_ore:'0',notice_date:'2026-02-01',contract_end:'2026-03-01'});q=await quote(db,['blocket']);assert.equal(q.items[0].blockedReason,'agreement_inactive');await fail(send(db,q),'22023');
 await nextRevision(db,store,{confirmed_end:'2026-03-02'});assert.equal((await quote(db,['blocket'])).items[0].blockedReason,'agreement_inactive');
}finally{await db.close();}});

test('Wayke acceptance permits later explicit Blocket store choice; earlier legacy Blocket identity stays on its accepted company price',async()=>{const db=await fixture();try{
 await rate(db,'wayke','444',0,id(601));const store=await setup(db);await send(db,await quote(db,['wayke']));await bind(db,store);const q=await quote(db,['blocket']);assert.equal(q.items[0].unitPriceOre,'62000');await send(db,q,['blocket'],id(602));
}finally{await db.close();}
const legacy=await fixture();try{await rate(legacy,'blocket','777');const q=await quote(legacy,['blocket']);await send(legacy,q);await setup(legacy);assert.equal((await quote(legacy,['blocket'])).items[0].unitPriceOre,'777');
await legacy.query("insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by) select company_id,listing_id,3,snapshot,created_by from private.advertising_versions where listing_id=$1 and version=2",[L]);await legacy.query('update private.advertising_listings set version=3 where id=$1',[L]);const next=await call(legacy,'select public.get_advertising_send_quote($1,$2,3,$3) r',[C,L,['blocket']]);const receipt=await call(legacy,'select public.send_vehicle_advertisement_priced($1,$2,3,$3,$4,$5) r',[C,L,['blocket'],id(603),next.reviewToken]);assert.equal(receipt.quote.items[0].unitPriceOre,'777');assert.equal(receipt.quote.items[0].program,undefined);
}finally{await legacy.close();}});

test('new job after expired program is blocked while lost-response replay of prior acceptance remains valid',async()=>{const db=await fixture();try{
 const store=await setup(db);await bind(db,store);const q=await quote(db,['blocket']),receipt=await send(db,q);await nextRevision(db,store,{notice_date:'2026-02-01',contract_end:'2026-03-01',confirmed_end:'2026-03-02'});
 assert.deepEqual(await send(db,q),receipt);const current=await quote(db,['blocket']);assert.equal(current.items[0].unitPriceOre,'62000');assert.equal(current.items[0].program.version,1);assert.equal(current.items[0].blockedReason,'agreement_inactive');assert.equal(current.totalOre,null);await fail(send(db,current,['blocket'],id(604)),'22023');
 await db.query("update public.memberships set role='viewer' where company_id=$1 and user_id=$2",[C,U]);await fail(bind(db,store),'42501');
}finally{await db.close();}});
