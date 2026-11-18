import {readdir,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const entry of await readdir(new URL('../tests/',import.meta.url),{withFileTypes:true})){
 if(!entry.isDirectory())continue;
 const directory='tests/'+entry.name;
 try{await access(new URL('../'+directory+'/package-lock.json',import.meta.url));}catch{continue;}
 const result=spawnSync('npm',['ci','--ignore-scripts','--prefix',directory],{cwd:root,stdio:'inherit'});
 if(result.status!==0)throw Error('Test dependency installation failed for '+directory);
}
