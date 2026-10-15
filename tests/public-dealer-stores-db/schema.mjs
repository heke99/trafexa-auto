import assert from 'node:assert/strict';
import{readFile}from 'node:fs/promises';
import {before,test}from 'node:test';
import{bootstrap,sql,session,id,owner,admin,foreign,sales,finance,viewer,pending,company,otherCompany,listing,photo,stock,seed,asRole,publishCall,publish,withdrawCall,withdraw,page,photoMetadata,objects,waitForLock}from './helpers.mjs';
before(bootstrap);
test('hosted-safe proof rolls back all synthetic users, publication and storage metadata',async()=>{
 sql(await readFile(new URL('../../supabase/tests/public_dealer_stores.sql',import.meta.url),'utf8'));
 const cleanup=JSON.parse(sql(await readFile(new URL('../../supabase/tests/public_dealer_stores_cleanup.sql',import.meta.url),'utf8')));
 assert.equal(Object.keys(cleanup).length,9);assert.ok(Object.values(cleanup).every(n=>n===0));
});
test('all dealers default private; publication exposes only explicit contact and listing whitelist',()=>{
 seed();assert.equal(page(),null);assert.deepEqual(objects(),[]);assert.equal(photoMetadata(),null);
 const receipt=publish();assert.equal(receipt.store.version,1);assert.equal(receipt.store.status,'published');
 const out=page();assert.equal(out.shop.displayName,'Opted-in public shop');assert.equal(out.listings.length,1);assert.equal(out.listings[0].id,listing);assert.equal(out.listings[0].priceOre,'25000000');
 assert.equal(out.listings[0].photos[0].id,photo);assert.equal(objects().length,1);assert.equal(photoMetadata().contentType,'image/jpeg');
 assert.doesNotMatch(JSON.stringify(out),/companyId|stockId|registration|QAZ001|purchase|1234567|createdBy|actor|objectPath|storageBucket/);
 assert.equal(photoMetadata(id(502)),null);assert.equal(photoMetadata(id(503)),null);assert.equal(page('missing-shop'),null);
 assert.equal(sql("select public from storage.buckets where id='ads-vehicle-photos'"),'f');
});
test('owner/admin only private manager API and direct tables deny anon/service/every ordinary role',()=>{
 seed();publish({},admin);
 for(const user of[foreign,sales,finance,viewer,pending])for(const call of[publishCall({nonce:id(905)}),withdrawCall(),`select public.get_company_public_store('${company}')`])assert.throws(()=>asRole('authenticated',user,call),/denied|required/);
 for(const role of['anon','service_role'])for(const call of[publishCall(),withdrawCall(),`select public.get_company_public_store('${company}')`])assert.throws(()=>asRole(role,null,call),/permission denied/);
 for(const role of['anon','authenticated','service_role'])for(const table of['public_dealer_stores','public_dealer_store_versions','public_dealer_store_audit'])assert.throws(()=>asRole(role,owner,`select *from private.${table}`),/permission denied/);
 assert.equal(sql("select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('get_company_public_store','publish_company_public_store','unpublish_company_public_store','get_public_dealer_store','get_public_store_photo')and p.prosecdef"),'0');
});
test('withdraw instantly removes store and photo access; immutable slug and historical nonce remain exact',()=>{
 seed();const first=publish(),off=withdraw();assert.equal(page(),null);assert.deepEqual(objects(),[]);assert.equal(photoMetadata(),null);
 assert.deepEqual(publish(),first);assert.deepEqual(withdraw(),off);assert.equal(page(),null);
 assert.throws(()=>publish({version:2,slug:'changed-slug',nonce:id(903)}),/immutable/);
 const restored=publish({version:2,nonce:id(903)});assert.equal(restored.store.version,3);assert.equal(objects().length,1);
 assert.throws(()=>publish({version:2,nonce:id(903),listings:[]}),/request conflict/);
 assert.equal(sql('select count(*)from private.public_dealer_store_audit'),'3');
 for(const table of['public_dealer_store_versions','public_dealer_store_audit'])assert.throws(()=>sql(`delete from private.${table}`),/immutable/);
 assert.throws(()=>sql('delete from private.public_dealer_stores'),/cannot be deleted/);
});
test('public profile freezes until explicit republish; current legal identity and company state fail closed',()=>{
 seed();publish();
 sql(`insert into private.company_store_profile_versions(company_id,version,fields,created_by)select company_id,2,fields||'{"displayName":"PRIVATE pending edit"}','${owner}'from private.company_store_profile_versions where company_id='${company}';update private.company_store_profile_heads set profile_id=(select id from private.company_store_profile_versions where company_id='${company}'and version=2),profile_version=2 where company_id='${company}';`);
 assert.equal(page().shop.displayName,'Opted-in public shop');assert.throws(()=>publish({version:1,nonce:id(903)}),/Profile version conflict/);
 publish({version:1,profileVersion:2,nonce:id(903)});assert.equal(page().shop.displayName,'PRIVATE pending edit');
 sql(`update public.companies set name='Legal changed'where id='${company}'`);assert.equal(page(),null);assert.deepEqual(objects(),[]);
 sql(`update public.companies set name='Public store legal A',status='suspended'where id='${company}'`);assert.equal(page(),null);
});
test('sold or reserved stock, newer/draft listing, archived/versioned photo and changed source values hide listings AND bytes',()=>{
 const cases=[`update public.stock_items set status='sold'where id='${stock}'`,`update public.stock_items set status='reserved'where id='${stock}'`,`update private.advertising_listings set version=3 where id='${listing}'`,`update private.advertising_listings set status='draft',version=3 where id='${listing}'`,`update private.vehicle_photos set status='archived',version=2,archived_at=clock_timestamp()where id='${photo}'`,`update public.stock_items set asking_price_ore=26000000 where id='${stock}'`];
 for(const change of cases){seed();publish();sql(change);assert.equal(page().listings.length,0);assert.equal(photoMetadata(),null);assert.deepEqual(objects(),[]);}
});
test('source/profile/selection CAS and reserved slugs reject atomically; empty shop selection allowed',()=>{
 seed();for(const options of[{slug:'api'},{slug:'UPPER'},{ack:false},{profileVersion:2},{listings:[{listingId:id(603),version:2}]},{listings:[{listingId:listing,version:1}]},{listings:[{listingId:listing,version:2},{listingId:listing,version:2}]},{listings:[{listingId:listing,version:2,secret:'x'}]}])assert.throws(()=>publish(options),/Invalid|Duplicate|conflict/);
 assert.equal(sql('select count(*)from private.public_dealer_stores'),'0');
 publish({listings:[]});assert.equal(page().listings.length,0);assert.deepEqual(objects(),[]);
 assert.throws(()=>publish({nonce:id(903)}),/version conflict/);
 assert.throws(()=>publish({companyId:otherCompany,slug:'public-shop-a',listings:[],nonce:id(903)},foreign),/slug or nonce conflict/);
});
test('revoked approval/membership and audit failure prevent writes or receipt replay without private leaks',()=>{
 seed();publish();sql(`update private.account_approvals set status='suspended'where user_id='${owner}'`);assert.throws(()=>publish(),/denied|required/);assert.throws(()=>withdraw(),/denied|required/);
 sql(`update private.account_approvals set status='approved'where user_id='${owner}';update public.memberships set status='suspended'where company_id='${company}'and user_id='${owner}'`);assert.throws(()=>withdraw(),/denied/);
 seed();sql(`create function private.public_store_fixture_audit_failure()returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure';end$$;create trigger public_store_fixture_audit_failure before insert on private.public_dealer_store_audit for each row execute function private.public_store_fixture_audit_failure()`);
 try{assert.throws(()=>publish(),/Synthetic audit failure/);assert.equal(sql('select count(*)from private.public_dealer_stores'),'0');assert.equal(sql('select count(*)from private.public_dealer_store_versions'),'0');}finally{sql('drop trigger public_store_fixture_audit_failure on private.public_dealer_store_audit;drop function private.public_store_fixture_audit_failure()');}
});
test('two real SQL sessions serialize identical nonce retries into one immutable publication',async()=>{
 seed();const a=session('nonce_a'),b=session('nonce_b');
 try{await Promise.all([a.ready(),b.ready()]);const begin=`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';`;
 const first=JSON.parse(await a.query(`${begin}${publishCall()};`));const waiting=b.query(`${begin}${publishCall()};commit;`);await waitForLock('nonce_b');await a.query('commit;');
 assert.deepEqual(JSON.parse(await waiting),first);assert.equal(sql('select count(*)from private.public_dealer_stores'),'1');assert.equal(sql('select count(*)from private.public_dealer_store_versions'),'1');assert.equal(sql('select count(*)from private.public_dealer_store_audit'),'1');
 }finally{a.close();b.close();}
});
test('different companies racing a public slug cannot share or steal its publication',async()=>{
 seed();const a=session('slug_a'),b=session('slug_b');
 try{await Promise.all([a.ready(),b.ready()]);await a.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';${publishCall()};`);
 const waiting=b.query(`begin;set local role authenticated;set local request.jwt.claim.sub='${foreign}';${publishCall({companyId:otherCompany,listings:[],nonce:id(903)})};commit;`);
 const rejection=assert.rejects(waiting,/slug or nonce conflict/);await waitForLock('slug_b');await a.query('commit;');await rejection;
 assert.equal(page().shop.legalName,'Public store legal A');assert.equal(sql('select count(*)from private.public_dealer_stores'),'1');
 }finally{a.close();b.close();}
});
test('public byte policy also works for logged-in visitors but never allows anonymous upload or mutation',()=>{
 seed();publish();const visible=JSON.parse(asRole('authenticated',foreign,"select coalesce(jsonb_agg(name),'[]')from storage.objects"));assert.equal(visible.length,2,'Foreign owner sees one deliberately public photo plus own private photo');
 assert.throws(()=>asRole('anon',null,"insert into storage.objects(bucket_id,name)values('ads-vehicle-photos','forged')"),/row-level security/);
 assert.equal(asRole('anon',null,"with gone as(delete from storage.objects returning id)select count(*)from gone"),'0');
});
