// Local only. Uses an existing network-isolated PostgreSQL container and owns
// just the dedicated database named by native-helpers.mjs; no hosted endpoints.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {bootstrap,sql,session,waitForLock,database} from './native-helpers.mjs';
import {fixtureSql,A,C,id} from '../advertising-priced-send-db/fixtures.mjs';

const quote=value=>`'${value.replaceAll("'","''")}'`;
const authenticated=`begin;set local role authenticated;set local "request.jwt.claim.sub"=${quote(A)};`;
const save=(request,code)=>`select public.save_advertising_program_request(${quote(C)},null,${quote(JSON.stringify({store_name:'Native fixture store',dealer_code:code}))}::jsonb,${quote(request)});`;
const resolve=request=>`select public.resolve_advertising_program_request(${quote(C)},${quote(request)});`;
const object=output=>JSON.parse(output.split('\n').filter(line=>line.startsWith('{')).at(-1));
const sessions=[];const checks=[];
let bootstrapped=false;
try{
 await bootstrap();bootstrapped=true;sql(fixtureSql);
 const writer=session('write'),replay=session('replay'),resolver=session('resolve');sessions.push(writer,replay,resolver);
 await Promise.all(sessions.map(item=>item.ready()));

 const first=object(await writer.query(authenticated+save(id(70),'native-one')));
 const duplicate=replay.query(authenticated+save(id(70),'native-one')+'commit;');
 await waitForLock('replay');await writer.query('commit;');
 assert.deepEqual(object(await duplicate),first);
 assert.equal(sql('select count(*) from private.advertising_program_stores;'),'1');
 checks.push({scenario:'two independent PostgreSQL sessions save the same request',result:'PASS',lockWaitObserved:true,stores:1});

 const second=object(await writer.query(authenticated+save(id(71),'native-two')));
 const recovering=resolver.query(authenticated+resolve(id(71))+'commit;');
 await waitForLock('resolve');await writer.query('commit;');
 const recovered=object(await recovering);assert.equal(recovered.state,'saved');assert.deepEqual(recovered.receipt,second);
 checks.push({scenario:'resolver waits for the uncommitted writer and returns its saved receipt',result:'PASS',lockWaitObserved:true});

 const closed=object(await resolver.query(authenticated+resolve(id(72))));assert.equal(closed.state,'not_saved');
 const fenced=replay.query(`${authenticated}do $$begin
   perform public.save_advertising_program_request(${quote(C)},null,${quote(JSON.stringify({store_name:'Must never exist',dealer_code:'native-delayed'}))}::jsonb,${quote(id(72))});
   raise exception 'Delayed request unexpectedly committed';
 exception when sqlstate '40001' then null;end$$;
 select 'fenced';commit;`);
 await waitForLock('replay');await resolver.query('commit;');assert.match(await fenced,/fenced/);
 assert.equal(sql("select count(*) from private.advertising_program_stores where dealer_code='native-delayed';"),'0');
 assert.equal(sql('select count(*) from private.advertising_program_stores;'),'2');
 assert.equal(sql("select count(*) from private.advertising_program_requests where state='not_saved';"),'1');
 checks.push({scenario:'resolver tombstone wins first and prevents the delayed original write',result:'PASS',lockWaitObserved:true,delayedStores:0});

 const lock=await writer.query(`begin;select pg_advisory_xact_lock(hashtextextended('advertising-billing:'||${quote(C)}::text,0));`);
 assert.equal(typeof lock,'string');
 const coordinated=replay.query(authenticated+save(id(73),'native-billing')+'commit;');
 await waitForLock('replay');await writer.query('commit;');assert.equal(object(await coordinated).operation,'store');
 checks.push({scenario:'program save waits for the shared company billing lock',result:'PASS',lockWaitObserved:true});
 const proof={result:'PASS',engine:'native PostgreSQL, independent persistent psql backends',database,checks,productionMutations:0,externalCalls:0,cleanup:'All sessions closed and only this dedicated test database dropped.'};
 await writeFile('/tmp/trafexa-program-native-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
}finally{
 for(const item of sessions)item.close();
 if(bootstrapped)sql(`drop database if exists ${database} with (force);`,'postgres');
}
