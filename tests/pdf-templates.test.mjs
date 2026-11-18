import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{createHash}from'node:crypto';import{asRole}from'./crm-db/helpers.mjs';
import {fixture,C,D,id,fields,ASSET,FAMILY,SAVE,GENERATE,pdfFixture}from './helpers/pdf-templates/fixture.mjs';
const{PDFDocument,degrees,PDFName,PDFString}=createRequire(import.meta.url)('pdf-lib');const hash=b=>createHash('sha256').update(b).digest('hex');const U=id(1),V=id(2),F=id(4);
async function prepared(t,mapping=fields){const h=await fixture(t),u=await h.templateUpload();assert.equal(u.response.status,200,JSON.stringify(u.result));const s=await h.templateSave(ASSET,mapping);assert.equal(s.ok,true,JSON.stringify(s));return{...h,template:s.template,asset:u.result.asset};}

test('template selectors find older families and show their latest usable version', async (t) => {
 const h = await prepared(t);
 await h.db.query(`insert into private.pdf_template_versions(company_id,template_id,version,asset_id,title,fields,created_by)
   select company_id,template_id,n,asset_id,'Bilavtal aktuell version',fields,created_by
   from private.pdf_template_versions cross join generate_series(2,105) n where id=$1`, [h.template.id]);
 await h.db.query(`insert into private.pdf_template_versions(company_id,template_id,version,asset_id,title,fields,created_by)
   select company_id,('ab130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,asset_id,'Äldre familj '||n,fields,created_by
   from private.pdf_template_versions cross join generate_series(20,70) n where id=$1`, [h.template.id]);
 const first = await h.templateActions.listPdfTemplateVersionsAction({ companyId: C });
 assert.equal(first.ok, true, JSON.stringify(first));
 assert.equal(first.templates.length, 50);
 assert.equal(first.templates.find(row=>row.templateId===FAMILY)?.version, 105);
 const older = await h.templateActions.listPdfTemplateVersionsAction({ companyId: C, beforeTemplateId: first.nextBeforeTemplateId });
 assert.equal(older.ok, true, JSON.stringify(older));
 assert.deepEqual(older.templates.map(row=>row.templateId), [id(21), id(20)]);
 const found = await h.templateActions.listPdfTemplateVersionsAction({ companyId: C, search: 'äldre familj 20' });
 assert.equal(found.ok, true, JSON.stringify(found));
 assert.deepEqual(found.templates.map(row=>row.templateId), [id(20)]);

 await h.db.query(`insert into private.sale_contract_template_versions(company_id,template_id,version,title,body,status,created_by,approved_at)
   select $1,('ab130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,'Direktmall '||n,'Syntetiskt avtal','approved',$2,now()
   from generate_series(20,70) n`, [C,U]);
 await h.db.query(`insert into private.sale_contract_template_versions(company_id,template_id,version,title,body,status,created_by)
   values($1,$2,2,'Ogranskat utkast','Syntetiskt avtal','draft',$3)`, [C,id(20),U]);
 const initial = await h.rpc('authenticated', U, 'get_direct_deal_options', { p_company_id: C });
 assert.equal(initial.error, null);
 assert.equal(initial.data.templates.length, 50);
 const tail = await h.rpc('authenticated', U, 'list_direct_deal_template_selection', {
   p_company_id: C, p_search: '', p_before_template_id: initial.data.nextBeforeTemplateId,
 });
 assert.equal(tail.error, null);
 assert.deepEqual(tail.data.templates.map(row=>[row.templateId,row.version]), [[id(20),1]]);
});
test('original background → authoritative fill → unchanged PDF signing → two signatures and hash evidence',async t=>{const h=await prepared(t),g=await h.templateGenerate(h.template.id);assert.equal(g.ok,true,JSON.stringify(g));assert.deepEqual(await h.templateGenerate(h.template.id),g);const row=(await h.db.query('select * from private.pdf_template_generations')).rows[0];assert.deepEqual(row.data,{'customer.name':'Åsa Köpare','vehicle.registration':'PDF130','deal.price':'200'});const lineage=(await h.db.query('select * from private.pdf_template_source_lineage')).rows[0];assert.equal(lineage.template_sha256,h.asset.sha256);assert.equal(lineage.generated_pdf_sha256,g.source.originalSha256??hash(h.state.objects.get(g.source.objectPath).bytes));assert.equal(hash(h.state.objects.get(`${C}/pdf-templates/${ASSET}/original-${h.asset.sha256}.pdf`).bytes),h.asset.sha256);const output=h.state.objects.get(g.source.objectPath).bytes;assert.equal((await PDFDocument.load(output)).getPageCount(),1);const pdf=h.loader.load('@/lib/pdf-templates/pdf');assert.equal((await pdf.fillPdfTemplate(await pdfFixture(),h.asset,fields,row.data,row.created_at)).sha256,hash(output));
const sent=await h.send(g.source);assert.equal(sent.ok,true,JSON.stringify(sent));await h.openMail();const signed=await h.actions.signUploadedPdfGuestAction({sourceId:GENERATE,documentHash:sent.source.documentHash,fullName:'Åsa Köpare',acknowledged:true,requestId:id(120)});assert.equal(signed.ok,true,JSON.stringify(signed));assert.equal(signed.source.status,'completed');assert.equal(h.state.providers.length,2);const evidence=await h.guestDownload.GET(new h.NextRequest('https://app.fixture.invalid'),{params:Promise.resolve({id:GENERATE,artifact:'evidence'})});assert.equal((await evidence.json()).originalPdfSha256,hash(output));assert.equal((await h.db.query('select count(*)::int n from private.uploaded_pdf_signatures')).rows[0].n,2);});
test('version CAS, exact nonce retries, field boundaries and overlaps are checked by both action and SQL',async t=>{const h=await prepared(t);assert.deepEqual(await h.templateSave(),{ok:true,template:h.template});const stale=await h.templateSave(ASSET,fields,{requestId:id(121)});assert.equal(stale.code,'conflict');const changed=await h.templateSave(ASSET,fields,{title:'Changed title'});assert.equal(changed.code,'conflict');const bads=[[{...fields[0],x:.9}], [{...fields[0],pageIndex:1}], [fields[0],{...fields[0],id:id(123)}], [{...fields[0],key:'customer.secret'}], [{...fields[0],height:.001}]];for(const mapping of bads){const a=await h.templateSave(ASSET,mapping,{requestId:id(122),expectedVersion:1});assert.equal(a.ok,false);const sql=await h.rpc('authenticated',U,'save_pdf_template_version',{p_company_id:C,p_asset_id:ASSET,p_template_id:FAMILY,p_expected_version:1,p_title:'Invalid mapping',p_fields:mapping,p_request_id:id(124),p_acknowledged:true});assert.equal(sql.error?.code,'22023',JSON.stringify(sql));}const touching=[{...fields[0],x:.1,width:.2},{...fields[1],x:.3,y:.1,width:.2}];const next=await h.templateSave(ASSET,touching,{expectedVersion:1,requestId:id(125)});assert.equal(next.ok,true,JSON.stringify(next));assert.equal(next.template.version,2);});
test('static parser rejects active, rotated, form and oversize originals before storage',async t=>{const h=await fixture(t),rot=await PDFDocument.create();rot.addPage().setRotation(degrees(90));const cropped=await PDFDocument.create();cropped.addPage().setCropBox(10,10,200,200);const shifted=await PDFDocument.create();shifted.addPage().setMediaBox(10,10,300,300);const active=await PDFDocument.create();active.addPage();active.catalog.set(PDFName.of('OpenAction'),active.context.obj({S:PDFName.of('JavaScript'),JS:PDFString.of('app.alert(1)')}));const form=await PDFDocument.create();form.addPage();form.getForm().createTextField('name').addToPage(form.getPage(0));for(const b of[new TextEncoder().encode('not pdf'),new Uint8Array(await rot.save()),new Uint8Array(await cropped.save()),new Uint8Array(await shifted.save()),new Uint8Array(await active.save()),new Uint8Array(await form.save()),new Uint8Array(4194305)])assert.equal((await h.templateUpload(b)).response.status,400);assert.equal(h.state.storageUploads,0);});
test('mapped missing values, glyphs and overflow fail without unsigned source or any email',async t=>{const h=await prepared(t,[{...fields[0],key:'vehicle.vin'}]);assert.equal((await h.templateGenerate(h.template.id)).code,'invalid_input');const pdf=h.loader.load('@/lib/pdf-templates/pdf');for(const data of[{'customer.name':'李文'},{'customer.name':'W'.repeat(1000)},{'customer.name':'line\n'.repeat(50)}])await assert.rejects(pdf.fillPdfTemplate(await pdfFixture(),h.asset,[fields[0]],data,'2026-01-01T00:00:00Z'),e=>e.code==='invalid_input');assert.equal((await h.db.query('select count(*)::int n from private.uploaded_pdf_sources')).rows[0].n,0);assert.equal(h.state.providers.length,0);});
test('company, role, raw storage and private lineage cannot be bypassed; revoked actor cannot generate',async t=>{const h=await prepared(t);for(const table of['pdf_template_assets','pdf_template_versions','pdf_template_generations','pdf_template_source_lineage'])await assert.rejects(asRole(h.db,'authenticated',U,tx=>tx.query(`select * from private.${table}`)),e=>e.code==='42501');const foreign=await h.rpc('authenticated',V,'get_pdf_template_asset',{p_company_id:F,p_asset_id:ASSET});assert.equal(foreign.error.code,'42501');const serviceBypass=await h.rpc('authenticated',U,'register_pdf_template_document',{p_actor_id:U,p_company_id:C,p_source_id:GENERATE,p_sha256:'a'.repeat(64),p_byte_size:100,p_page_count:1});assert.equal(serviceBypass.error.code,'42501');await h.db.query("update public.memberships set role='viewer' where company_id=$1 and user_id=$2",[C,U]);assert.equal((await h.templateGenerate(h.template.id)).code,'access_denied');assert.equal(h.state.providers.length,0);});
test('post-render CAS rejects customer/vehicle/price change; archive rejects preparation; immutable originals and versions remain readable',async t=>{const h=await prepared(t),intent=await h.rpc('authenticated',U,'prepare_pdf_template_document',{p_company_id:C,p_deal_id:D,p_template_version_id:h.template.id,p_request_id:GENERATE,p_acknowledged:true});assert.equal(intent.error,null);const pdf=h.loader.load('@/lib/pdf-templates/pdf'),output=await pdf.fillPdfTemplate(await pdfFixture(),h.asset,fields,intent.data.data,intent.data.createdAt);const path=`${C}/uploaded-pdfs/${GENERATE}/original-${output.sha256}.pdf`;await h.worker.storage.from('uploaded-contracts').upload(path,output.bytes,{upsert:false,contentType:'application/pdf'});await h.db.query('update public.deals set sale_price_ore=300 where id=$1',[D]);const commit=await h.rpc('service_role',null,'register_pdf_template_document',{p_actor_id:U,p_company_id:C,p_source_id:GENERATE,p_sha256:output.sha256,p_byte_size:output.byteSize,p_page_count:output.pageCount});assert.equal(commit.error.code,'40001');await h.db.query('update public.deals set sale_price_ore=200 where id=$1',[D]);for(const query of["update public.customers set name='Changed buyer' where id='"+id(5)+"'","update public.vehicles set registration_number='NEW130' where id='"+id(9)+"'"]){await h.db.query(query);const r=await h.rpc('service_role',null,'register_pdf_template_document',{p_actor_id:U,p_company_id:C,p_source_id:GENERATE,p_sha256:output.sha256,p_byte_size:output.byteSize,p_page_count:output.pageCount});assert.equal(r.error.code,'40001');await h.db.query("update public.customers set name='Åsa Köpare' where id=$1",[id(5)]);}assert.equal((await h.db.query('select count(*)::int n from private.pdf_template_source_lineage')).rows[0].n,0);await assert.rejects(h.db.query("update private.pdf_template_versions set title='tampered'"),e=>e.code==='55000');await assert.rejects(h.db.query('delete from private.pdf_template_assets'),e=>e.code==='55000');});
test('preview route renders private original with labels; malformed, foreign-origin and oversized bodies fail',async t=>{const h=await prepared(t),url=`https://app.fixture.invalid/api/pdf-templates/preview?companyId=${C}`,request=body=>new h.NextRequest(url,{method:'POST',headers:{origin:'https://app.fixture.invalid','content-type':'application/json'},body});const preview=await h.templatePreviewRoute.POST(request(JSON.stringify({assetId:ASSET,fields})));assert.equal(preview.status,200);assert.match(preview.headers.get('content-type'),/application\/pdf/);assert.match(preview.headers.get('cache-control'),/no-store/);assert.equal((await PDFDocument.load(await preview.arrayBuffer())).getPageCount(),1);assert.equal((await h.templatePreviewRoute.POST(request('{'))).status,400);assert.equal((await h.templatePreviewRoute.POST(request('x'.repeat(65537)))).status,400);assert.equal((await h.templatePreviewRoute.POST(new h.NextRequest(url,{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:'{}'}))).status,403);});
test('archived deal denies generation while approved template read/list survives',async t=>{const h=await prepared(t),r=await h.rpc('authenticated',U,'get_deal_archive',{p_company_id:C,p_deal_id:D});assert.equal(r.error,null);assert.equal(r.data.canArchive,true);const a=await h.rpc('authenticated',U,'mutate_deal_archive',{p_company_id:C,p_deal_id:D,p_input:{companyId:C,dealId:D,operation:'archive',expectedVersion:r.data.version,reviewHash:r.data.reviewHash,reason:'Archived test deal',acknowledged:true,requestId:id(130)}});assert.equal(a.error,null);assert.equal(a.data.archived,true);assert.equal((await h.templateGenerate(h.template.id)).code,'access_denied');const listed=await h.templateActions.listPdfTemplateVersionsAction({companyId:C});assert.equal(listed.ok,true);assert.equal(listed.templates[0].id,h.template.id);});

test('a malformed generated document receipt remains uncertain and exact retry recovers the committed document',async t=>{
 const h=await prepared(t);
 const send=h.worker.rpc;
 h.worker.rpc=async(name,args)=>{
  const result=await send(name,args);
  return name==='register_pdf_template_document'&&!result.error
   ?{...result,data:{...result.data,pageCount:0}}:result;
 };
 assert.equal((await h.templateGenerate(h.template.id)).code,'unavailable');
 assert.equal((await h.db.query('select count(*)::int n from private.pdf_template_source_lineage')).rows[0].n,1);
 h.worker.rpc=send;
 const recovered=await h.templateGenerate(h.template.id);
 assert.equal(recovered.ok,true,JSON.stringify(recovered));
 assert.equal(recovered.source.id,GENERATE);
 assert.equal((await h.db.query('select count(*)::int n from private.pdf_template_source_lineage')).rows[0].n,1);
});

test('malformed committed template upload receipt stays uncertain and exact retry recovers one asset',async t=>{
 const h=await fixture(t),rpc=h.worker.rpc;
 let corrupt=true;
 h.worker.rpc=async(name,args)=>{const r=await rpc(name,args);return corrupt&&name==='register_pdf_template_asset'&&!r.error?{...r,data:{...r.data,pageCount:'invalid'}}:r;};
 const first=await h.templateUpload();
 assert.equal(first.response.status,503);
 assert.equal(first.result.code,'unavailable');
 assert.equal((await h.db.query('select count(*)::int n from private.pdf_template_assets')).rows[0].n,1);
 corrupt=false;
 const recovered=await h.templateUpload();
 assert.equal(recovered.response.status,200);
 assert.equal(recovered.result.asset.id,ASSET);
 assert.equal((await h.db.query('select count(*)::int n from private.pdf_template_assets')).rows[0].n,1);
 assert.equal(h.state.objects.size,1);
 assert.equal(h.state.providers.length,0);
});
