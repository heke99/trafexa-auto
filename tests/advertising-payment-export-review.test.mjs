import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSourceLoader } from './helpers/source-loader.mjs';

const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const companyId=id(1),invoiceId=id(2),actor=id(3),invoiceHash='a'.repeat(64),amount='9007199254740993',gross='9223372036854775807';
const digest=text=>createHash('sha256').update(text,'utf8').digest('hex');
function entry(sequence,patch={}) {
 const source={id:id(100+sequence),sequence:String(sequence),companyId,invoiceId,invoiceNumber:'REVIEW-2026-1',invoiceSourceHash:invoiceHash,sellerOrganisationNumber:'5568554884',kind:'receipt',amountOre:amount,paymentIdentifier:`BANK:${sequence}`,bankReference:'Synthetic bank evidence',bookedDate:'2026-10-17',reason:'Synthetic reviewed receipt',createdAt:'2026-10-18T10:00:00Z',createdBy:actor,reversesEntryId:null,replacesEntryId:null,...patch};
 const canonicalSnapshot=JSON.stringify(source);return {...source,canonicalSnapshot,sourceHash:digest(canonicalSnapshot),isReversed:false,isReplaced:false};
}
function fixture({count=51,role='platform_admin',entries:given}={}) {
 const entries=given??Array.from({length:count},(_,i)=>entry(count-i)),received=entries.reduce((sum,e)=>sum+(e.kind==='receipt'?BigInt(e.amountOre):-BigInt(e.amountOre)),0n).toString();
 const due=BigInt(gross),paid=BigInt(received),state={companyId,invoiceId,invoiceSourceHash:invoiceHash,creditSourceHash:null,latestSequence:String(entries.length?Math.max(...entries.map(e=>Number(e.sequence))):0),entryCount:String(entries.length),businessDate:'2026-10-18',receivableOre:gross,receivedOre:received},canonicalReview=JSON.stringify(state);
 const base={companyId,invoiceId,invoiceNumber:'REVIEW-2026-1',invoiceSourceHash:invoiceHash,actorUserId:actor,actorRole:role,currency:'SEK',businessDate:'2026-10-18',grossTotalOre:gross,credit:null,receivableOre:gross,receivedOre:received,outstandingOre:String(due>paid?due-paid:0n),surplusOre:String(paid>due?paid-due:0n),status:paid>due?'overpaid':paid===due?'settled':paid>0n?'partial':'unpaid',latestSequence:state.latestSequence,entryCount:state.entryCount,reviewToken:digest(canonicalReview),canonicalReview,canWrite:role==='platform_admin'};
 function page(beforeSequence=null){const remaining=entries.filter(e=>beforeSequence===null||BigInt(e.sequence)<BigInt(beforeSequence)),rows=remaining.slice(0,50);return {...base,entries:rows,nextBeforeSequence:remaining.length>50?rows.at(-1).sequence:null};}
 return {entries,page,input:{companyId,invoiceId,expectedInvoiceSourceHash:invoiceHash,expectedReviewToken:base.reviewToken}};
}
async function harness({data=fixture(),role='platform_admin',mutateRead,denyAfter=Infinity,changeActorAfter=Infinity}={}) {
 const reads=[],checks=[];
 class PlatformAdminError extends Error{constructor(code){super(code);this.code=code;}}
 class CrmError extends Error{constructor(code){super(code);this.code=code;}}
 const context=async value=>{checks.push(value);if(checks.length>denyAfter)throw role==='platform_admin'?new PlatformAdminError('forbidden'):new CrmError('access_denied');return{userId:checks.length>changeActorAfter?id(99):actor,role,db:{}};};
 const read=async input=>{reads.push(input);const response={ok:true,page:structuredClone(data.page(input.beforeSequence))};return mutateRead?mutateRead(response,reads.length,input):response;};
 const loader=await createSourceLoader({'@/lib/platform-admin/context':{PlatformAdminError,requirePlatformAdminContext:context},'@/lib/contracts/context':{requireContractContext:context},'@/lib/crm/context':{CrmError},'@/lib/advertising/payment-actions':{getPlatformAdvertisingPaymentPageAction:read,listAdvertisingPaymentPageAction:read}});
 const actions=loader.load('@/lib/advertising/payment-export-actions');return{actions,data,reads,checks,generator:loader.load('@/lib/advertising/payment-export').generateAdvertisingPaymentCsv};
}
const exportAction=h=>h.actions.getPlatformAdvertisingPaymentExportAction;

test('independent export review: all pages and final revision are read before returning exact UTF-8 bytes and digest',async()=>{
 const h=await harness(),result=await exportAction(h)(h.data.input);assert.equal(result.ok,true);const file=result.export;
 assert.equal(file.entryCount,'51');assert.equal(file.actorUserId,actor);assert.equal(file.companyId,companyId);assert.equal(file.invoiceId,invoiceId);assert.equal(file.sha256,digest(file.csv));assert.ok(file.csv.startsWith('\uFEFF'));assert.ok(file.csv.endsWith('\r\n'));assert.ok(file.csv.includes(amount));assert.ok(file.csv.includes((BigInt(amount)*51n).toString()));
 for(const e of h.data.entries)assert.ok(file.csv.includes(e.id),e.id);assert.deepEqual(h.reads.map(r=>r.beforeSequence),[null,'2',null]);assert.equal(h.checks.length>=2,true);
});
test('independent export review: stale reviewed source or ledger version never returns an export',async()=>{
 for(const patch of [{expectedInvoiceSourceHash:'b'.repeat(64)},{expectedReviewToken:'b'.repeat(64)}]){const h=await harness(),r=await exportAction(h)({...h.data.input,...patch});assert.equal(r.ok,false);assert.equal('export'in r,false);assert.equal(h.reads.length,1);}
});
test('independent export review: changed revision, actor or company on later pages releases no partial CSV',async()=>{
 for(const patch of [{reviewToken:'b'.repeat(64)},{actorUserId:id(99)},{companyId:id(99)},{invoiceId:id(99)},{actorRole:'finance'}]){
  const h=await harness({mutateRead:(r,n)=>n===2?{...r,page:{...r.page,...patch}}:r}),result=await exportAction(h)(h.data.input);assert.equal(result.ok,false,JSON.stringify(patch));assert.equal('export'in result,false);
 }
});
test('independent export review: missing tail, duplicate entries and repeated page cursors cannot produce an apparently complete journal',async()=>{
 for(const mutate of [r=>({...r,page:{...r.page,entries:[]}}),r=>({...r,page:{...r.page,entries:[entry(2)]}}),r=>({...r,page:{...r.page,nextBeforeSequence:'2'}})]){
  const h=await harness({mutateRead:(r,n)=>n===2?mutate(r):r}),result=await exportAction(h)(h.data.input);assert.equal(result.ok,false);assert.equal('export'in result,false);assert.ok(h.reads.length<=3);
 }
});
test('independent export review: final read detects concurrent ledger change and access revocation or actor replacement releases no CSV',async()=>{
 const changed=await harness({mutateRead:(r,n)=>n===3?{...r,page:{...r.page,reviewToken:'b'.repeat(64)}}:r});assert.equal((await exportAction(changed)(changed.data.input)).ok,false);
 for(const options of [{denyAfter:1},{changeActorAfter:1}]){const h=await harness(options),r=await exportAction(h)(h.data.input);assert.equal(r.ok,false);assert.equal('export'in r,false);}
});
test('independent export review: company reader roles and oversized journal guards are enforced without unbounded pagination',async()=>{
 for(const role of ['sales','viewer']){const h=await harness({role}),r=await h.actions.getAdvertisingPaymentExportAction(h.data.input);assert.equal(r.ok,false);assert.equal(h.reads.length,0);}
 const over=fixture({count:10001});const h=await harness({data:over}),r=await exportAction(h)(h.data.input);assert.equal(r.ok,false);assert.equal('export'in r,false);assert.ok(h.reads.length<=1);
});
test('independent export review: immutable rows preserve opaque cross-company references without mutable flags or fetched foreign details',async()=>{
 const foreign=id(900),data=fixture({count:1,entries:[entry(1,{replacesEntryId:foreign})]}),h=await harness({data}),r=await exportAction(h)(data.input);assert.equal(r.ok,true);assert.ok(r.export.csv.includes(foreign));assert.equal(/isReplaced|isReversed|canonicalSnapshot/.test(r.export.csv),false);assert.equal(h.reads.every(read=>read.companyId===companyId&&read.invoiceId===invoiceId),true);
});
test('independent export review: leading invisible controls and formula markers are neutralized in exported text',async()=>{
 for(const prefix of ['=','+','-','@','\u200b=','\u2060@','\u034f+','\u061c-','\u202e=']){
  const text=prefix+'SUM("A1")',data=fixture({count:1,entries:[entry(1,{reason:text,bankReference:text})]}),h=await harness({data}),r=await exportAction(h)(data.input);assert.equal(r.ok,true,JSON.stringify(prefix));assert.ok(r.export.csv.includes(`"'${text.replace(/"/g,'""')}"`),JSON.stringify(prefix));assert.equal(data.entries[0].reason,text);
 }
});

test('independent export review: a finance reader can export its own private journal and injected browser authority is rejected',async()=>{
 const data=fixture({count:1,role:'finance'}),h=await harness({data,role:'finance'}),r=await h.actions.getAdvertisingPaymentExportAction(data.input);assert.equal(r.ok,true);assert.equal(r.export.actorRole,'finance');
 const denied=await harness(),result=await exportAction(denied)({...denied.data.input,actorUserId:id(99)});assert.equal(result.ok,false);assert.equal(denied.reads.length,0);
});
test('independent export review: oversized quoted text returns a bounded failure instead of partial or transport-oversized CSV',async()=>{
 const entries=Array.from({length:2500},(_,i)=>entry(2500-i,{reason:'"'.repeat(490)})),data=fixture({entries}),h=await harness({data}),r=await exportAction(h)(data.input);assert.equal(r.ok,false);assert.equal('export'in r,false);assert.ok(JSON.stringify(r).length<1500);
});

test('independent export review: JSON escaping has its own response limit even when the complete CSV fits its byte cap',async()=>{
 const entries=Array.from({length:1900},(_,i)=>entry(1900-i,{reason:'\\'.repeat(490),bankReference:'\\'.repeat(190)})),data=fixture({entries}),h=await harness({data}),csv=h.generator({page:data.page(),entries});
 assert.ok(Buffer.byteLength(csv,'utf8')<=2*1024*1024);
 const projected={ok:true,export:{companyId,invoiceId,actorUserId:actor,actorRole:'platform_admin',invoiceSourceHash:invoiceHash,reviewToken:data.input.expectedReviewToken,entryCount:'1900',fileName:`trafexa-annonsavstamning-${invoiceId}.csv`,contentType:'text/csv;charset=utf-8',csv,sha256:digest(csv)}};
 assert.ok(Buffer.byteLength(JSON.stringify(projected),'utf8')>3*1024*1024,`CSV ${Buffer.byteLength(csv,'utf8')} JSON ${Buffer.byteLength(JSON.stringify(projected),'utf8')}`);
 const result=await exportAction(h)(data.input);assert.equal(result.ok,false);assert.equal('export'in result,false);assert.equal(h.reads.length,39);
});

test('independent export review: a cross-invoice replacement flag change does not fabricate a new immutable source-invoice revision',async()=>{
 const original=entry(1);original.isReversed=true;
 const reversal=entry(2,{kind:'reversal',reversesEntryId:original.id,paymentIdentifier:original.paymentIdentifier,bankReference:original.bankReference,bookedDate:original.bookedDate});
 const data=fixture({entries:[reversal,original]}),h=await harness({data,mutateRead:(result,n)=>n===2?{...result,page:{...result.page,entries:result.page.entries.map(e=>e.id===original.id?{...e,isReplaced:true}:e)}}:result}),r=await exportAction(h)(data.input);
 assert.equal(r.ok,true);assert.equal(r.export.csv,h.generator({page:data.page(),entries:data.entries}));assert.equal(h.reads.length,2);assert.equal(r.export.csv.includes('isReplaced'),false);
});
