import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateAdvertisingBillingCsv} from '../src/lib/advertising/billing-csv.ts';
import {billingFixture,id} from './helpers/advertising-billing/fixture.mjs';
test('locked itemized CSV preserves bigint öre, explicit zero, each channel and partial-coverage provenance',()=>{
 const page=billingFixture(),csv=generateAdvertisingBillingCsv(page);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"Blocket";"1";"9007199254740993"'));assert.ok(csv.includes('"Wayke";"1";"0"'));assert.ok(csv.includes('"Totalt";"2";"9007199254740993"'));for(const value of [page.locked.id,page.locked.reviewToken,page.locked.trackingStartedAt,'Del av perioden','Exklusive moms','ingen utfärdad faktura','Granskat historiskt pris'])assert.ok(csv.includes(value),value);
});
test('new current rates and later source changes never replace the locked original in CSV',()=>{
 const page=billingFixture(),original=generateAdvertisingBillingCsv(page);page.rates=[{id:id(8),channel:'blocket',version:2,unitPriceOre:'999',effectiveAt:'2026-10-15T09:00:00Z'}];page.items=[];page.count=0;page.totalOre='0';page.reviewToken='a'.repeat(64);page.hasChangesSinceLock=true;assert.equal(generateAdvertisingBillingCsv(page),original);
});
test('unlocked, tampered canonical source, missing price, unsafe sums and missing coverage acknowledgement reject export',()=>{
 for(const mutate of [p=>p.locked=null,p=>p.locked.totalOre='1',p=>p.locked.items[0].unitPriceOre=null,p=>p.locked.canonicalSnapshot+=' ',p=>p.locked.partialCoverageAcknowledged=false,p=>p.locked.items[1].publicationId=p.locked.items[0].publicationId,p=>p.locked.lockedAt='2026-09-01T00:00:00Z',p=>p.companyId='=DANGEROUS()',p=>p.actorRole='sales']){const p=billingFixture();mutate(p);assert.throws(()=>generateAdvertisingBillingCsv(p));}
});
