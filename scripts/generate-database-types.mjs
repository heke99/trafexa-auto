import {readFile,writeFile} from 'node:fs/promises';
import {localCli} from './local-supabase.mjs';
const target=new URL('../src/lib/supabase/database.types.ts',import.meta.url),current=await readFile(target,'utf8');
const start=current.indexOf('type RpcArgumentCompatibility ='),end=current.indexOf('type DatabaseWithoutInternals =');
if(start<0||end<=start)throw Error('Cannot preserve reviewed RPC nullability compatibility adapter');
const inputIndex=process.argv.indexOf('--from-verified-file');
const generated=inputIndex<0?localCli(['gen','types','--schema','public']):await readFile(process.argv[inputIndex+1],'utf8');
if(!generated.includes('export type Database =')||!generated.includes('type DatabaseWithoutInternals ='))throw Error('Unexpected generator output; existing types were not changed');
const next=generated.replace('export type Database =','export type GeneratedDatabase =').replace('type DatabaseWithoutInternals =',current.slice(start,end)+'type DatabaseWithoutInternals =');
if(process.argv.includes('--check')){if(next!==current){console.error('Database type drift. Reset isolated local stack, run npm run db:types and review generated diff.');process.exitCode=1;}}
else{await writeFile(target,next);console.log('Generated public database types from isolated local stack; reviewed compatibility adapter retained.');}
