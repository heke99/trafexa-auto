import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,relative} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
async function nativeHelper(file,visited=new Set()){
 if(visited.has(file))return null;visited.add(file);
 const source=await readFile(resolve(root,file),'utf8');
 const override=source.match(/process\.env\.[A-Z_]*CONTAINER\s*=\s*'([^']+)'/);if(override&&source.includes('import('))return override[1];
 const match=source.match(/(?:export )?const container\s*=\s*(?:process\.env\.\w+\s*\?\?\s*)?'([^']+)'/);
 if(match&&source.includes('docker'))return match[1];
 for(const m of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"](\.\.?\/[^'"]+\.mjs)['"]/g)){
  const next=resolve(dirname(resolve(root,file)),m[1]);if(next.startsWith(resolve(root,'tests')+'/')){const found=await nativeHelper(relative(root,next),visited);if(found)return found;}
 }
 return null;
}
export async function collectTestMatrix(){
 const candidates=(await readdir(resolve(root,'tests'),{recursive:true})).filter(p=>p.endsWith('.mjs')&&!p.split('/').includes('node_modules')&&!p.split('/').includes('helpers')&&!/helpers?\.mjs$/.test(p)).map(p=>'tests/'+p).sort();
 const files=[];
 for(const file of candidates){const source=await readFile(resolve(root,file),'utf8');if(file.endsWith('.test.mjs')||/(?:from|import)\s*['"]node:test['"]/.test(source)||/(?:^|\/)(?:schema|cross-layer|native(?:-[^/]*)?|[^/]+-native)\.mjs$/.test(file))files.push(file);}
 const rows=[];
 for(const file of files){const nested=file.split('/').length>2,container=await nativeHelper(file);rows.push({file,group:container?'native':nested?'database':'flat',container,command:container?'npm run test:native -- '+file:'node --test '+file});}
 return rows;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
const mode=process.argv[2]??'list';
const rows=await collectTestMatrix();
if(mode==='list'){console.log(JSON.stringify(rows,null,2));}
else{
 if(!['flat','database','native'].includes(mode))throw Error('Choose list, flat, database or native');
 const requested=process.argv[3];const selected=rows.filter(r=>r.group===mode&&(!requested||r.file===requested));if(requested&&!selected.length)throw Error('Requested file is not in this matrix group');console.log(`Running ${selected.length} ${mode} test files`);
 const environment={...process.env};
 for(const key of Object.keys(environment)){
  if(['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'].includes(key) ||
    /^TRAFEXA_[A-Z_]+_TEST_CONTAINER$/.test(key))delete environment[key];
 }
 const run=(cmd,args,extra={})=>{const r=spawnSync(cmd,args,{cwd:root,stdio:'inherit',env:environment,...extra});if(r.status!==0)throw Error(`${cmd} exited ${r.status}`);};
 if(mode!=='native')run(process.execPath,['--test','--test-concurrency=2',...selected.map(r=>r.file)]);
 else for(const row of selected){
  if(spawnSync('docker',['--host=unix:///var/run/docker.sock','inspect',row.container],{stdio:'ignore',env:environment}).status===0)throw Error(`Refusing to reuse existing container ${row.container}`);
  run('docker',['--host=unix:///var/run/docker.sock','run','--detach','--rm','--network=none','--name',row.container,'-e','POSTGRES_PASSWORD=synthetic-test-only','postgres:17.6']);
  try{let ready=false;for(let i=0;i<100;i++){if(spawnSync('docker',['--host=unix:///var/run/docker.sock','exec',row.container,'pg_isready','-U','postgres'],{stdio:'ignore',env:environment}).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('Postgres did not become ready');run(process.execPath,['--test',row.file]);}
  finally{run('docker',['--host=unix:///var/run/docker.sock','rm','--force',row.container]);}
 }
}
}
