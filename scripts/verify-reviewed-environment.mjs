// Explicit operator-only readiness. This is not a public endpoint or a deployment action.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {assertSupabaseEnvironment} from '../src/lib/runtime/environment.ts';
const target=process.env.TRAFEXA_READINESS_TARGET_URL;
if(!target||target!==process.env.NEXT_PUBLIC_SUPABASE_URL)throw Error('Set the explicit reviewed readiness target to the exact configured project URL');
assertSupabaseEnvironment(target);
const secret=process.env.SUPABASE_SECRET_KEY,connection=process.env.TRAFEXA_READINESS_DATABASE_URL;
if(!secret||!connection)throw Error('Operator readiness requires server credentials and an explicit reviewed database connection');
const health=await fetch(target+'/auth/v1/health',{headers:{apikey:secret},signal:AbortSignal.timeout(10000)});
if(!health.ok)throw Error('Auth dependency is unavailable');
const result=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:await readFile(new URL('../supabase/verification/runtime-contracts.sql',import.meta.url),'utf8'),env:{...process.env,PGDATABASE:connection,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=10000'},encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
if(result.status!==0)throw Error('Read-only contract catalog verification failed; inspect the operator connection securely');
let catalog;try{catalog=JSON.parse(result.stdout.trim());}catch{throw Error('Invalid readiness catalog response');}
if(!catalog.functions?.length||catalog.functions.some(f=>f.available!==true))throw Error('Required authenticated database contracts are missing');
if(catalog.scheduler?.length!==1||catalog.scheduler[0].active!==true||catalog.scheduler[0].schedule!=='* * * * *'||!catalog.scheduler[0].command.includes('private.expire_reservations()'))throw Error('Reservation scheduler is not ready');
const db=createClient(target,secret,{auth:{persistSession:false,autoRefreshToken:false}}),buckets=await db.storage.listBuckets();
if(buckets.error)throw Error('Private Storage dependency is unavailable');
for(const id of ['dealer-documents','native-contract-originals','ads-vehicle-photos','uploaded-contracts'])if(!buckets.data.some(b=>b.id===id&&!b.public))throw Error('Required private bucket is unavailable');
console.log('PASS reviewed environment read-only readiness: Auth, authenticated RPC contracts, private Storage and reservation schedule. No account, email, document or deployment mutation.');
