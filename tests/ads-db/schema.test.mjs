import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,asRole,runSqlTests} from './helpers.mjs';
const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C=id(1),C2=id(2),S=id(3),S2=id(4),V=id(5),V2=id(6);
const U={owner:id(11),admin:id(12),sales:id(13),finance:id(14),viewer:id(15),other:id(16),pending:id(17),banned:id(18)};
export async function rpc(db,user,name,args={},role='authenticated'){
 assert.match(name,/^[a-z_]+$/);const entries=Object.entries(args);for(const [key]of entries)assert.match(key,/^p_[a-z_]+$/);
 return asRole(db,role,user,async tx=>(await tx.query(`select public.${name}(${entries.map(([key],n)=>`${key}=>$${n+1}`).join(',')}) result`,entries.map(([,value])=>value))).rows[0].result);
}
const denied=(f,code)=>assert.rejects(f,e=>{assert.equal(e.code,code,e.message);return true;});
async function fixture({includeSigningArchive=true}={}){
 const db=await createDatabase({includeSigningArchive});
 for(const[name,user]of Object.entries(U))await db.query("insert into auth.users(id,email,email_confirmed_at,banned_until)values($1,$2,case when $3 then null else now() end,case when $4 then now()+interval '1 day' else null end)",[user,`${name}@example.test`,name==='pending',name==='banned']);
 await db.query("insert into public.companies(id,name,organisation_number,created_by)values($1,'Ads Company','1234567890',$3),($2,'Other Company','1234567891',$4)",[C,C2,U.owner,U.other]);
 for(const role of ['owner','admin','sales','finance','viewer'])await db.query('insert into public.memberships(company_id,user_id,role)values($1,$2,$3)',[C,U[role],role]);
 await db.query("insert into public.memberships(company_id,user_id,role)values($1,$2,'owner')",[C2,U.other]);
 await db.query("insert into public.vehicles(id,company_id,registration_number,vin,make,model,model_year,mileage_km)values($1,$3,'ABC123','SECRET-VIN','Volvo','V60',2022,12000),($2,$4,'XYZ123','OTHER-VIN','Saab','95',2010,240000)",[V,V2,C,C2]);
 await db.query("insert into public.stock_items(id,company_id,vehicle_id,purchase_price_ore,asking_price_ore,vat_scheme)values($1,$3,$5,11111111,29990000,'standard'),($2,$4,$6,22222222,19990000,'unknown')",[S,S2,C,C2,V,V2]);
 // Existing ad lifecycle cases now submit a reviewed configured fee, never the legacy unpriced API.
 for(const company of [C,C2])for(const channel of ['blocket','wayke'])await db.query("insert into private.advertising_channel_rates(company_id,channel,version,unit_price_ore,created_by,request_id,payload)values($1,$2,1,1000,$3,$4,'{}')",[company,channel,U.owner,randomUUID()]);
 return db;
}
async function photo(db,{user=U.owner,stock=S,company=C,photoId=randomUUID(),size=12,mime='image/jpeg',ownerId=user,owner=null,request=randomUUID(),upload=true}={}){
 const ext=mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp';const path=`${company}/${stock}/${photoId}.${ext}`;
 if(upload)await asRole(db,'authenticated',user,tx=>tx.query("insert into storage.objects(bucket_id,name,metadata,owner_id,owner)values('ads-vehicle-photos',$1,$2,$3,$4)",[path,{size,mimetype:mime},ownerId,owner]));
 return rpc(db,user,'register_vehicle_photo',{p_company_id:company,p_stock_id:stock,p_photo_id:photoId,p_object_path:path,p_content_type:mime,p_size_bytes:size,p_request_id:request});
}
async function save(db,{user=U.owner,listingId=randomUUID(),version=0,photoIds=[],stock=S,company=C,title='Volvo V60',description='Fin bil\nRedo för leverans',optin=false,request=randomUUID()}={}){
 return rpc(db,user,'save_vehicle_advertisement',{p_company_id:company,p_stock_id:stock,p_listing_id:listingId,p_expected_version:version,p_title:title,p_description:description,p_photo_ids:photoIds,p_include_registration_number:optin,p_request_id:request});
}
const ready=(db,l,request=randomUUID(),user=U.owner)=>rpc(db,user,'mark_vehicle_advertisement_ready',{p_company_id:l.companyId,p_listing_id:l.id,p_expected_version:l.version,p_request_id:request});
const reviewedTokens=new WeakMap();
async function send(db,l,{user=U.owner,channels=['blocket'],request=randomUUID()}={}){
 const args={p_company_id:l.companyId,p_listing_id:l.id,p_expected_version:l.version,p_channels:channels};
 if(!reviewedTokens.has(db))reviewedTokens.set(db,new Map());
 const tokens=reviewedTokens.get(db),key=JSON.stringify({user,request,...args});
 if(!tokens.has(key))tokens.set(key,(await rpc(db,user,'get_advertising_send_quote',args)).reviewToken);
 return rpc(db,user,'send_vehicle_advertisement_priced',{...args,p_request_id:request,p_expected_quote_token:tokens.get(key)});
}
async function approved(db,channels=['blocket']){
 for(const channel of channels){
  await rpc(db,null,'refresh_advertising_dispatcher',{p_dispatcher_id:`${channel}-main`,p_channel:channel,p_available_until:new Date(Date.now()+240000).toISOString()},'service_role');
  await db.query("insert into private.advertising_connections(company_id,channel,account_reference,status,dispatcher_id,created_by)values($1,$2,$3,'verified',$4,$5)",[C,channel,`approved-${channel}`,`${channel}-main`,U.owner]);
 }
}
async function prepared(db){const p=(await photo(db)).photo;const l=(await save(db,{photoIds:[p.id]})).listing;return(await ready(db,l)).listing;}
const claim=(db,j,{version=j.version,token=randomUUID()}={})=>rpc(db,null,'claim_advertising_job',{p_job_id:j.id,p_expected_version:version,p_claim_token:token},'service_role');
const outcome=(db,j,status,args={})=>rpc(db,null,'save_advertising_job',{p_job_id:j.id,p_expected_version:j.version,p_claim_token:j.claimToken,p_status:status,...args},'service_role');

test('actual migration chain rollback permission contract',async()=>{await runSqlTests();});
test('all active roles read sanitized data, write gates and tenant isolation',async()=>{
 const db=await fixture();try{
  for(const role of ['owner','admin','sales','finance','viewer'])assert.equal((await rpc(db,U[role],'list_advertising_stock',{p_company_id:C})).stock.length,1);
  for(const user of [U.other,U.pending,U.banned])await denied(()=>rpc(db,user,'list_company_advertising',{p_company_id:C}),'42501');
  for(const role of ['anon','service_role'])await denied(()=>rpc(db,U.owner,'list_company_advertising',{p_company_id:C},role),'42501');
  for(const user of [U.finance,U.viewer])await denied(()=>save(db,{user}),'42501');
  for(const table of ['vehicle_photos','advertising_listings','advertising_versions','advertising_connections','advertising_jobs','advertising_audit'])await denied(()=>asRole(db,'authenticated',U.owner,tx=>tx.query(`select * from private.${table}`)),'42501');
  await denied(()=>rpc(db,U.owner,'list_advertising_stock',{p_company_id:C,p_limit:51}),'22023');
  const l=(await save(db,{user:U.sales})).listing;assert.equal(l.snapshot.priceGrossOre,'29990000');assert.equal(l.snapshot.registrationNumber,null);assert.equal(l.snapshot.includeRegistrationNumber,false);
  const exported=JSON.stringify(l);assert.ok(!exported.includes('SECRET-VIN'));assert.ok(!exported.includes('11111111'));assert.ok(!exported.includes('ABC123'));assert.ok(!exported.includes('purchase_price'));assert.ok(!exported.includes('customer'));
  const changed=(await save(db,{listingId:l.id,version:1,optin:true})).listing;assert.equal(changed.snapshot.registrationNumber,'ABC123');
  await denied(()=>save(db,{listingId:l.id,version:2,stock:S2}),'42501');
 }finally{await db.close();}
});
test('photo object/private catalog/owner/mime/size binding and exact nonce replay',async()=>{
 const db=await fixture();try{
  const pid=randomUUID(),request=randomUUID();const a=await photo(db,{photoId:pid,request});assert.equal(a.photo.storageVisibility,'private');assert.equal(a.photo.status,'active');assert.equal(a.actorUserId,U.owner);
  assert.deepEqual(await photo(db,{photoId:pid,request,upload:false}),a);
  await denied(()=>photo(db,{photoId:pid,upload:false}),'40001');
  await denied(()=>photo(db,{photoId:randomUUID(),upload:false}),'42501');
  await denied(()=>photo(db,{size:10485761}),'22023');
  await denied(()=>photo(db,{ownerId:U.owner,owner:U.other}),'42501');
  await denied(()=>photo(db,{ownerId:null,owner:null}),'42501');
  const legacy=await photo(db,{ownerId:null,owner:U.owner});assert.equal(legacy.photo.sizeBytes,12);
  const mismatch=randomUUID(),path=`${C}/${S}/${mismatch}.jpg`;await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata)values('ads-vehicle-photos',$1,$2,'{\"size\":20,\"mimetype\":\"image/jpeg\"}')",[path,U.owner]);
  await denied(()=>photo(db,{photoId:mismatch,upload:false}),'42501');
  await db.query("update storage.buckets set public=true where id='ads-vehicle-photos'");await denied(()=>rpc(db,U.viewer,'get_vehicle_photo',{p_company_id:C,p_photo_id:pid}),'42501');
 }finally{await db.close();}
});
test('storage scope, private orphan retention and immutable registered/archived image objects',async()=>{
 const db=await fixture();try{
  const p=(await photo(db)).photo;assert.equal((await rpc(db,U.viewer,'list_vehicle_photos',{p_company_id:C,p_stock_id:S})).photos.length,1);
  await denied(()=>photo(db,{user:U.viewer}),'42501');await denied(()=>photo(db,{user:U.other,company:C,stock:S}),'42501');
  assert.equal((await asRole(db,'authenticated',U.owner,tx=>tx.query("update storage.objects set metadata='{}' where name=$1 returning id",[p.objectPath]))).rows.length,0);
  assert.equal((await asRole(db,'authenticated',U.owner,tx=>tx.query('delete from storage.objects where name=$1 returning id',[p.objectPath]))).rows.length,0);
  const orphan=`${C}/${S}/${randomUUID()}.png`;await asRole(db,'authenticated',U.owner,tx=>tx.query("insert into storage.objects(bucket_id,name,metadata,owner_id)values('ads-vehicle-photos',$1,'{}',$2)",[orphan,U.owner]));
  assert.equal((await asRole(db,'authenticated',U.owner,tx=>tx.query('delete from storage.objects where name=$1 returning id',[orphan]))).rows.length,0);
  await denied(()=>asRole(db,'authenticated',U.owner,tx=>tx.query("insert into storage.objects(bucket_id,name,metadata,owner_id)values('ads-vehicle-photos',$1,'{}',$2) on conflict(bucket_id,name) do update set metadata=excluded.metadata",[orphan,U.owner])),'42501');
  const archived=await rpc(db,U.sales,'archive_vehicle_photo',{p_company_id:C,p_photo_id:p.id,p_expected_version:1,p_request_id:randomUUID()});assert.equal(archived.photo.status,'archived');assert.equal(archived.photo.version,2);
  assert.equal((await rpc(db,U.viewer,'list_vehicle_photos',{p_company_id:C,p_stock_id:S})).photos.length,0);assert.equal((await rpc(db,U.viewer,'get_vehicle_photo',{p_company_id:C,p_photo_id:p.id})).status,'archived');
  assert.equal((await asRole(db,'authenticated',U.owner,tx=>tx.query('delete from storage.objects where name=$1 returning id',[p.objectPath]))).rows.length,0);
  await denied(()=>db.query('delete from private.vehicle_photos where id=$1',[p.id]),'55000');
 }finally{await db.close();}
});
test('photo20 cap, immutable versions, ready requirements and stale stock snapshots',async()=>{
 const db=await fixture();try{
  const all=[];for(let i=0;i<20;i++)all.push((await photo(db)).photo);
  await denied(()=>photo(db),'22023');
  const empty=(await save(db)).listing;await denied(()=>ready(db,empty),'40001');
  const draft=(await save(db,{listingId:empty.id,version:1,photoIds:[all[0].id]})).listing;
  const published=(await ready(db,draft)).listing;assert.equal(published.version,3);assert.equal(published.status,'ready');assert.deepEqual(draft.snapshot,published.snapshot);
  await denied(()=>ready(db,published),'40001');
  await denied(()=>db.query("update private.advertising_versions set snapshot='{}'"),'55000');
  await db.query('update public.stock_items set asking_price_ore=asking_price_ore+1 where id=$1',[S]);await denied(()=>send(db,published),'40001');
  await db.query('update public.stock_items set asking_price_ore=asking_price_ore-1,status=\'reserved\' where id=$1',[S]);await denied(()=>send(db,published),'40001');
  await db.query("update public.stock_items set status='available' where id=$1",[S]);
  await rpc(db,U.owner,'archive_vehicle_photo',{p_company_id:C,p_photo_id:all[0].id,p_expected_version:1,p_request_id:randomUUID()});await denied(()=>send(db,published),'42501');
  const stored=(await db.query('select snapshot from private.advertising_versions where listing_id=$1 and version=3',[published.id])).rows[0].snapshot;assert.equal(stored.photos[0].status,'active');
 }finally{await db.close();}
});
test('connection requested is not verified, no dispatcher means no durable fake queue and retry after provisioning',async()=>{
 const db=await fixture();try{
  for(const user of [U.sales,U.finance,U.viewer])await denied(()=>rpc(db,user,'request_advertising_connection',{p_company_id:C,p_channel:'blocket',p_account_reference:'my-account',p_request_id:randomUUID()}),'42501');
  const connection=await rpc(db,U.admin,'request_advertising_connection',{p_company_id:C,p_channel:'blocket',p_account_reference:'my-account',p_request_id:randomUUID()});assert.equal(connection.connection.status,'requested');assert.equal(connection.connection.dispatcherAvailable,false);
  const l=await prepared(db);const request=randomUUID();const absent=await send(db,l,{request});assert.equal(absent.status,'connection_required');assert.deepEqual(absent.jobs,[]);
  assert.equal((await db.query('select count(*)::int n from private.advertising_jobs')).rows[0].n,0);
  await rpc(db,null,'refresh_advertising_dispatcher',{p_dispatcher_id:'blocket-main',p_channel:'blocket',p_available_until:new Date(Date.now()+240000).toISOString()},'service_role');
  await db.query("update private.advertising_connections set status='verified',dispatcher_id='blocket-main',version=version+1 where company_id=$1",[C]);
  const queued=await send(db,l,{request});assert.equal(queued.status,'queued');assert.equal(queued.jobs.length,1);assert.equal(queued.jobs[0].status,'queued');assert.equal(queued.jobs[0].providerUrl,null);
  assert.deepEqual(await send(db,l,{request}),queued);
  await denied(()=>send(db,l,{request,channels:['wayke']}),'40001');
  assert.equal((await send(db,l)).jobs[0].id,queued.jobs[0].id);
 }finally{await db.close();}
});
test('atomic multi-channel enqueue and account/version uniqueness',async()=>{
 const db=await fixture();try{
  const l=await prepared(db);await approved(db,['blocket']);const missing=await send(db,l,{channels:['blocket','wayke']});assert.equal(missing.status,'connection_required');assert.equal((await db.query('select count(*)::int n from private.advertising_jobs')).rows[0].n,0);
  await approved(db,['wayke']);const request=randomUUID();const queued=await send(db,l,{channels:['wayke','blocket'],request});assert.deepEqual(await send(db,l,{channels:['blocket','wayke'],request}),queued);assert.equal(queued.jobs.length,2);assert.deepEqual(queued.jobs.map(j=>j.channel),['blocket','wayke']);
  await denied(()=>send(db,l,{channels:['blocket','blocket']}),'22023');
  await denied(()=>db.query("update private.advertising_jobs set account_reference='forged'"),'55000');
  const processing=await claim(db,queued.jobs[0]);await denied(()=>send(db,l,{channels:['blocket','wayke']}),'40001');
  const user=(await rpc(db,U.viewer,'get_stock_advertising',{p_company_id:C,p_stock_id:S})).jobs.find(j=>j.id===processing.id);assert.equal(user.claimToken,null);assert.equal(user.status,'dispatching');
 }finally{await db.close();}
});
test('worker claims one winner, exact CAS/token, uncertain/submitted never resend, published requires receipt',async()=>{
 const db=await fixture();try{
  const l=await prepared(db);await approved(db);const j=(await send(db,l)).jobs[0];
  await denied(()=>rpc(db,U.owner,'claim_advertising_job',{p_job_id:j.id,p_expected_version:1,p_claim_token:randomUUID()}),'42501');
  const contenders=await Promise.allSettled([claim(db,j),claim(db,j)]);assert.equal(contenders.filter(x=>x.status==='fulfilled').length,1);assert.equal(contenders.find(x=>x.status==='rejected').reason.code,'40001');
  const leased=contenders.find(x=>x.status==='fulfilled').value;assert.equal(leased.version,2);assert.ok(leased.claimToken);assert.equal(leased.status,'dispatching');
  await denied(()=>outcome(db,leased,'published',{p_provider_ad_id:'real-ad',p_claim_token:randomUUID()}),'40001');
  const unknown=await outcome(db,leased,'outcome_unknown',{p_error_code:'transport_uncertain'});assert.equal(unknown.version,3);assert.equal(unknown.claimToken,null);
  await denied(()=>claim(db,unknown),'40001');await denied(()=>outcome(db,unknown,'retryable'),'40001');
  const submitted=await outcome(db,unknown,'submitted',{p_error_code:'provider_status_pending'});assert.equal(submitted.providerAdId,null);await denied(()=>claim(db,submitted),'40001');
  await denied(()=>outcome(db,submitted,'published'),'22023');
  await denied(()=>outcome(db,submitted,'published',{p_provider_ad_id:'remote-ad',p_provider_url:'https://evil.test/blocket.se/'}),'22023');
  const published=await outcome(db,submitted,'published',{p_provider_ad_id:'remote-ad',p_provider_url:'https://www.blocket.se/annons/ad'});assert.equal(published.status,'published');
  assert.deepEqual(await outcome(db,published,'published',{p_provider_ad_id:'remote-ad',p_provider_url:'https://www.blocket.se/annons/ad'}),published);
  await denied(()=>outcome(db,published,'submitted',{p_provider_ad_id:'remote-ad'}),'40001');
  assert.equal((await db.query('select count(*)::int n from private.advertising_job_events where job_id=$1',[j.id])).rows[0].n,5);
  await denied(()=>db.query('delete from private.advertising_job_events'),'55000');
 }finally{await db.close();}
});
test('worker claim rechecks current stock/company/member/connection and lease expiry never grants resend',async()=>{
 const db=await fixture();try{
  const l=await prepared(db);await approved(db);const j=(await send(db,l)).jobs[0];
  await db.query("update public.companies set status='suspended' where id=$1",[C]);await denied(()=>claim(db,j),'42501');await db.query("update public.companies set status='active' where id=$1",[C]);
  await db.query("update public.memberships set status='suspended' where company_id=$1 and user_id=$2",[C,U.owner]);await denied(()=>claim(db,j),'42501');await db.query("update public.memberships set status='active' where company_id=$1 and user_id=$2",[C,U.owner]);
  await db.query("update public.stock_items set asking_price_ore=asking_price_ore+1 where id=$1",[S]);await denied(()=>claim(db,j),'40001');await db.query("update public.stock_items set asking_price_ore=asking_price_ore-1 where id=$1",[S]);
  await db.query('update private.advertising_connections set version=version+1 where company_id=$1',[C]);await denied(()=>claim(db,j),'40001');await db.query('update private.advertising_connections set version=version-1 where company_id=$1',[C]);
  const leased=await claim(db,j);await denied(()=>rpc(db,null,'expire_advertising_dispatch',{p_job_id:j.id,p_expected_version:2},'service_role'),'40001');
  await db.query("update private.advertising_jobs set claim_expires_at=clock_timestamp()-interval '1 second' where id=$1",[j.id]);
  const expired=await rpc(db,null,'expire_advertising_dispatch',{p_job_id:j.id,p_expected_version:2},'service_role');assert.equal(expired.status,'outcome_unknown');await denied(()=>claim(db,expired),'40001');
 }finally{await db.close();}
});
test('module applies without the pending signing/archive migrations and readiness defaults empty',async()=>{
 const db=await fixture({includeSigningArchive:false});try{const l=await prepared(db);assert.equal((await send(db,l)).status,'connection_required');assert.equal((await db.query('select count(*)::int n from private.advertising_dispatchers')).rows[0].n,0);}finally{await db.close();}
});

test('provider export bucket remains private, clients cannot read/upload/remove export media',async()=>{
 const db=await fixture();try{
  const path=`${C}/${S}/${randomUUID()}.jpg`;
  await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata)values('ads-export-media',$1,$2,'{\"size\":12,\"mimetype\":\"image/jpeg\"}')",[path,U.owner]);
  const rows=await asRole(db,'authenticated',U.owner,tx=>tx.query("select id from storage.objects where bucket_id='ads-export-media'"));assert.equal(rows.rows.length,0);
  await denied(()=>asRole(db,'authenticated',U.owner,tx=>tx.query("insert into storage.objects(bucket_id,name,owner_id)values('ads-export-media',$1,$2)",[`${C}/${S}/${randomUUID()}.jpg`,U.owner])),'42501');
  assert.equal((await asRole(db,'authenticated',U.owner,tx=>tx.query("delete from storage.objects where bucket_id='ads-export-media' returning id"))).rows.length,0);
 }finally{await db.close();}
});
