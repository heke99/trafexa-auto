import {createClient} from '@supabase/supabase-js';
import {localState,localSql} from './local-state.mjs';
const {url,publishable,secret}=localState();
const health=await fetch(url+'/auth/v1/health',{headers:{apikey:publishable},signal:AbortSignal.timeout(10000)});
if(!health.ok)throw Error('Auth health check failed');
const required=['get_platform_admin_session','get_account_access','dealer_document_hub_page_v2','list_pdf_template_versions','get_customer_document_renewal'];
const found=JSON.parse(localSql(`select coalesce(json_agg(proname),'[]')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and proname=any(array[${required.map(n=>"'"+n+"'").join(',')}]);`));
for(const name of required)if(!found.includes(name))throw Error('Required database contract is missing: '+name);
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const buckets=await db.storage.listBuckets();if(buckets.error||!buckets.data.length)throw Error('Private Storage catalog unavailable');
for(const id of ['dealer-documents','native-contract-originals','ads-vehicle-photos','uploaded-contracts']){const bucket=buckets.data.find(b=>b.id===id);if(!bucket||bucket.public)throw Error('Required private bucket is unavailable: '+id);}
const cron=JSON.parse(localSql("select coalesce(json_agg(json_build_object('active',active,'schedule',schedule,'command',command)),'[]')from cron.job where jobname='trafexa-expire-reservations';"));
if(cron.length!==1||!cron[0].active||cron[0].schedule!=='* * * * *'||!cron[0].command.includes('private.expire_reservations()'))throw Error('Actual reservation scheduler is missing or disabled');
console.log('PASS local read-only readiness: Auth, required RPC catalog, private Storage and actual pg_cron reservation schedule. No accounts, documents or outbound messages were created by this check.');
