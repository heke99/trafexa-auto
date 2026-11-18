import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,openSync,readFileSync,writeFileSync,closeSync,unlinkSync,statfsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const CLI_VERSION='3.2.0';
export const root=fileURLToPath(new URL('../',import.meta.url));
function command(args){
 const allowed=['start','stop','status'].includes(args[0])||(args[0]==='db'&&args[1]==='reset')||(args[0]==='gen'&&args[1]==='types');
 if(!allowed||args.some(a=>/^--(?:remote|linked|db-url|project-ref|project-id|workdir|all)(?:=|$)/.test(a)))throw Error('Local starter commands cannot target a hosted project or alternate workdir');
 if(args[0]==='start'&&!args.includes('--exclude'))args=[...args,'--exclude','studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor'];
 return ['exec','--yes',`--package=supabase@${CLI_VERSION}`,'--','supabase',...args,'--workdir',root];
}
const environment=()=>({...process.env,SUPABASE_TELEMETRY_DISABLED:'1'});
export function localCli(args,options={}){
 const result=spawnSync('npm',command(args),{cwd:root,env:environment(),encoding:'utf8',maxBuffer:32*1024*1024,...options});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`Local Supabase ${args[0]} failed: ${result.stderr||'see CLI output'}`);
 return result.stdout;
}
async function start(args){
 const free=()=>{const s=statfsSync(root);return s.bavail*s.bsize;};
 if(free()<8*1024**3)throw Error('At least 8 GiB free workspace disk is required before pulling the local stack');
 const directory=new URL('../supabase/.temp/',import.meta.url);mkdirSync(directory,{recursive:true});
 const lock=new URL('starter-start.pid',directory);
 try{const existing=Number(readFileSync(lock,'utf8'));if(Number.isInteger(existing)&&existing>0){try{process.kill(existing,0);throw Error('Another local starter process is still running');}catch(e){if(e.code!=='ESRCH')throw e;}}unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
 const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
 let child;
 try{
  child=spawn('npm',command(args),{cwd:root,env:environment(),stdio:['ignore','ignore','inherit'],detached:process.platform!=='win32'});
  const stop=()=>{try{process.kill(process.platform==='win32'?child.pid:-child.pid,'SIGTERM');}catch{}};
  const signal=()=>stop();process.once('SIGINT',signal);process.once('SIGTERM',signal);
  const watch=setInterval(()=>{if(free()<4*1024**3){console.error('Local startup stopped: less than 4 GiB disk remains. Existing unrelated containers are untouched.');stop();}},1000);
  try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>code===0?resolve():reject(Error('Local startup did not complete; inspect output before retrying')));});}
  finally{clearInterval(watch);process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);}
 }finally{try{unlinkSync(lock);}catch{}}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){try{const args=process.argv.slice(2);if(args[0]==='start'){await start(args);console.log('Local Supabase started. Run local:bootstrap; no credentials are printed.');}else if(args[0]==='status'){const state=JSON.parse(localCli(['status','--output','json']));console.log(JSON.stringify({apiUrl:state.API_URL,mailpitUrl:state.INBUCKET_URL??state.MAILPIT_URL??null},null,2));}else localCli(args,{stdio:'inherit'});}catch(e){console.error(e.message);process.exitCode=1;}}
