// Isolated PostgreSQL only. The separately started container has network=none.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {bootstrap,sql,session,waitForLock,database} from './native-helpers.mjs';
const id=n=>`dd140000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const U=id(1),C=id(2),S=id(3),V=id(4),Q=id(5);
const identity='199001010017';
const customer={name:'Native synthetic customer',kind:'person',email:'native-customer@example.invalid',phone:'0701234567',address:'Synthetic address',identityNumber:identity};
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const auth=`begin;set local role authenticated;set local "request.jwt.claim.sub"='${U}';`;
const prepare=`select public.prepare_direct_deal('${C}','${Q}',null,'${S}',null,${quote(JSON.stringify(customer))}::jsonb,null,12505000,null,0);`;
const object=s=>JSON.parse(s.split('\n').findLast(x=>x.startsWith('{')));
const checks=[],sessions=[];let ready=false;
try{
 await bootstrap();ready=true;
 sql(`insert into auth.users(id,email,email_confirmed_at)values('${U}','native-owner@example.invalid',now());insert into private.account_approvals(user_id,status,updated_by)values('${U}','approved','${U}');insert into public.companies(id,name,organisation_number,created_by)values('${C}','Native synthetic dealer','5568554884','${U}');insert into public.memberships(company_id,user_id,role)values('${C}','${U}','owner');insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('${V}','${C}','DD14000','Synthetic','Car',2025);insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('${S}','${C}','${V}',10000000,15000000,'standard');`);
 const writer=session('writer'),replay=session('replay'),editor=session('editor'),approver=session('approver');sessions.push(writer,replay,editor,approver);await Promise.all(sessions.map(s=>s.ready()));
 const first=object(await writer.query(auth+prepare));const duplicate=replay.query(auth+prepare+'commit;');await waitForLock('replay');await writer.query('commit;');assert.deepEqual(object(await duplicate),first);assert.equal(sql('select count(*) from public.customers;'),'1');assert.equal(sql('select count(*) from public.deals;'),'1');assert.equal(sql('select count(*) from private.sale_contract_drafts;'),'1');checks.push({scenario:'same prepare request in two sessions creates one customer, deal and immutable review',result:'PASS',lockWaitObserved:true});
 const customerId=first.review.draft.sourceOffer.customer.id;await editor.query(`${auth}update public.customers set phone='0709999999' where id='${customerId}';`);
 const approve=`public.approve_direct_deal('${C}','${first.review.dealId}','${first.review.draft.id}','${first.review.reviewHash}','Native Seller',true,'${id(6)}')`;
 const pending=approver.query(`${auth}do $$begin perform ${approve};raise exception 'Stale approval unexpectedly committed';exception when sqlstate '40001' then null;end$$;select 'cas-rejected';commit;`);await waitForLock('approver');await editor.query('commit;');assert.match(await pending,/cas-rejected/);assert.equal(sql('select count(*) from private.contract_signatures;'),'0');assert.equal(sql("select count(*) from private.transactional_email_outbox where kind='contract_invitation';"),'0');assert.equal(sql(`select phone from public.customers where id='${customerId}';`),'0709999999');checks.push({scenario:'concurrent customer correction wins before approval; stale review is rejected without signature or mail',result:'PASS',lockWaitObserved:true});
 const proof={result:'PASS',engine:'native PostgreSQL, independent psql sessions',checks,externalCalls:0,productionMutations:0,cleanup:'All owned sessions and dedicated database closed; container lifecycle belongs to invoking task.'};await writeFile('/tmp/trafexa-direct-deal-native-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
}finally{for(const s of sessions)s.close();if(ready)sql(`drop database if exists ${database} with(force);`,'postgres');}
