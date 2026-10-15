import assert from 'node:assert/strict';
import {readFile,readdir}from'node:fs/promises';
import {repository,sql}from'./native-helpers.mjs';
const id=n=>`ee550000-0000-4000-8000-${String(n).padStart(12,'0')}`,admin=id(1),company=id(105);
const lit=v=>`'${(typeof v==='string'?v:JSON.stringify(v)).replaceAll("'","''")}'`;
const call=body=>JSON.parse(sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${admin}';${body};commit;`));
assert.match(sql('select version()'),/PostgreSQL 17\.6/);
// Run only after native-review.mjs in its task-owned synthetic container.
const originalId=sql(`select id from private.advertising_issued_invoices where company_id='${company}'`);
const original=call(`select public.get_platform_advertising_issued_invoice('${company}','${originalId}')`).invoice;

const existingCreditId=sql('select id from private.advertising_credit_invoices order by created_at limit 1');
const existingInvoiceNumber=sql('select invoice_number from private.advertising_issued_invoices order by sequence limit 1');
assert.throws(()=>sql(`insert into private.advertising_credit_invoices(id,company_id,original_invoice_id,series_id,sequence,credit_number,credit_date,snapshot,canonical_snapshot,source_hash,review_token,created_at,created_by) select gen_random_uuid(),'${company}','${original.id}',series_id,900000000,${lit(existingInvoiceNumber)},credit_date,snapshot,canonical_snapshot,source_hash,review_token,created_at,created_by from private.advertising_credit_invoices where id='${existingCreditId}'`),/advertising_document_numbers_document_number_key/);
console.log('PASS privileged cross-table collision fixture is rejected specifically by shared legal document number registry');
const year=Number(sql("select extract(year from clock_timestamp() at time zone 'Europe/Stockholm')::integer"))+1;
const frozen=`TIMESTAMPTZ '${year}-10-15T10:00:00Z'`,directory=new URL('supabase/migrations/',repository),names=(await readdir(directory)).filter(n=>/_advertising_credit_0[345]_/.test(n)).sort(),sources=[];
assert.equal(names.length,3);
try{
 for(const name of names){const source=await readFile(new URL(name,directory),'utf8');sources.push(source);sql(source.replaceAll('create function ','create or replace function ').replaceAll('clock_timestamp()',frozen));}
 let page=call(`select public.get_platform_advertising_credit_page('${company}','${original.id}')`);
 assert.equal(page.currentYear,year);assert.equal(page.series,null);assert.equal(page.canConfigureSeries,true);assert.equal(page.canCredit,false);assert.ok(page.blockers.includes('series.unconfigured'));
 const config=call(`select public.configure_advertising_credit_series('${company}','${original.id}','${original.sourceHash}',${year},'NEXTCAL','1','Stockholm','Explicit synthetic next calendar year',true,'${id(1200)}')`);
 assert.equal(config.series.year,year);assert.equal(config.series.nextNumber,'1');
 page=call(`select public.get_platform_advertising_credit_page('${company}','${original.id}')`);assert.equal(page.canCredit,true);assert.equal(page.preview.creditDate,`${year}-10-15`);
 const credit=call(`select public.issue_advertising_credit_invoice('${company}','${original.id}','${original.sourceHash}','${page.series.id}','${page.series.reviewToken}','${page.preview.reviewToken}','Prior-year full credit',true,'${id(1201)}')`).credit;
 const{parseAdvertisingCreditInvoice}=await import(new URL('src/lib/advertising/credit-validation.ts',repository));
 const{generateAdvertisingCreditInvoicePdf}=await import(new URL('src/lib/documents/advertising-credit-invoice-pdf.ts',repository));
 parseAdvertisingCreditInvoice(credit,company,credit.id);assert.deepEqual(credit.snapshot.originalInvoice,original);for(const key of ['netTotalOre','vatTotalOre','grossTotalOre'])assert.equal(credit.snapshot[key],original.snapshot[key]);assert.equal(credit.creditNumber,`NEXTCAL-${year}-000001`);assert.equal(credit.creditDate,`${year}-10-15`);const bytes=await generateAdvertisingCreditInvoicePdf(credit);assert.ok(bytes.length>0);assert.deepEqual(await generateAdvertisingCreditInvoicePdf(credit),bytes);
 assert.equal(sql(`select next_number from private.advertising_invoice_counters where series_id='${page.series.id}'`),'2');
 const otherCompany=id(106),otherOriginal=sql(`select id from private.advertising_issued_invoices where company_id='${otherCompany}'`),beforeCount=sql('select count(*) from private.advertising_credit_invoices');
 sql(`update private.advertising_invoice_counters set next_number=1000000000 where series_id='${page.series.id}'`);
 const exhausted=call(`select public.get_platform_advertising_credit_page('${otherCompany}','${otherOriginal}')`);assert.equal(exhausted.canCredit,false);assert.equal(exhausted.preview,null);assert.ok(exhausted.blockers.includes('series.exhausted'));
 assert.throws(()=>call(`select public.issue_advertising_credit_invoice('${otherCompany}','${otherOriginal}','${exhausted.originalInvoice.sourceHash}','${exhausted.series.id}','${exhausted.series.reviewToken}','${'f'.repeat(64)}','No exhausted credit',true,'${id(1202)}')`),/prerequisites incomplete/);
 assert.equal(sql('select count(*) from private.advertising_credit_invoices'),beforeCount);assert.equal(sql(`select next_number from private.advertising_invoice_counters where series_id='${page.series.id}'`),'1000000000');
 console.log('PASS real exhausted counter blocks preview and direct credit RPC without new document or number');
 console.log(JSON.stringify({status:'PASS' ,engine:sql('select version()').split(' on ')[0],calendarGroups:1,clockFixture:'Only isolated credit SQL clock_timestamp expressions frozen; production SQL files untouched',originalYear:original.snapshot.series.year,creditYear:year,proofs:['authentic prior-year original retained','current-year series initially missing and no implicit default','explicit current-year common-series configuration','credit consumes current-year sequence while preserving exact prior-year original','production credit DTO parser and deterministic actual PDF']}));
}finally{for(const source of sources)sql(source.replaceAll('create function ','create or replace function '));}
