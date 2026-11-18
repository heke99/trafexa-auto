import {spawnSync} from 'node:child_process';
import {localCli} from './local-supabase.mjs';
export function localState(){
 const state=JSON.parse(localCli(['status','--output','json']));
 const url=state.API_URL;
 if(typeof url!=='string'||!['http://127.0.0.1:54321','http://localhost:54321'].includes(url))throw Error('Expected the isolated local Supabase API at loopback:54321');
 const publishable=state.PUBLISHABLE_KEY??state.ANON_KEY,secret=state.SECRET_KEY??state.SERVICE_ROLE_KEY;
 if(!publishable||!secret)throw Error('Local Supabase keys are unavailable');
 return{url,publishable,secret};
}
export function localSql(source){
 const r=spawnSync('docker',['exec','-i','supabase_db_trafexa-local','psql','-X','-q','-A','-t','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:source,encoding:'utf8',maxBuffer:8*1024*1024});
 if(r.status!==0)throw Error(r.stderr||'Local-only catalog query failed');
 return r.stdout.trim();
}
