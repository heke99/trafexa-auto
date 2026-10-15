import assert from 'node:assert/strict';
import {bootstrap,sql,saveFixture,repository} from './native-helpers.mjs';
import {readFile,readdir,writeFile,mkdtemp,rm}from'node:fs/promises';import{spawnSync}from'node:child_process';
const id=n=>`ee550000-0000-4000-8000-${String(n).padStart(12,'0')}`,admin=id(1),owner=id(2);
const lit=v=>v===null?'null':typeof v==='boolean'||typeof v==='number'?String(v):`'${(typeof v==='string'?v:JSON.stringify(v)).replaceAll("'","''")}'`;
function bind(q,args){return q.replace(/\$(\d+)/g,(_,n)=>lit(args[Number(n)-1]));}
function as(actor,body,role='authenticated'){return `begin;set local role ${role};set local request.jwt.claim.sub=${lit(actor??'')};${body};commit;`;}
const call=(q,args=[],actor=admin,role='authenticated')=>JSON.parse(sql(as(actor,bind(q,args),role)));
await bootstrap();
assert.match(sql("select pg_get_constraintdef(oid) from pg_constraint where conrelid='private.advertising_invoice_series'::regclass and pg_get_constraintdef(oid) like '%configuration = jsonb_build_object%'"), /sellerRegisteredSeat/);
assert.equal(sql("select to_regclass('private.company_store_profile_versions') is not null"),'t');
assert.match(sql('select version()'),/PostgreSQL 17\.6/);console.log('Native PostgreSQL 17.6 full integrated migration chain loaded');
sql(`insert into auth.users(id,email,email_confirmed_at)values('${admin}','admin-ee55@example.invalid',now()),('${owner}','owner-ee55@example.invalid',now());insert into private.account_approvals(user_id,status,updated_by)values('${admin}','approved','${admin}'),('${owner}','approved','${owner}');insert into private.platform_admins(user_id,created_by)values('${admin}','${admin}');`);
const buyer={invoiceEmail:'buyer@example.invalid',addressLine1:'Buyer Street 1',addressLine2:null,postalCode:'11122',city:'Stockholm',countryCode:'SE',reference:null};
const seller={...buyer,legalName:'Trafexa Nordic AB',organisationNumber:'5568554884',invoiceEmail:'info@example.invalid',addressLine1:'Seller Street 1'};
call('select public.save_advertising_seller_profile($1,0,$2)',[seller,id(10)]);
const companies=[];
for(let k=1;k<=11;k++){
 const C=id(100+k),V=id(200+k),S=id(300+k),L=id(400+k),CON=id(500+k),J=id(600+k);companies.push(C);
 sql(`insert into public.companies(id,name,organisation_number,created_by)values('${C}','Native Credit ${k}','${5564400000+k}','${owner}');insert into public.memberships(company_id,user_id,role)values('${C}','${owner}','owner');insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('${V}','${C}','ISS44${k}','Make','Model',2020);insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('${S}','${C}','${V}',100,200,'standard');insert into private.advertising_listings(id,company_id,stock_id,status,created_by)values('${L}','${C}','${S}','draft','${owner}');insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by)values('${C}','${L}',1,'{}','${owner}');insert into private.advertising_dispatchers(id,channel)values('ee55_${k}','blocket');insert into private.advertising_connections(id,company_id,channel,account_reference,status,dispatcher_id,created_by)values('${CON}','${C}','blocket','fixture','verified','ee55_${k}','${owner}');insert into private.advertising_jobs(id,company_id,stock_id,listing_id,listing_version,channel,connection_id,connection_version,account_reference,dispatcher_id,created_by,snapshot,status)values('${J}','${C}','${S}','${L}',1,'blocket','${CON}',1,'fixture','ee55_${k}','${owner}','{}','submitted');`);
 if(k===9){const V2=id(1209),S2=id(1309),L2=id(1409),J2=id(1609);sql(`insert into public.vehicles(id,company_id,registration_number,make,model,model_year)values('${V2}','${C}','ISS449B','Make','Model',2020);insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values('${S2}','${C}','${V2}',100,200,'standard');insert into private.advertising_listings(id,company_id,stock_id,status,created_by)values('${L2}','${C}','${S2}','draft','${owner}');insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by)values('${C}','${L2}',1,'{}','${owner}');insert into private.advertising_jobs(id,company_id,stock_id,listing_id,listing_version,channel,connection_id,connection_version,account_reference,dispatcher_id,created_by,snapshot,status)values('${J2}','${C}','${S2}','${L2}',1,'blocket','${CON}',1,'fixture','ee55_${k}','${owner}','{}','submitted');`);}
 call('select public.save_advertising_channel_rate($1,$2,$3,0,$4)',[C,'blocket',k===9?'2':k===10?'7378697629483820645':'10000',id(700+k)]);call("select public.save_advertising_job($1,1,null,'published',$2,null,null)",[J,'ee55-ad-'+k],null,'service_role');if(k===9)call("select public.save_advertising_job($1,1,null,'published',$2,null,null)",[id(1609),'ee55-ad-9B'],null,'service_role');
}
sql("alter table private.advertising_usage_tracking disable trigger immutable_advertising_tracking;update private.advertising_usage_tracking set started_at='2025-01-01T00:00:00Z';alter table private.advertising_usage_tracking enable trigger immutable_advertising_tracking;alter table private.advertising_publications disable trigger immutable_advertising_publication;update private.advertising_publications set first_published_at='2026-09-15T22:30:00Z';alter table private.advertising_publications enable trigger immutable_advertising_publication;");
const settings={vatTreatment:'se_standard_25',sellerVatRegistered:true,sellerVatNumber:'SE556855488401',paymentDays:30,paymentMethod:'bankgiro',paymentAccount:'9912346',reason:'Synthetic native issuance review'};
const assessments=[];
for(const[k,C]of companies.entries()){
 const b=call('select public.get_platform_advertising_billing($1,$2)',[C,'2026-09']);call('select public.lock_advertising_billing_period($1,$2,$3,true,false,$4)',[C,'2026-09',b.reviewToken,id(800+k)]);
 call('select public.save_platform_advertising_buyer_profile($1,$2,0,$3)',[C,buyer,id(820+k)]);const inv=call('select public.get_platform_advertising_invoice_page($1,$2,null)',[C,'2026-09']);
 const draft=call('select public.create_advertising_invoice_draft($1,$2,1,1,$3,true,$4)',[C,'2026-09',inv.reviewToken,id(840+k)]).draft;
 call('select public.save_advertising_financial_settings($1,$2,0,true,$3)',[C,settings,id(860+k)]);const fin=call(`select public.${k===0?'get_platform_advertising_financial_page':'get_platform_advertising_financial_page_v2'}($1,$2,$3,null)`,[C,'2026-09',draft.id]);
 assessments.push(call(`select public.${k===0?'create_advertising_financial_assessment':'create_advertising_financial_assessment_v2'}($1,$2,$3,$4,1,$5,$6,true,$7)`,[C,'2026-09',draft.id,draft.sourceHash,fin.settings.reviewToken,fin.reviewToken,id(880+k)]).assessment);
}
const page=k=>call('select public.get_platform_advertising_issuance_page($1,$2,$3)',[companies[k],'2026-09',assessments[k].id]);
const {parseAdvertisingIssuancePage}=await import(new URL('src/lib/advertising/issuance-validation.ts',repository));let p=page(0);assert.equal(parseAdvertisingIssuancePage(p,companies[0],'2026-09',admin,'platform_admin').canIssue,false);assert.equal(p.canIssue,false);assert.ok(p.blockers.includes('series.unconfigured'));
call('select public.configure_advertising_invoice_series($1,$2,$3,$4,$5,$6,$7,$8,true,$9)',[companies[0],assessments[0].id,assessments[0].sourceHash,p.currentYear,'NATIVE','42','Stockholm','Synthetic isolated native series',id(900)]);
const issueQ=(k,p,req,ack=true)=>bind('select public.issue_advertising_invoice($1,$2,$3,$4,$5,$6,$7,true,$8,$9)',[companies[k],'2026-09',assessments[k].id,assessments[k].sourceHash,p.series.id,p.series.reviewToken,p.preview.reviewToken,ack,req]);
const issue=(k,p,req,ack=true)=>JSON.parse(sql(as(admin,issueQ(k,p,req,ack))));
const counter=()=>Number(sql('select next_number from private.advertising_invoice_counters'));
const invoices=()=>Number(sql('select count(*) from private.advertising_issued_invoices'));


const {parseAdvertisingIssuedInvoice}=await import(new URL('src/lib/advertising/issuance-validation.ts',repository));
const {generateAdvertisingIssuedInvoicePdf}=await import(new URL('src/lib/documents/advertising-issued-invoice-pdf.ts',repository));
const originals=[],originalBytes=[],originalQueries=[];
for(let k=0;k<10;k++){const originalQuery=issueQ(k,page(k),id(1000+k));originalQueries.push(originalQuery);const invoice=JSON.parse(sql(as(admin,originalQuery))).invoice;parseAdvertisingIssuedInvoice(invoice,companies[k],invoice.id);originals.push(invoice);originalBytes.push(await generateAdvertisingIssuedInvoicePdf(invoice));}
assert.equal(originals[0].snapshot.assessment.snapshot.calculationVersion,1);assert.equal(originals[8].snapshot.assessment.snapshot.calculationVersion,2);assert.deepEqual(originals[8].snapshot.lines.map(l=>l.vatOre),['1','0']);assert.equal(originals[9].snapshot.grossTotalOre,'9223372036854775806');
assert.equal(counter(),52);

const cp=call('select public.get_platform_advertising_credit_page($1,$2)',[companies[1],originals[1].id]);
const credit=call('select public.issue_advertising_credit_invoice($1,$2,$3,$4,$5,$6,$7,true,$8)',[companies[1],originals[1].id,originals[1].sourceHash,cp.series.id,cp.series.reviewToken,cp.preview.reviewToken,'Synthetic full cancellation',id(1700)]).credit;
const {generateAdvertisingCreditInvoicePdf}=await import(new URL('src/lib/documents/advertising-credit-invoice-pdf.ts',repository));
const creditBytes=await generateAdvertisingCreditInvoicePdf(credit);
export {id,admin,owner,lit,bind,as,call,companies,originals,originalBytes,credit,creditBytes};
await writeFile('/tmp/trafexa-invoice-email-native-fixtures.json',JSON.stringify({admin,owner,companies,originals,originalBytes:originalBytes.map(b=>Buffer.from(b).toString('base64')),credit,creditBytes:Buffer.from(creditBytes).toString('base64')}));
saveFixture();
