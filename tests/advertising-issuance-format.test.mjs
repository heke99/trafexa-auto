import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatIssuedInvoiceNumber,invoiceDateInStockholm,invoiceDueDate} from '../src/lib/advertising/issuance-format.ts';

test('invoice numbers include an explicit prefix and year with stable sequence formatting',()=>{
 assert.equal(formatIssuedInvoiceNumber('TFX',2026,1),'TFX-2026-000001');
 assert.equal(formatIssuedInvoiceNumber('TFX',2026,999999999),'TFX-2026-999999999');
 assert.notEqual(formatIssuedInvoiceNumber('TFX',2026,1),formatIssuedInvoiceNumber('TFX',2027,1));
 for(const values of [['tfx',2026,1],['T-F',2026,1],['T',2026,1],['TFX',2026,0],['TFX',2026,1.1],['TFX',2026,1000000000],['TFX',2101,1]])assert.throws(()=>formatIssuedInvoiceNumber(...values));
});
test('invoice local dates follow Stockholm midnight, year boundary and daylight saving transitions',()=>{
 assert.equal(invoiceDateInStockholm('2026-12-31T23:00:00Z'),'2027-01-01');
 assert.equal(invoiceDateInStockholm('2026-06-30T22:00:00Z'),'2026-07-01');
 assert.equal(invoiceDateInStockholm('2026-03-28T23:30:00Z'),'2026-03-29');
 assert.equal(invoiceDateInStockholm('2026-10-24T22:30:00Z'),'2026-10-25');
 for(const value of ['not-a-date','2026-02-30T00:00:00Z','2026-10-15T24:00:00Z','2026-10-15T10:00:00'])assert.throws(()=>invoiceDateInStockholm(value));
});
test('due dates add frozen calendar days across leap years, year ends and DST without shifting by hours',()=>{
 for(const [date,days,expected]of [['2026-10-15',30,'2026-11-14'],['2028-02-28',1,'2028-02-29'],['2028-02-28',2,'2028-03-01'],['2026-12-31',30,'2027-01-30'],['2026-03-28',2,'2026-03-30'],['2026-10-24',2,'2026-10-26']])assert.equal(invoiceDueDate(date,days),expected);
 for(const [date,days]of [['2026-02-29',30],['2026-04-31',30],['2026-10-15',0],['2026-10-15',91],['2026-10-15',1.5]])assert.throws(()=>invoiceDueDate(date,days));
});
