import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
process.env.TRAFEXA_DIRECT_DEAL_TEST_CONTAINER='trafexa-trade-settlement-review';
const h=await import('../direct-deal-db/native-helpers.mjs');
await h.bootstrap();
const raw=(await readFile(new URL('../../supabase/tests/trade_in_acquisition.sql',import.meta.url),'utf8')).split('-- BEGIN TRADE IN ACQUISITION FIXTURES')[1].split('-- END TRADE IN ACQUISITION FIXTURES')[0];
const id=n=>`fc130000-0000-4000-8000-${String(n).padStart(12,'0')}`,C=id(101),D=id(501),U=id(1);
h.sql('begin;'+raw+'commit;');
const s=JSON.parse(h.sql(`select json_build_object('id',id,'hash',document_hash)from private.contract_signings where deal_id='${D}'`));
h.sql(`insert into storage.objects(bucket_id,name,metadata)values('native-contract-originals','${C}/native-contracts/${s.id}/v1/signed-${'b'.repeat(64)}.pdf','{"size":20,"mimetype":"application/pdf"}'),('native-contract-originals','${C}/native-contracts/${s.id}/v1/evidence-${'c'.repeat(64)}.json','{"size":40,"mimetype":"application/json"}');begin;set local role service_role;select public.register_contract_signing_archive('${C}','${s.id}','${U}','${id(8000)}','${s.hash}',3,'${'b'.repeat(64)}',20,'${'c'.repeat(64)}',40,'trafexa-native-v1');commit;`);
const auth=`set local role authenticated;set local request.jwt.claim.sub='${U}';`;
const payload=(n,version,op,patch={})=>JSON.stringify({companyId:C,dealId:D,requestId:id(n),expectedVersion:version,operation:op,reason:'Synthetic reviewed manual bank evidence',acknowledged:true,expectedDocumentHash:s.hash,...patch});
const mutation=p=>`select public.mutate_deal_fulfilment('${C}','${D}','${p}');`;
let first=h.session('settlement_first'),second=h.session('settlement_second');
try{await Promise.all([first.ready(),second.ready()]);await first.query(`begin;${auth}`);await first.query(mutation(payload(8001,0,'payment',{category:'customer_payout',amountOre:'100',bankReference:'CONCURRENT-1',bookedOn:'2026-01-01'})));const queued=second.query(`begin;${auth}${mutation(payload(8002,0,'payment',{category:'customer_payout',amountOre:'100',bankReference:'CONCURRENT-2',bookedOn:'2026-01-01'}))}`);await h.waitForLock('settlement_second');await first.query('commit;');await assert.rejects(queued,/conflict/i);assert.equal(h.sql('select count(*)from private.deal_payment_entries'),'1');}finally{first.close();second.close();}
const sum=18000029n;
h.sql(`begin;${auth}${mutation(payload(8003,1,'payment',{category:'customer_payout',amountOre:String(sum-100n),bankReference:'FINAL-PAYOUT',bookedOn:'2026-01-01'}))}select public.reserve_vehicle('${C}','${D}',48);do $$declare p jsonb;begin p:=public.get_trade_in_acquisition('${C}','${D}');perform public.record_trade_in_acquisition('${C}','${D}',p#>>'{source,sourceSha256}','2020-01-01','TEST PURCHASE',0,'2020-01-01','TEST ZERO DEBT','petrol','manual',40000000,true,true,true,true,'2026-10-15','${id(8004)}');end$$;commit;`);
first=h.session('deliver_first');second=h.session('deliver_second');
try{await Promise.all([first.ready(),second.ready()]);await first.query(`begin;${auth}`);await first.query(mutation(payload(8005,2,'deliver')));const queued=second.query(`begin;${auth}${mutation(payload(8006,2,'deliver'))}`);await h.waitForLock('deliver_second');await first.query('commit;');await assert.rejects(queued,/conflict/i);assert.equal(h.sql('select count(*)from private.deal_deliveries'),'1');assert.equal(h.sql(`select status from public.deals where id='${D}'`),'completed');}finally{first.close();second.close();}
const proof={result:'PASS',tests:2,engine:h.sql('select version()'),network:'none',realLockWaits:true,syntheticOnly:true,bankTransfers:false,storage:'local catalog adapter',cases:['concurrent category payments serialize and stale CAS rejects second','concurrent delivery after exact payout+physical acquisition records one delivery']};
await writeFile('/tmp/trade-settlement-native-proof.json',JSON.stringify(proof,null,2)+'\n');
h.sql(`drop database ${h.database} with(force);`,'postgres');console.log(JSON.stringify(proof));
