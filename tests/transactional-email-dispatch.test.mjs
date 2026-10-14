import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSourceLoader} from './helpers/source-loader.mjs';
const reference='a1300000-0000-4000-8000-000000000001';
async function harness(options={}){
 let sent=0,proofs=0;const calls=[];
 const loader=await createSourceLoader({'server-only':{},
 '@supabase/supabase-js':{createClient(){return {async rpc(name,args){calls.push([name,args]);if(name==='claim_transactional_email')return{data:{id:reference,kind:'contract_invitation',reference,recipient:'customer@example.invalid',createdAt:new Date().toISOString(),firstAttemptAt:new Date().toISOString(),leaseId:reference,...options.row}};return{data:true};}};}},
 '@/lib/platform-admin/context':{async requirePlatformAdminContext(){proofs++;if(options.revoke&&proofs>1)throw Error('Private denial');return{userId:reference};}},
 './transport':{emailConfigurationStatus:()=> 'configured',async sendTransactionalEmail(){sent++;return{status:'accepted',providerId:'fixture-provider-id'};}},
 });return {server:loader.load('src/lib/email/server.ts'),counts:()=>({sent,proofs,calls})};
}
async function configured(fn){const prior={};const values={SUPABASE_SECRET_KEY:'synthetic-only',NEXT_PUBLIC_SUPABASE_URL:'https://buqdtssxrotkzndublrt.supabase.co'};for(const [key,value]of Object.entries(values)){prior[key]=process.env[key];process.env[key]=value;}try{return await fn();}finally{for(const key of Object.keys(values)){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}}
test('persisted-event dispatcher claims only bound kind/reference and finishes one verified lease',()=>configured(async()=>{
 const h=await harness(),r=await h.server.dispatchTransactionalEvent('contract_invitation',reference);assert.equal(r.status,'accepted');assert.equal(h.counts().sent,1);assert.deepEqual(h.counts().calls[0],['claim_transactional_email',{p_kind:'contract_invitation',p_reference:reference}]);assert.equal(h.counts().calls.at(-1)[0],'finish_transactional_email');
}));
test('substituted event/reference or revoked platform-admin proof cannot trigger outbound email',()=>configured(async()=>{
 for(const row of [{kind:'account_approved'},{reference:'a1300000-0000-4000-8000-000000000002'}]){const h=await harness({row}),r=await h.server.dispatchTransactionalEvent('contract_invitation',reference);assert.equal(r.status,'unavailable');assert.equal(h.counts().sent,0);}
 const h=await harness({revoke:true});await assert.rejects(()=>h.server.dispatchNextTransactionalEmail());assert.equal(h.counts().sent,0);
}));
