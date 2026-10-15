import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {ISSUED_INVOICE_FONT_RANGES,isIssuedInvoiceTextSupported} from '../src/lib/advertising/issuance-font-coverage.ts';

test('renderer v1 text admission matches the actual packaged invoice font exactly',async()=>{
 const font=fontkit.create(await readFile(new URL('../assets/fonts/DejaVuSans.ttf',import.meta.url))),actual=[...font.characterSet].sort((a,b)=>a-b),admitted=[];
 for(const[first,last]of ISSUED_INVOICE_FONT_RANGES)for(let point=first;point<=last;point++)admitted.push(point);
 assert.deepEqual(admitted,actual);assert.equal(isIssuedInvoiceTextSupported('Åberg & Söner – Örebro'),true);assert.equal(isIssuedInvoiceTextSupported('字'),false);
 assert.equal(isIssuedInvoiceTextSupported('Invoice\u{10ffff}'),false);
});
test('direct database issuance uses exactly the same font ranges as parser and PDF admission',async()=>{
 const directory=new URL('../supabase/migrations/',import.meta.url),names=await readdir(directory);let sql='';
 for(const name of names.filter(name=>name.endsWith('.sql'))){const content=await readFile(new URL(name,directory),'utf8');if(content.includes('create function private.advertising_issued_text_supported('))sql+=content;}
 const match=sql.match(/'\{((?:\[\d+,\d+\)(?:,)?)*)\}'::int4multirange/);assert.ok(match,'SQL text admission helper must exist');
 const ranges=[...match[1].matchAll(/\[(\d+),(\d+)\)/g)].map(([,first,last])=>[Number(first),Number(last)-1]);assert.deepEqual(ranges,ISSUED_INVOICE_FONT_RANGES);
});
