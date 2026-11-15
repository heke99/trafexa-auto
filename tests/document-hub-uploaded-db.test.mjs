import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {fixture,C,D,U,V,F,SOURCE,id} from './helpers/uploaded-pdf/fixture.mjs';
import {parseHubPage,documentDownloadHref} from '../src/lib/document-hub/types.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hub(h,user=U,company=C,kind='contract',cursor=null,query=''){
 const r=await h.rpc('authenticated',user,'dealer_document_hub_page_v2',{p_company_id:company,p_query:query,p_kind:kind,p_cursor:cursor});
 if(r.error)throw r.error;return r.data;
}
async function complete(h){const u=await h.upload();assert.equal(u.response.status,200);assert.equal((await h.send(u.result.source)).ok,true);await h.openMail();const signed=await h.actions.signUploadedPdfGuestAction({sourceId:SOURCE,documentHash:u.result.source.documentHash,fullName:'Synthetic Document Hub Buyer',acknowledged:true,requestId:id(500)});assert.equal(signed.ok,true);return{uploaded:u.result.source,signed:signed.source};}
test('uploaded draft and pending are absent; dual-signed stored PDF and evidence appear through v2 and download with verified hashes',async t=>{
 const h=await fixture(t),u=await h.upload();assert.equal(u.response.status,200);assert.equal((await hub(h)).rows.length,0);
 assert.equal((await h.send(u.result.source)).ok,true);assert.equal((await hub(h)).rows.length,0);await h.openMail();
 const signed=await h.actions.signUploadedPdfGuestAction({sourceId:SOURCE,documentHash:u.result.source.documentHash,fullName:'Synthetic Hub Buyer',acknowledged:true,requestId:id(501)});assert.equal(signed.ok,true);
 const page=await hub(h);assert.equal(page.rows.length,1);const row=page.rows[0];assert.equal(row.kind,'uploaded_contract');assert.equal(row.downloadId,SOURCE);assert.equal(row.title,'agreement.pdf');
 assert.doesNotMatch(JSON.stringify(page),/objectPath|uploaded-pdfs|documentHash|originalSha256|recipientEmail|customer@example/);
 assert.equal((await h.rpc('authenticated',U,'dealer_document_hub_page',{p_company_id:C,p_kind:'contract'})).data.rows.length,0,'legacy RPC keeps old vocabulary');
 for(const [evidence,artifact] of [[false,'signed'],[true,'evidence']]){
  const href=documentDownloadHref(row,C,evidence);const response=await h.dealerDownload.GET(new h.NextRequest('https://app.fixture.invalid'+href),{params:Promise.resolve({id:SOURCE,artifact})});assert.equal(response.status,200);
  const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(hash(bytes),evidence?signed.source.archive.evidenceSha256:signed.source.archive.pdfSha256);
 }
 const other=await hub(h,V,F);assert.equal(other.rows.length,0);await assert.rejects(hub(h,V,C),e=>e.code==='42501');
 await h.db.query("update public.deals set status='cancelled' where id=$1",[D]);assert.equal((await hub(h)).rows.length,1,'completed stored originals survive a later cancelled lifecycle');
 const stored=h.state.objects.get(signed.source.archive.pdfPath);stored.bytes=new Uint8Array([37,80,68,70,45,1,2,3]);
 const corrupted=await h.dealerDownload.GET(new h.NextRequest('https://app.fixture.invalid'+documentDownloadHref(row,C)),{params:Promise.resolve({id:SOURCE,artifact:'signed'})});assert.equal(corrupted.status,404);
});
test('finance cannot discover owner-only uploaded PDF metadata and parser rejects a poisoned finance page',async t=>{
 const h=await fixture(t);await complete(h);await h.db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'hub-finance@example.invalid',now());",[id(510)]);await h.db.query("insert into public.memberships(company_id,user_id,role)values($1,$2,'finance')",[C,id(510)]);
 await h.db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'hub-admin@example.invalid',now())",[id(511)]);await h.db.query("insert into public.memberships(company_id,user_id,role)values($1,$2,'admin')",[C,id(511)]);assert.equal((await hub(h,id(511))).rows.length,1);
 const grants=(await h.db.query("select has_function_privilege('anon','public.dealer_document_hub_page_v2(uuid,text,text,jsonb)','execute') anon,has_function_privilege('service_role','public.dealer_document_hub_page_v2(uuid,text,text,jsonb)','execute') service,has_function_privilege('authenticated','public.dealer_document_hub_page_v2(uuid,text,text,jsonb)','execute') authenticated")).rows[0];assert.deepEqual(grants,{anon:false,service:false,authenticated:true});
 const ownerPage=await hub(h);assert.equal(ownerPage.rows.length,1);const financePage=await hub(h,id(510));assert.equal(financePage.rows.length,0);
 assert.throws(()=>parseHubPage({...ownerPage,actorId:id(510),role:'finance'},{companyId:C,actorId:id(510),role:'finance',query:'',kind:'contract'}));
 h.state.actor=id(510);const denied=await h.dealerDownload.GET(new h.NextRequest('https://app.fixture.invalid'+documentDownloadHref(ownerPage.rows[0],C)),{params:Promise.resolve({id:SOURCE,artifact:'signed'})});assert.equal(denied.status,404);
});
test('equal-time mixed uploaded/native-compatible rows paginate once and reject cross-scope uploaded cursors',async t=>{
 const h=await fixture(t),u=await h.upload();assert.equal(u.response.status,200);
 // Isolated SQL fixtures exercise the projection; the download test above uses real signing and stored bytes.
 await h.db.query(`insert into private.uploaded_pdf_signatures(source_id,party,actor_user_id,full_name,document_hash,consent_version)select id,'company',created_by,'Synthetic Seller',document_hash,'2026-11-13' from private.uploaded_pdf_sources where id=$1 union all select id,'customer',null,'Synthetic Buyer',document_hash,'2026-11-13' from private.uploaded_pdf_sources where id=$1`,[SOURCE]);
 await h.db.exec(`do $$declare n int;s private.uploaded_pdf_sources;a uuid;root text;content text;original_hash text;begin
  select * into s from private.uploaded_pdf_sources where id='${SOURCE}';
  for n in 1..34 loop a:=('ab130000-0000-4000-8000-'||lpad((600+n)::text,12,'0'))::uuid;root:='${C}/uploaded-pdfs/'||a::text||'/';content:=jsonb_set(s.canonical_content::jsonb,'{sourceId}',to_jsonb(a::text))::text;original_hash:=case when n=34 then repeat('f',64) else s.original_sha256 end;
   insert into private.uploaded_pdf_sources(id,company_id,deal_id,customer_id,created_by,company_name,recipient_name,recipient_email,filename,original_sha256,byte_size,page_count,object_path,canonical_content,document_hash,created_at,expires_at)values(a,s.company_id,s.deal_id,s.customer_id,s.created_by,s.company_name,s.recipient_name,s.recipient_email,s.filename,original_hash,s.byte_size,s.page_count,root||'original-'||original_hash||'.pdf',content,encode(sha256(convert_to(content,'UTF8')),'hex'),'2026-11-15T12:00:00Z','2026-11-22T12:00:00Z');
   insert into private.uploaded_pdf_signatures(source_id,party,actor_user_id,full_name,document_hash,consent_version,signed_at)select a,g.party,g.actor_user_id,g.full_name,case when n=33 and g.party='customer' then repeat('f',64) else encode(sha256(convert_to(content,'UTF8')),'hex') end,g.consent_version,'2026-11-15T12:01:00Z' from private.uploaded_pdf_signatures g where source_id=s.id;
   insert into private.uploaded_pdf_artifacts values(a,root||'signed-'||repeat('b',64)||'.pdf',repeat('b',64),root||'evidence-'||repeat('c',64)||'.json',repeat('c',64),'2026-11-15T12:02:00Z');
   if n<>32 then insert into storage.objects(bucket_id,name)values('uploaded-contracts',root||'original-'||original_hash||'.pdf');end if;
   insert into storage.objects(bucket_id,name)values('uploaded-contracts',root||'signed-'||repeat('b',64)||'.pdf'),('uploaded-contracts',root||'evidence-'||repeat('c',64)||'.json');
  end loop;
  insert into public.offers(id,company_id,deal_id,version,snapshot)values('${id(950)}','${C}','${D}',1,'{}');
  insert into public.documents(id,company_id,deal_id,name,object_path,kind)values('${id(951)}','${C}','${D}','Native Hub Offer','${C}/offers/${id(950)}/v1/'||repeat('d',64)||'.pdf','other');
  insert into public.offer_document_archives(company_id,offer_id,deal_id,offer_version,pdf_sha256,snapshot_sha256,object_path,document_id,document_name,submission_id,archived_by,created_at)values('${C}','${id(950)}','${D}',1,repeat('d',64),repeat('d',64),'${C}/offers/${id(950)}/v1/'||repeat('d',64)||'.pdf','${id(951)}','Native Hub Offer','${id(952)}','${U}','2026-11-15T12:02:00Z');
  end$$;`);
 const first=await hub(h);assert.equal(first.rows.length,25);assert.equal(first.nextCursor.rowKind,'uploaded_contract');const next=await hub(h,U,C,'contract',first.nextCursor);assert.equal(next.rows.length,6);assert.equal(next.nextCursor,null);assert.equal(new Set([...first.rows,...next.rows].map(r=>r.id)).size,31);
 await assert.rejects(hub(h,U,C,'all',first.nextCursor),e=>e.code==='22023');await assert.rejects(hub(h,U,C,'contract',{...first.nextCursor,actorId:V}),e=>e.code==='22023');
 assert.equal((await hub(h,U,C,'offer')).rows.length,1);
 const allFirst=await hub(h,U,C,'all'),allNext=await hub(h,U,C,'all',allFirst.nextCursor);const combined=[...allFirst.rows,...allNext.rows];assert.equal(combined.length,32);assert.equal(combined.filter(row=>row.kind==='offer').length,1);assert.equal(new Set(combined.map(row=>row.kind+':'+row.id)).size,32);
 const old=await h.rpc('authenticated',U,'dealer_document_hub_page',{p_company_id:C,p_kind:'all'});assert.equal(old.data.rows.length,1);assert.equal(old.data.rows[0].kind,'offer');
});
