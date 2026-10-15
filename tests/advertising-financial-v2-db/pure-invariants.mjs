import assert from 'node:assert/strict';
// A direct runner is appended below; verifyAllocation also supports another adapter.
// The checks below use integer quarter-remainders rather than production formulas.
export function verifyAllocation(allocate) {
 let checked=0;
 const key=i=>`aa110000-0000-4000-8000-${String(i).padStart(12,'0')}`;
 const verify=(values,reverse=false)=>{
  const rows=values.map((n,i)=>({publicationId:key(i+1),netOre:String(n)}));
  const result=allocate(reverse?[...rows].reverse():rows);
  const byId=new Map(result.map(row=>[row.publicationId,BigInt(row.vatOre)]));
  assert.equal(byId.size,rows.length);
  const net=values.reduce((s,n)=>s+BigInt(n),0n),vat=[...byId.values()].reduce((s,n)=>s+n,0n);
  // Nearest quarter aggregate: half-up implies error in [-1, 2] quarter-öre.
  assert.ok(vat*4n-net>=-1n&&vat*4n-net<=2n);
  const winners=[],losers=[];
  for(const row of rows){const n=BigInt(row.netOre),v=byId.get(row.publicationId),floor=n/4n;assert.ok(v===floor||v===floor+1n);if(n===0n)assert.equal(v,0n);(v===floor+1n?winners:losers).push({id:row.publicationId,remainder:n%4n});}
  // No residual goes to a lower remainder or a later tied UUID.
  for(const winner of winners)for(const loser of losers)assert.ok(winner.remainder>loser.remainder||winner.remainder===loser.remainder&&winner.id<loser.id);
  checked++;return byId;
 };
 const walk=(values,n)=>{if(values.length===n){const a=verify(values),b=verify(values,true);assert.deepEqual([...a.entries()].sort(),[...b.entries()].sort());return;}for(let next=0;next<8;next++)walk([...values,next],n);};
 for(let n=0;n<=5;n++)walk([],n);
 for(const values of [[2,2],[14950,14950],[0,0,2],[1,1,1,1],[3,3,3],[9007199254740993n,0n],[7378697629483820645n,0n]])verify(values);
 const full=Array.from({length:2000},()=>1);const sorted=verify(full),reversed=verify(full,true);assert.deepEqual([...sorted.entries()].sort(),[...reversed.entries()].sort());assert.equal(sorted.get(key(500)),1n);assert.equal(sorted.get(key(501)),0n);
 console.log(JSON.stringify({status:'PASS',independentAllocationCases:checked,checks:['quarter-error aggregate bound','floor-or-ceiling each row','largest remainder priority','canonical UUID tie priority','zero excluded','permutation stable','2000-row tie boundary','above JS-safe integer']}));
}

if(process.argv[1]&&import.meta.url===(await import('node:url')).pathToFileURL(process.argv[1]).href){
 const {repository}=await import('./native-upgrade-helpers.mjs');
 const {allocateAdvertisingVatV2}=await import(new URL('src/lib/advertising/vat-allocation.ts',repository));
 verifyAllocation(rows=>allocateAdvertisingVatV2(rows).map((vatOre,i)=>({publicationId:rows[i].publicationId,vatOre})));
 const id='aa110000-0000-4000-8000-000000000001';
 for(const rows of [[{publicationId:id,netOre:'-1'}],[{publicationId:id,netOre:'01'}],[{publicationId:'invalid',netOre:'1'}],[{publicationId:id,netOre:'1'},{publicationId:id.toUpperCase(),netOre:'2'}],[{publicationId:id,netOre:'7378697629483820646'}],Array.from({length:2001},(_,i)=>({publicationId:`aa110000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,netOre:'0'}))])assert.throws(()=>allocateAdvertisingVatV2(rows));
 console.log('PASS invalid net/identity, case-duplicate, gross overflow, count overflow rejected');
}
