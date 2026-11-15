import test from'node:test';
import assert from'node:assert/strict';
import{fixture,call,id,U,C,S,CU,D,OTHER,prepare,approve}from'./helpers/direct-deal-harness.mjs';
import{capability,service,read}from'./guest-customer-db/helpers.mjs';
import{createSourceLoader}from'./helpers/source-loader.mjs';
import *as guest from './guest-customer-db/helpers.mjs';
const args=deal=>({p_company_id:C,p_deal_id:deal});
const list=(db,status='all')=>call(db,'dealer_register_page',{p_company_id:C,p_kind:'deals',p_status:status});
async function remove(db,deal,page,nonce=id(800)){const input={companyId:C,dealId:deal,reviewHash:page.reviewHash,acknowledged:true,requestId:nonce};return{input,receipt:await call(db,'mutate_deal_delete',{...args(deal),p_input:input})};}
async function archive(db,deal,page,op='archive',nonce=id(801)){return call(db,'mutate_deal_archive',{...args(deal),p_input:{companyId:C,dealId:deal,operation:op,expectedVersion:page.version,reviewHash:page.reviewHash,reason:'Synthetic archive review',acknowledged:true,requestId:nonce}});}
function safe(e){return new Error(String(e.code??'')+' '+e.message);}
test('actual unsigned primary flow can be removed from active and archived lists without erasing original or audit; exact replay is one removal',async()=>{const db=await fixture();try{
 const{review}=await call(db,'prepare_direct_deal',prepare()),deal=review.dealId,p=await call(db,'get_deal_delete',args(deal));assert.equal(p.canDelete,true);
 const before=(await db.query('select *from public.deals where id=$1',[deal])).rows[0],draft=(await db.query('select *from private.sale_contract_drafts where id=$1',[review.draft.id])).rows[0];
 const r=await remove(db,deal,p);assert.equal(r.receipt.deleted,true);assert.deepEqual(await call(db,'mutate_deal_delete',{...args(deal),p_input:r.input}),r.receipt);
 assert.equal((await list(db)).rows.length,0);assert.equal((await list(db,'archived')).rows.length,0);assert.equal((await list(db)).totalCount,'0');
 const projection=await call(db,'get_deal_contract_progress',{p_company_id:C,p_deal_ids:[deal]});assert.equal(projection.rows[0].removed,true);
 assert.equal((await call(db,'inventory_dashboard_totals',{p_company_id:C})).activeDealCount,'0');
 assert.deepEqual((await db.query('select *from public.deals where id=$1',[deal])).rows[0],before);assert.deepEqual((await db.query('select *from private.sale_contract_drafts where id=$1',[review.draft.id])).rows[0],draft);
 assert.equal((await db.query('select count(*)::int n from private.deal_list_removals')).rows[0].n,1);await assert.rejects(call(db,'get_deal_archive',args(deal)),e=>e.code==='42501');
 await assert.rejects(call(db,'approve_direct_deal',approve(review)),e=>['42501','55000','40001'].includes(e.code));
 await assert.rejects(db.query('delete from private.deal_list_removals'),e=>e.code==='55000');
 }catch(e){throw safe(e);}finally{await db.close();}});
test('fully guest-signed draft archives directly while signed documents remain identical and deletion is denied',async()=>{const db=await fixture();try{
 const{review}=await call(db,'prepare_direct_deal',prepare()),{signing}=await call(db,'approve_direct_deal',approve(review)),deal=review.dealId;
 assert.equal((await call(db,'get_deal_archive',args(deal))).canArchive,false);assert.equal((await call(db,'get_deal_delete',args(deal))).canDelete,false);
 const cap=await capability(db,'contract_invitation',signing.id);await service(db,'sign_guest_contract',[cap.invitationId,cap.tokenHash,2,cap.documentHash,'Synthetic Archived Buyer',[],true,'2026-10-14',id(802)]);
 const before=await call(db,'get_contract_signing',{p_company_id:C,p_signing_id:signing.id}),p=await call(db,'get_deal_archive',args(deal));assert.equal(p.canArchive,true);assert.equal(p.dealStatus,'draft');
 await archive(db,deal,p);assert.equal((await list(db)).rows.length,0);assert.equal((await list(db,'archived')).rows[0].id,deal);
 assert.deepEqual(await call(db,'get_contract_signing',{p_company_id:C,p_signing_id:signing.id}),before);assert.equal((await read(db,cap)).document.status,'completed');
 const deletion=await call(db,'get_deal_delete',args(deal));assert.equal(deletion.canDelete,false);assert.equal(deletion.blockedReason,'business_history');await assert.rejects(remove(db,deal,deletion,id(803)),e=>e.code==='40001');
 assert.equal((await db.query('select status from public.deals where id=$1',[deal])).rows[0].status,'draft');assert.equal((await db.query('select count(*)::int n from private.deal_deliveries')).rows[0].n,0);
 }catch(e){throw safe(e);}finally{await db.close();}});
test('archived unsigned draft can be removed; stale review, actor roles, company scope and public grants remain strict',async()=>{const db=await fixture();try{
 const{review}=await call(db,'prepare_direct_deal',prepare()),deal=review.dealId,p=await call(db,'get_deal_delete',args(deal));await archive(db,deal,await call(db,'get_deal_archive',args(deal)));
 await assert.rejects(remove(db,deal,p),e=>e.code==='40001');const fresh=await call(db,'get_deal_delete',args(deal));assert.equal(fresh.canDelete,true);
 await assert.rejects(call(db,'get_deal_delete',args(deal),OTHER),e=>e.code==='42501');
 await db.query("update public.memberships set role='sales'where company_id=$1 and user_id=$2",[C,U]);assert.equal((await call(db,'get_deal_delete',args(deal))).canDelete,false);await assert.rejects(remove(db,deal,fresh),e=>e.code==='42501');
 await db.query("update public.memberships set role='owner'where company_id=$1 and user_id=$2",[C,U]);await remove(db,deal,fresh);assert.equal((await list(db,'archived')).rows.length,0);
 const grants=(await db.query("select has_function_privilege('anon','public.mutate_deal_delete(uuid,uuid,jsonb)','execute') a,has_function_privilege('service_role','public.mutate_deal_delete(uuid,uuid,jsonb)','execute') s")).rows[0];assert.deepEqual(grants,{a:false,s:false});
 }catch(e){throw safe(e);}finally{await db.close();}});
test('legacy create_deal remains removable; active reservation blocks both operations without changing stock',async()=>{const db=await fixture();try{
 await db.query("insert into public.customers(id,company_id,kind,name,email)values($1,$2,'person','Synthetic Simple Buyer','simple@example.invalid')",[CU,C]);
 const deal=await call(db,'create_deal',{company:C,stock:S,customer:CU,price_ore:12000000});assert.equal((await call(db,'get_deal_delete',args(deal))).canDelete,true);
 await call(db,'reserve_vehicle',{company:C,deal,hours:48});const p=await call(db,'get_deal_archive',args(deal));assert.equal(p.blockedReason,'active_reservation');const d=await call(db,'get_deal_delete',args(deal));assert.equal(d.canDelete,false);await assert.rejects(remove(db,deal,d),e=>e.code==='40001');assert.equal((await db.query('select status from public.stock_items where id=$1',[S])).rows[0].status,'reserved');
 }catch(e){throw safe(e);}finally{await db.close();}});
test('workspace snapshot strips removed rows and rejects forged removal markers without marking others unsigned',async()=>{
 const company=C,actor=U,progress={status:'none',source:null,companySigned:false,customerSigned:false,signedAt:null,invitationStatus:'none'},deals=[{id:D,status:'draft',sale_price_ore:1,customer_id:CU,stock_item_id:S,created_at:'2026-11-15T00:00:00Z'}];
 const loader=await createSourceLoader(),{workspaceDealProgress}=loader.load('@/lib/data/workspace-deal-progress');const db={rpc:async()=>({data:{companyId:company,actorId:actor,role:'owner',rows:[{dealId:D,archived:true,removed:true,contractProgress:progress}]},error:null})};assert.deepEqual((await workspaceDealProgress(db,company,actor,'owner',deals)).deals,[]);
 db.rpc=async()=>({data:{companyId:company,actorId:actor,role:'owner',rows:[{dealId:D,archived:true,removed:'yes',contractProgress:progress}]},error:null});assert.match((await workspaceDealProgress(db,company,actor,'owner',deals)).error,/kunde inte verifieras/);
});

test('accepted native offer is resolved by its exact fully signed contract and can archive before physical delivery',async()=>{const h=await guest.fixture();try{const cap=await guest.capability(h.db,'offer_invitation',h.review.id),signing=await guest.createSigning(h,cap);const args={p_company_id:guest.C,p_deal_id:guest.D};assert.equal((await call(h.db,'get_deal_archive',args,guest.U)).canArchive,false);await guest.rpc(h.db,guest.U,'sign_contract',[signing.id,guest.C,1,signing.documentHash,'Synthetic Seller',guest.strokes,true,'2026-10-14',guest.id(950)]);const contract=await guest.capability(h.db,'contract_invitation',signing.id);await guest.service(h.db,'sign_guest_contract',[contract.invitationId,contract.tokenHash,2,contract.documentHash,'Synthetic Buyer',[],true,'2026-10-14',guest.id(951)]);const page=await call(h.db,'get_deal_archive',args,guest.U);assert.equal(page.canArchive,true);assert.equal(page.dealStatus,'draft');await call(h.db,'mutate_deal_archive',{...args,p_input:{companyId:guest.C,dealId:guest.D,operation:'archive',expectedVersion:page.version,reviewHash:page.reviewHash,reason:'Synthetic signed offer archive',acknowledged:true,requestId:guest.id(952)}},guest.U);assert.equal((await guest.read(h.db,contract)).document.status,'completed');}catch(e){throw safe(e);}finally{await h.db.close();}});

test('global superadmin open counters exclude archived and removed drafts while created history is retained',async()=>{const db=await fixture();try{const{review}=await call(db,'prepare_direct_deal',prepare()),deal=review.dealId;await db.query('insert into private.platform_admins(user_id,created_by)values($1,$1)',[U]);const before=await call(db,'get_platform_overview',{});assert.equal(before.deals.draft,'1');await archive(db,deal,await call(db,'get_deal_archive',args(deal)));const archived=await call(db,'get_platform_overview',{});assert.equal(archived.deals.draft,'0');assert.equal(archived.deals.total,'1');assert.deepEqual(archived.daily,before.daily);await remove(db,deal,await call(db,'get_deal_delete',args(deal)));const removed=await call(db,'get_platform_overview',{});assert.equal(removed.deals.draft,'0');assert.equal(removed.deals.reserved,'0');assert.equal(removed.deals.total,'1');assert.deepEqual(removed.daily,before.daily);}catch(e){throw safe(e);}finally{await db.close();}});
