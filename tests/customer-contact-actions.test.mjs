import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';
const company='bb759a30-281a-4ff0-983c-6bb23442db58', customer='bb759a30-281a-4ff0-983c-6bb23442db59', user='bb759a30-281a-4ff0-983c-6bb23442db60', contactId='bb759a30-281a-4ff0-983c-6bb23442db61', nonce='bb759a30-281a-4ff0-983c-6bb23442db62';
const row={id:contactId,companyId:company,customerId:customer,kind:'call',contactOn:'2026-10-14',summary:'Ringde kunden',followUpOn:'2026-10-15',followUpStatus:'pending',version:1,createdAt:'2026-10-14T12:00:00Z',createdBy:user};
const create={companyId:company,customerId:customer,kind:'call',contactOn:row.contactOn,summary:row.summary,followUpOn:row.followUpOn,requestId:nonce};
const update={companyId:company,customerId:customer,contactId,expectedVersion:1,status:'done',reason:'Samtalet genomfört',requestId:nonce};
async function setup(options={}) {
 const calls=[],revalidated=[];let authCalls=0;
 const db={auth:{async getUser(){authCalls++;return {data:{user:options.noAuth?null:{id:user,email:'private@example.com',email_confirmed_at:'2026-10-14T00:00:00Z',...(options.authPatch??{})}},error:null};}},from(table){assert.equal(table,'memberships');const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:options.revokedAfter&&authCalls>=options.revokedAfter?null:{company_id:company,user_id:user,role:options.role??'sales',status:'active',companies:{id:company,status:options.companyStatus??'active'}},error:null};}};return q;},async rpc(name,payload){calls.push([name,payload]);return {data:options.data??(name.startsWith('list_')?{companyId:company,actorUserId:user,actorRole:options.role??'sales',businessDate:'2026-10-14',contacts:options.rows??[row],nextPageKey:null}:{companyId:company,actorUserId:user,requestId:nonce,contact:name.startsWith('update_')?{...row,version:2,followUpStatus:'done'}:row}),error:options.error??null};}};
 const loader=await createSourceLoader({'next/cache':{revalidatePath(path){revalidated.push(path);}},'@/lib/supabase/server':{async createServerSupabaseClient(){return db;}},'@/lib/data/company-context':{async getActiveCompanyContext(){return {company:options.selected??company,user,role:'owner'};}}});
 return {actions:loader.load('@/lib/data/customer-contact-actions'),calls,revalidated};
}
test('CRM creation normalizes and binds trusted tenant actor nonce and whitelist receipt',async()=>{
 const {actions,calls,revalidated}=await setup();const result=await actions.createCustomerContactAction({...create,summary:' Ringde kunden '});assert.equal(result.ok,true);assert.equal(result.contact.actorLabel,'Du');assert.equal('createdBy' in result.contact,false);assert.equal(JSON.stringify(result).includes('private@example'),false);assert.deepEqual(calls[0],['create_customer_contact',{p_company_id:company,p_customer_id:customer,p_kind:'call',p_contact_on:row.contactOn,p_summary:row.summary,p_follow_up_on:row.followUpOn,p_request_id:nonce}]);assert.deepEqual(revalidated,['/customers','/dashboard']);
});
test('CRM fresh membership defeats cached write role, revoked Auth and inactive company',async()=>{
 for(const options of [{role:'viewer'},{role:'finance'},{noAuth:true},{authPatch:{is_anonymous:true}},{authPatch:{email_confirmed_at:'invalid'}},{selected:customer},{companyStatus:'suspended'}]){const {actions,calls}=await setup(options);assert.equal((await actions.createCustomerContactAction(create)).ok,false);assert.equal((await actions.updateCustomerFollowUpAction(update)).ok,false);assert.equal(calls.length,0);}
});
test('CRM read roles can list but post-IO revocation clears successful data',async()=>{
 for(const role of ['viewer','finance']){const {actions}=await setup({role});assert.equal((await actions.listCustomerContactsAction({companyId:company,customerId:customer})).ok,true);}
 const {actions,revalidated}=await setup({revokedAfter:2});assert.equal((await actions.createCustomerContactAction(create)).ok,false);assert.deepEqual(revalidated,[]);
});
test('CRM controls impossible dates forbidden extra fields and unsafe versions never invoke RPC',async()=>{
 const {actions,calls}=await setup();for(const patch of [{createdBy:user},{kind:'sms'},{contactOn:'2026-02-30'},{summary:'x'},{summary:'x'.repeat(2001)},{summary:'bad\u0000'},{followUpOn:'2026-10-13'},{requestId:'bad'}])assert.equal((await actions.createCustomerContactAction({...create,...patch})).ok,false);
 for(const patch of [{expectedVersion:0},{expectedVersion:1.5},{expectedVersion:2147483647},{status:'pending'},{reason:'x'},{reason:'bad\nreason'},{actorUserId:user}])assert.equal((await actions.updateCustomerFollowUpAction({...update,...patch})).ok,false);assert.equal(calls.length,0);
});
test('CRM rejects foreign actor tenant nonce payload and unknown mutation outcomes',async()=>{
 for(const patch of [{companyId:customer},{actorUserId:customer},{requestId:customer},{contact:{...row,customerId:user}},{contact:{...row,createdBy:customer}},{contact:{...row,summary:'another request'}},{contact:{...row,version:2}}]){const {actions,revalidated}=await setup({data:{companyId:company,actorUserId:user,requestId:nonce,contact:row,...patch}});assert.equal((await actions.createCustomerContactAction(create)).ok,false);assert.deepEqual(revalidated,[]);}
 const {actions}=await setup({error:{code:'XX000',message:'password=secret'}});const result=await actions.createCustomerContactAction(create);assert.equal(result.ok,false);assert.equal(result.message.includes('secret'),false);
});
test('CRM followup mutation preserves CAS nonce and reason and rejects foreign/stale returned row',async()=>{
 const {actions,calls}=await setup();assert.equal((await actions.updateCustomerFollowUpAction(update)).ok,true);assert.equal(calls[0][1].p_expected_version,1);assert.equal(calls[0][1].p_reason,update.reason);assert.equal(calls[0][1].p_request_id,nonce);
 for(const patch of [{version:1},{followUpStatus:'pending'},{id:user},{customerId:user}]){const {actions}=await setup({data:{companyId:company,actorUserId:user,requestId:nonce,contact:{...row,version:2,followUpStatus:'done',...patch}}});assert.equal((await actions.updateCustomerFollowUpAction(update)).ok,false);}
 const conflict=await setup({error:{code:'40001'}});assert.equal((await conflict.actions.updateCustomerFollowUpAction(update)).code,'conflict');
});
test('CRM list verifies full scope rows and cursor and strips extra database fields',async()=>{
 const {actions}=await setup({rows:[{...row,createdBy:customer,secret:'untrusted'}]});const result=await actions.listCustomerContactsAction({companyId:company,customerId:customer});assert.equal(result.ok,true);assert.equal(result.contacts[0].actorLabel,'Kollega');assert.equal('secret' in result.contacts[0],false);
 for(const data of [{companyId:customer,actorUserId:user,actorRole:'sales',businessDate:'2026-10-14',contacts:[],nextPageKey:null},{companyId:company,actorUserId:user,actorRole:'owner',businessDate:'2026-10-14',contacts:[],nextPageKey:null},{companyId:company,actorUserId:user,actorRole:'sales',businessDate:'2026-02-30',contacts:[],nextPageKey:null},{companyId:company,actorUserId:user,actorRole:'sales',businessDate:'2026-10-14',contacts:[row],nextPageKey:contactId}]){const {actions}=await setup({data});assert.equal((await actions.listCustomerContactsAction({companyId:company,customerId:customer})).ok,false);}
});
test('CRM followup dates use authoritative Stockholm businessDate and every row is pending and scoped',async()=>{
 const {actions,calls}=await setup({rows:[{...row,followUpOn:'2026-10-14',customerName:'Kund'}]});assert.equal((await actions.listCustomerFollowUpsAction({companyId:company,filter:'due'})).ok,true);assert.deepEqual(calls[0][1],{p_company_id:company,p_filter:'due',p_page_key:null,p_limit:50});
 for(const patch of [{followUpOn:'2026-10-15'},{followUpStatus:'done'},{customerName:null}]){const {actions}=await setup({rows:[{...row,followUpOn:'2026-10-14',customerName:'Kund',...patch}]});assert.equal((await actions.listCustomerFollowUpsAction({companyId:company,filter:'due'})).ok,false);}
});
test('CRM complete fifty-row page preserves UUID cursor and full followups outside workspace sample',async()=>{
 const rows=Array.from({length:50},(_,i)=>({...row,id:`bb759a30-281a-4ff0-983c-${String(i).padStart(12,'0')}`}));
 const {actions,calls}=await setup({data:{companyId:company,actorUserId:user,actorRole:'sales',businessDate:'2026-10-14',contacts:rows,nextPageKey:rows.at(-1).id}});
 const result=await actions.listCustomerContactsAction({companyId:company,customerId:customer,pageKey:contactId});assert.equal(result.ok,true);assert.equal(result.contacts.length,50);assert.equal(result.nextPageKey,rows.at(-1).id);assert.equal(calls[0][1].p_page_key,contactId);
 const follows=await setup({rows:[{...row,customerName:'Kund utanför lageröversikten'}]});assert.equal((await follows.actions.listCustomerFollowUpsAction({companyId:company,filter:'upcoming'})).ok,true);
});
test('CRM revoked membership during list or update yields no stale data/success and rejects filter injection',async()=>{
 for(const method of ['list','update']){const {actions,revalidated}=await setup({revokedAfter:2});const result=method==='list'?await actions.listCustomerContactsAction({companyId:company,customerId:customer}):await actions.updateCustomerFollowUpAction(update);assert.equal(result.ok,false);assert.deepEqual(revalidated,[]);assert.equal('contacts' in result,false);}
 const {actions,calls}=await setup();for(const patch of [{pageKey:'bad'},{actorRole:'owner'},{customerId:null}])assert.equal((await actions.listCustomerContactsAction({companyId:company,customerId:customer,...patch})).ok,false);
 assert.equal((await actions.listCustomerFollowUpsAction({companyId:company,filter:'due),company_id.eq.foreign'})).ok,false);assert.equal(calls.length,0);
});
