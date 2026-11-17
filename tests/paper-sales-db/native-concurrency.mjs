// Run only against a disposable network=none PostgreSQL container.
import assert from'node:assert/strict';import{bootstrap,sql,session,waitForLock,database}from'../direct-deal-db/native-helpers.mjs';
const id=n=>`fa140000-0000-4000-8000-${String(n).padStart(12,'0')}`,U=id(1),C=id(2),S=id(3),V=id(4),Q=id(5);const auth=`begin;set local role authenticated;set local "request.jwt.claim.sub"='${U}';`,buyer=JSON.stringify({name:'Synthetic Native Paper Buyer',kind:'person',email:null,phone:null}),prepare=`select public.prepare_paper_sale('${C}','${S}',null,null,'${buyer}'::jsonb,12500029,'2026-11-14','TEST-PAPER-NATIVE','Original in synthetic file','${Q}');`,object=s=>JSON.parse(s.split('\n').findLast(x=>x.startsWith('{')));const sessions=[];let ready=false;
try{await bootstrap();ready=true;sql(`insert into auth.users(id,email,email_confirmed_at)values('${U}','paper-native@example.invalid',now());insert into private.account_approvals(user_id,status,updated_by)values('${U}','approved','${U}');insert into public.companies(id,name,organisation_number,created_by)values('${C}','Native paper test','5568554884','${U}');insert into public.memberships(company_id,user_id,role)values('${C}','${U}','owner');insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('${V}','${C}','PT14000','Synthetic','Car',2025);insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('${S}','${C}','${V}',10000000,15000000,'standard');`);
const writer=session('paper_writer'),replay=session('paper_replay'),editor=session('paper_editor');sessions.push(writer,replay,editor);await Promise.all(sessions.map(x=>x.ready()));
const review=object(await writer.query(auth+prepare));const duplicate=replay.query(auth+prepare+'commit;');await waitForLock('paper_replay');await writer.query('commit;');assert.deepEqual(object(await duplicate),review);assert.equal(sql('select count(*) from private.paper_sale_reviews;'),'1');assert.equal(sql('select count(*) from public.deals;'),'0');
const competitor=object(await replay.query(auth+prepare.replace(Q,id(7))+'commit;'));
const confirm=`select public.confirm_paper_sale('${C}','${review.reviewId}','${review.reviewHash}',true,'${id(6)}');`;const receipt=object(await writer.query(auth+confirm));const repeated=replay.query(auth+confirm+'commit;');await waitForLock('paper_replay');const blockedPromise=editor.query(`${auth}do $$begin perform public.confirm_paper_sale('${C}','${competitor.reviewId}','${competitor.reviewHash}',true,'${id(8)}');raise exception 'Competing paper sale unexpectedly committed';exception when sqlstate '40001' then null;end$$;select 'competing-rejected';commit;`);await waitForLock('paper_editor');await writer.query('commit;');assert.deepEqual(object(await repeated),receipt);assert.match(await blockedPromise,/competing-rejected/);assert.equal(sql('select count(*) from private.paper_sales;'),'1');assert.equal(sql('select count(*) from public.customers;'),'1');assert.equal(sql("select count(*) from public.deals where status='completed' and sale_price_ore=12500029;"),'1');assert.equal(sql("select status from public.stock_items;"),'sold');assert.equal(sql('select count(*) from private.contract_signatures;'),'0');assert.equal(sql('select count(*) from private.deal_payment_entries;'),'0');
// Race a previously reviewed online sale against a paper sale on another car.
const raceStock=id(9),raceVehicle=id(10);
sql(`insert into public.vehicles(id,company_id,registration_number,make,model,model_year)
 values('${raceVehicle}','${C}','PT14001','Synthetic','Car',2025);
 insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)
 values('${raceStock}','${C}','${raceVehicle}',10000000,15000000,'standard');`);
const digitalBuyer=JSON.stringify({name:'Synthetic Online Buyer',kind:'person',email:'online-buyer@example.invalid',
 phone:'0701234567',address:'Synthetic test address',identityNumber:'199001010017'});
const digitalReview=object(await editor.query(auth+`select public.prepare_direct_deal('${C}','${id(11)}',null,
 '${raceStock}',null,'${digitalBuyer}'::jsonb,null,12505000,null,0);commit;`)).review;
const paperReview=object(await writer.query(auth+prepare.replace(S,raceStock).replace(Q,id(12))+'commit;'));
await writer.query(auth+`select public.confirm_paper_sale('${C}','${paperReview.reviewId}','${paperReview.reviewHash}',true,'${id(13)}');`);
const unavailableApproval=editor.query(auth+`do $$begin
 perform public.approve_direct_deal('${C}','${digitalReview.dealId}','${digitalReview.draft.id}',
  '${digitalReview.reviewHash}','Synthetic Seller',true,'${id(14)}');
 raise exception 'Approval unexpectedly committed';
 exception when sqlstate '40001' then null;
end$$;select 'stale-online-approval-rejected';commit;`);
await waitForLock('paper_editor');
await writer.query('commit;');
assert.match(await unavailableApproval,/stale-online-approval-rejected/);
assert.equal(sql(`select status from public.stock_items where id='${raceStock}';`),'sold');
assert.equal(sql(`select count(*) from private.contract_signings where deal_id='${digitalReview.dealId}';`),'0');
console.log(JSON.stringify({result:'PASS',engine:'PostgreSQL17 independent sessions',lockWaitObserved:true,scenarios:['concurrent review nonce replay creates one immutable review without side effects','concurrent confirmation replay creates exactly one customer/deal/paper receipt and sold stock','different review cannot sell the stock a second time','a paper sale that wins the stock lock invalidates a pending direct approval'],productionWrites:0,externalCalls:0}));
}finally{for(const s of sessions)s.close();if(ready)sql(`drop database if exists ${database} with(force);`,'postgres');}
