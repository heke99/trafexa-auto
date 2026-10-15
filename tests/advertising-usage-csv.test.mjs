import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateAdvertisingUsageCsv} from '../src/lib/advertising/usage-csv.ts';
const zero={queued:0,dispatching:0,outcomeUnknown:0,submitted:0,published:0,rejected:0,retryable:0,newPublications:0};
function page(){return{companyId:'ac340000-0000-4000-8000-000000000001',month:'2026-10',timeZone:'Europe/Stockholm',periodStart:'2026-09-30T22:00:00Z',periodEnd:'2026-10-31T23:00:00Z',trackingStartedAt:'2026-10-14T17:00:00Z',legacyPublishedJobs:2,totals:{...zero,drafts:2,ready:3,newPublications:3,published:8,submitted:1},channels:[{...zero,channel:'blocket',newPublications:2,published:5,submitted:1},{...zero,channel:'wayke',newPublications:1,published:3}],billing:{status:'quantity_only',unitPriceOre:null,totalOre:null,unpricedPublications:3}};}
test('CSV exports only unique monthly channel quantities; missing agreed prices stay blank and all-time states separate',()=>{
 const p=page(),csv=generateAdvertisingUsageCsv(p);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"Blocket";"2";"";""'));assert.ok(csv.includes('"Wayke";"1";"";""'));assert.ok(csv.includes('"Totalt";"3";"";""'));assert.ok(csv.includes('Priser ingår inte'));assert.ok(csv.includes('hela historiken'));assert.ok(csv.includes('ingen utfärdad faktura'));assert.ok(csv.includes(p.trackingStartedAt));
});
test('Stockholm DST boundaries are verified for spring and autumn with no silent UTC month shift',()=>{
 const p=page();p.month='2026-03';p.periodStart='2026-02-28T23:00:00Z';p.periodEnd='2026-03-31T22:00:00Z';assert.ok(generateAdvertisingUsageCsv(p).includes('2026-03'));
 for(const change of [v=>v.periodStart='2026-03-01T00:00:00Z',v=>v.periodEnd='2026-04-01T00:00:00Z',v=>v.periodStart='2026-02-28T23:00:00.001Z']){const v=structuredClone(p);change(v);assert.throws(()=>generateAdvertisingUsageCsv(v));}
});
test('forged quantities/channel totals, unknown enum values and fabricated prices are rejected before export',()=>{
 for(const mutate of [v=>v.totals.newPublications=4,v=>v.channels[1].channel='blocket',v=>v.billing.unpricedPublications=4,v=>v.billing.unitPriceOre='0',v=>v.billing.totalOre=0,v=>v.channels[0].submitted=-1,v=>v.month='2026-13',v=>v.companyId='=DANGEROUS()',v=>v.channels[0].newPublications=Number.MAX_SAFE_INTEGER+1]){const v=page();mutate(v);assert.throws(()=>generateAdvertisingUsageCsv(v));}
});
