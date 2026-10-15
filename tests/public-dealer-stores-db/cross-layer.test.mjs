// Actual server actions/context/parsers → complete migrated SQL in PGlite.
// Only Supabase I/O and selected-company routing are adapted. This proves no
// hosted Auth delivery, browser interaction or concurrent PostgreSQL locking.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {before, beforeEach, after, test} from 'node:test';
import {createDatabase, asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader} from '../helpers/source-loader.mjs';

const id=n=>`fd200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const OWNER=id(1), ADMIN=id(2), OTHER=id(3), SALES=id(4), COMPANY=id(101), FOREIGN=id(102), LISTING=id(601), PHOTO=id(501);
const fixture=(await readFile(new URL('../../supabase/tests/public_dealer_stores.sql',import.meta.url),'utf8')).split('-- BEGIN PUBLIC STORE FIXTURES')[1].split('-- END PUBLIC STORE FIXTURES')[0];
let database, imageBytes;
const previousUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,previousKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL='https://public-store.fixture.invalid';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-public-key';
before(async()=>{database=await createDatabase({approveEstablishedFixtures:false});imageBytes=await sharp({create:{width:2,height:2,channels:3,background:'#174a52'}}).jpeg().toBuffer();});
beforeEach(async()=>{await database.exec(`begin;truncate auth.users,storage.objects cascade;${fixture.replace('create function pg_temp.public_store_fields()','create or replace function pg_temp.public_store_fields()').replaceAll("'image/jpeg',100,",`'image/jpeg',${imageBytes.length},`).replaceAll('"size":100',`"size":${imageBytes.length}`)}commit;`);});
after(async()=>{await database?.close();
if(previousUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=previousUrl;
if(previousKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=previousKey;});

async function integration({actor=OWNER, company=COMPANY}={}) {
  const state={actor, company, authenticated:true, calls:[], errors:[], invalidations:[], loseReceipt:null};
  const db={
    auth:{async getUser() {
      state.calls.push(['auth']);
      const user=state.authenticated ? (await database.query('select id,email,email_confirmed_at::text,is_anonymous from auth.users where id=$1',[state.actor])).rows[0] : null;
      return {data:{user:user??null},error:null};
    }},
    from(table) {
      assert.equal(table,'memberships');
      const filters={}, query={select(){return query;},eq(key,value){filters[key]=value;return query;},async maybeSingle(){
        const data=await asRole(database,'authenticated',state.actor,async tx=>{
          const {rows}=await tx.query(`select m.*,jsonb_build_object('id',c.id,'status',c.status) companies
            from public.memberships m join public.companies c on c.id=m.company_id
            where m.company_id=$1 and m.user_id=$2 and m.status=$3 and c.status=$4`,
          [filters.company_id,filters.user_id,filters.status,filters['companies.status']]);
          return rows[0]??null;
        });
        state.calls.push(['membership']);return {data,error:null};
      }};return query;
    },
    rpc(name,args) {
      const work=(async()=>{
      assert.match(name,/^(get_account_access|get_company_public_store|publish_company_public_store|unpublish_company_public_store)$/);
      state.calls.push(['rpc',name,structuredClone(args)]);
      try {
        const entries=Object.entries(args);
        assert.ok(entries.every(([key])=>/^p_[a-z_][a-z_0-9]*$/.test(key)));
        const params=entries.map(([key],i)=>`${key} => $${i+1}`).join(',');
        const data=await asRole(database,'authenticated',state.actor,async tx=>(await tx.query(`select public.${name}(${params}) result`,entries.map(([,value])=>value))).rows[0].result);
        if(state.afterRpc) await state.afterRpc(name);
        if(state.loseReceipt===name){state.loseReceipt=null;return {data:null,error:{code:'FIXTURE_NETWORK',message:'PRIVATE lost response'}};}
        return {data,error:null};
      }catch(error){state.errors.push({code:error.code,message:error.message});return {data:null,error:{code:error.code,message:'PRIVATE database details'}};}
      })();work.abortSignal=()=>work;return work;
    },
  };
  const anon={rpc(name,args){assert.ok(['get_public_dealer_store','get_public_store_photo'].includes(name));return (async()=>{
    const entries=Object.entries(args),params=entries.map(([k],i)=>`${k} => $${i+1}`).join(',');
    try{return {data:await asRole(database,'anon',null,async tx=>(await tx.query(`select public.${name}(${params}) result`,entries.map(([,v])=>v))).rows[0].result),error:null};}
    catch(error){return {data:null,error:{code:error.code,message:'PRIVATE anon database error'}};}
  })();},storage:{from(bucket){assert.equal(bucket,'ads-vehicle-photos');return {async download(path){
    const permitted=await asRole(database,'anon',null,async tx=>(await tx.query('select name from storage.objects where bucket_id=$1 and name=$2',[bucket,path])).rows.length===1);
    state.downloads=(state.downloads??0)+1;
    if(state.onDownload)await state.onDownload();
    return permitted?{data:new Blob([imageBytes],{type:'image/jpeg'}),error:null}:{data:null,error:{code:'DENIED'}};
  }};}}};
  const loader=await createSourceLoader({
    '@supabase/supabase-js':{createClient(url,key,options){assert.equal(options.auth.persistSession,false);assert.equal(options.auth.autoRefreshToken,false);assert.equal(options.auth.detectSessionInUrl,false);return anon;}},
    'next/cache':{revalidatePath:path=>state.invalidations.push(path)},
    'next/headers':{async cookies(){return {set(){throw new Error('Public store must not choose a company cookie');}};}},
    '@/lib/supabase/server':{async createServerSupabaseClient(){return db;}},
    '@/lib/data/company-context':{async getActiveCompanyContext(){return {db,company:state.company,user:state.actor,role:'owner'};}},
  });
  return {state,actions:loader.load('@/lib/public-dealer-store/actions'),public:loader.load('@/lib/public-dealer-store/public'),validation:loader.load('@/lib/public-dealer-store/validation')};
}
function success(result,h){assert.equal(result.ok,true,JSON.stringify({result,sqlErrors:h.state.errors}));return result.receipt ?? result;}
const publishInput=(overrides={})=>({companyId:COMPANY,slug:'public-shop-a',expectedVersion:0,profileVersion:1,listings:[{listingId:LISTING,version:2}],acknowledged:true,requestId:randomUUID(),...overrides});
const withdrawInput=(expectedVersion=1)=>({companyId:COMPANY,expectedVersion,acknowledged:true,requestId:randomUUID()});
async function manager(h){return success(await h.actions.getCompanyPublicStoreAction({companyId:COMPANY}),h);}
async function counts(){return (await database.query("select jsonb_build_object('stores',(select count(*)from private.public_dealer_stores),'versions',(select count(*)from private.public_dealer_store_versions),'audits',(select count(*)from private.public_dealer_store_audit)) result")).rows[0].result;}

test('public store cross-layer: real manager publication produces strict anonymous DTO and decoded authorized photo bytes',async()=>{
 const h=await integration();assert.equal((await manager(h)).store,null);assert.equal(await h.public.loadPublicDealerStore('public-shop-a'),null);
 const input=publishInput({listings:[{listingId:id(602),version:2},{listingId:LISTING,version:2}]}),receipt=success(await h.actions.publishCompanyPublicStoreAction(input),h);
 assert.equal(receipt.store.version,1);assert.deepEqual(receipt.store.selectedListings,[{listingId:LISTING,version:2},{listingId:id(602),version:2}]);
 assert.deepEqual((await manager(h)).store,receipt.store);
 const out=await h.public.loadPublicDealerStore('public-shop-a');assert.equal(out.shop.legalName,'Public store legal A');assert.equal(out.listings.length,2);assert.equal(out.listings[0].photos[0].id,PHOTO);
 assert.doesNotMatch(JSON.stringify(out),/companyId|stockId|registration|QAZ001|purchase|1234567|actorUserId|objectPath|storageBucket/);
 const image=await h.public.loadPublicStorePhoto('public-shop-a',PHOTO);assert.equal(image.contentType,'image/jpeg');assert.equal((await sharp(image.bytes).metadata()).width,2);
 const downloads=h.state.downloads;assert.equal(await h.public.loadPublicStorePhoto('public-shop-a',id(503)),null);assert.equal(h.state.downloads,downloads,'Foreign photos never reach storage download');
});

test('public store cross-layer: withdrawal, republish and historical receipts preserve exact actor nonce and frozen profile',async()=>{
 const h=await integration(),input=publishInput(),first=success(await h.actions.publishCompanyPublicStoreAction(input),h),offInput=withdrawInput();
 const off=success(await h.actions.unpublishCompanyPublicStoreAction(offInput),h);assert.equal(off.store.status,'unpublished');assert.equal(await h.public.loadPublicDealerStore(input.slug),null);
 assert.deepEqual(success(await h.actions.publishCompanyPublicStoreAction(input),h),first);assert.deepEqual(success(await h.actions.unpublishCompanyPublicStoreAction(offInput),h),off);assert.equal(await h.public.loadPublicStorePhoto(input.slug,PHOTO),null);
 await database.query("update public.memberships set role='admin',version=version+1 where company_id=$1 and user_id=$2",[COMPANY,OWNER]);
 assert.deepEqual(success(await h.actions.publishCompanyPublicStoreAction(input),h),first,'Historical receipt does not assume former owner role');
 const again=success(await h.actions.publishCompanyPublicStoreAction(publishInput({expectedVersion:2})),h);assert.equal(again.store.version,3);
 await database.exec(`insert into private.company_store_profile_versions(company_id,version,fields,created_by)select company_id,2,fields||'{"displayName":"Unpublished profile edit"}','${OWNER}'from private.company_store_profile_versions where company_id='${COMPANY}';update private.company_store_profile_heads set profile_id=(select id from private.company_store_profile_versions where company_id='${COMPANY}'and version=2),profile_version=2 where company_id='${COMPANY}';`);
 assert.equal((await h.public.loadPublicDealerStore(input.slug)).shop.displayName,'Opted-in public shop');
 assert.equal((await h.actions.publishCompanyPublicStoreAction(publishInput({expectedVersion:3}))).code,'conflict');
 success(await h.actions.publishCompanyPublicStoreAction(publishInput({expectedVersion:3,profileVersion:2})),h);assert.equal((await h.public.loadPublicDealerStore(input.slug)).shop.displayName,'Unpublished profile edit');
 assert.deepEqual(await counts(),{stores:1,versions:4,audits:4});
});

test('public store cross-layer: live Auth, approval, tenant and manager role protect private read/write and replay',async()=>{
 const h=await integration(),input=publishInput();success(await h.actions.publishCompanyPublicStoreAction(input),h);
 for(const opts of[{actor:OTHER},{actor:SALES},{company:FOREIGN}]){
  const denied=await integration(opts);assert.equal((await denied.actions.getCompanyPublicStoreAction({companyId:COMPANY})).code,'access_denied');
  assert.equal((await denied.actions.publishCompanyPublicStoreAction(input)).code,'access_denied');assert.equal((await denied.actions.unpublishCompanyPublicStoreAction(withdrawInput())).code,'access_denied');
 }
 const signedOut=await integration();signedOut.state.authenticated=false;assert.equal((await signedOut.actions.publishCompanyPublicStoreAction(input)).code,'unauthenticated');
 await database.query("update private.account_approvals set status='suspended'where user_id=$1",[OWNER]);assert.equal((await h.actions.publishCompanyPublicStoreAction(input)).code,'access_denied');assert.equal((await h.actions.unpublishCompanyPublicStoreAction(withdrawInput())).code,'access_denied');
 assert.deepEqual(await counts(),{stores:1,versions:1,audits:1});
});

test('public store cross-layer: source versions, strict selections, CAS and slug uniqueness fail without unintended writes',async()=>{
 const h=await integration();
 assert.equal((await h.actions.publishCompanyPublicStoreAction(publishInput({profileVersion:2}))).code,'conflict');
 assert.equal((await h.actions.publishCompanyPublicStoreAction(publishInput({listings:[{listingId:LISTING,version:1}]}))).code,'conflict');
 assert.equal((await h.actions.publishCompanyPublicStoreAction(publishInput({listings:[{listingId:id(603),version:2}]}))).code,'conflict');
 for(const patch of[{slug:'api'},{acknowledged:false},{listings:[{listingId:LISTING,version:2,secret:'x'}]},{listings:[{listingId:LISTING,version:2},{listingId:LISTING,version:2}]}])assert.equal((await h.actions.publishCompanyPublicStoreAction(publishInput(patch))).code,'invalid_input');
 assert.deepEqual(await counts(),{stores:0,versions:0,audits:0});const input=publishInput();success(await h.actions.publishCompanyPublicStoreAction(input),h);
 assert.equal((await h.actions.publishCompanyPublicStoreAction({...input,listings:[]})).code,'conflict');
 assert.equal((await h.actions.publishCompanyPublicStoreAction(publishInput())).code,'conflict');
 const other=await integration({actor:OTHER,company:FOREIGN});assert.equal((await other.actions.publishCompanyPublicStoreAction(publishInput({companyId:FOREIGN,listings:[]}))).code,'conflict');
 assert.deepEqual(await counts(),{stores:1,versions:1,audits:1});
});

test('public store cross-layer: lost durable response retries exactly and post-I/O approval revocation withholds private DTOs',async()=>{
 const h=await integration(),input=publishInput();h.state.loseReceipt='publish_company_public_store';
 const lost=await h.actions.publishCompanyPublicStoreAction(input);assert.equal(lost.code,'unavailable');assert.doesNotMatch(JSON.stringify(lost),/PRIVATE|public-store-1/);
 const receipt=success(await h.actions.publishCompanyPublicStoreAction(input),h);
 h.state.afterRpc=async name=>{if(name==='get_company_public_store')await database.query("update private.account_approvals set status='suspended'where user_id=$1",[OWNER]);};
 const denied=await h.actions.getCompanyPublicStoreAction({companyId:COMPANY});assert.equal(denied.code,'access_denied');assert.equal(denied.store,undefined);
 await database.query("update private.account_approvals set status='approved'where user_id=$1",[OWNER]);h.state.afterRpc=null;
 assert.deepEqual(success(await h.actions.publishCompanyPublicStoreAction(input),h),receipt);
 const off=withdrawInput();h.state.afterRpc=async name=>{if(name==='unpublish_company_public_store')await database.query("update private.account_approvals set status='suspended'where user_id=$1",[OWNER]);};
 const committed=await h.actions.unpublishCompanyPublicStoreAction(off);assert.equal(committed.code,'access_denied');assert.equal(committed.receipt,undefined);assert.equal(await h.public.loadPublicDealerStore(input.slug),null);
 await database.query("update private.account_approvals set status='approved'where user_id=$1",[OWNER]);h.state.afterRpc=null;
 assert.equal(success(await h.actions.unpublishCompanyPublicStoreAction(off),h).store.status,'unpublished');assert.deepEqual(await counts(),{stores:1,versions:2,audits:2});
});

test('public store cross-layer: real image download RLS and second SQL gate withhold bytes withdrawn during download',async()=>{
 const h=await integration();success(await h.actions.publishCompanyPublicStoreAction(publishInput()),h);
 h.state.onDownload=async()=>{h.state.onDownload=null;success(await h.actions.unpublishCompanyPublicStoreAction(withdrawInput()),h);};
 assert.equal(await h.public.loadPublicStorePhoto('public-shop-a',PHOTO),null);assert.equal(h.state.downloads,1);
 assert.equal(await h.public.loadPublicDealerStore('public-shop-a'),null);
});

test('public store cross-layer: real public parser rejects forged internal fields and sales or stale listing immediately hide bytes',async()=>{
 const h=await integration();success(await h.actions.publishCompanyPublicStoreAction(publishInput()),h);const out=await h.public.loadPublicDealerStore('public-shop-a');
 assert.throws(()=>h.validation.parsePublicDealerStore({...out,companyId:COMPANY},'public-shop-a'));
 assert.throws(()=>h.validation.parsePublicDealerStore({...out,listings:[{...out.listings[0],registrationNumber:'QAZ001'}]},'public-shop-a'));
 await database.query("update public.stock_items set status='reserved'where id=$1",[id(401)]);
 assert.equal((await h.public.loadPublicDealerStore('public-shop-a')).listings.length,0);assert.equal(await h.public.loadPublicStorePhoto('public-shop-a',PHOTO),null);assert.equal(h.state.downloads??0,0);
});

test('public store cross-layer: failed audit rolls back publication and private errors stay generic',async()=>{
 const h=await integration();await database.exec(`create function private.public_store_cross_layer_audit_failure()returns trigger language plpgsql as $$begin raise exception 'PRIVATE synthetic audit failure';end$$;create trigger public_store_cross_layer_audit_failure before insert on private.public_dealer_store_audit for each row execute function private.public_store_cross_layer_audit_failure()`);
 try{const failed=await h.actions.publishCompanyPublicStoreAction(publishInput());assert.equal(failed.code,'unavailable');assert.doesNotMatch(JSON.stringify(failed),/PRIVATE|synthetic|public-store-1/);assert.deepEqual(await counts(),{stores:0,versions:0,audits:0});assert.equal(await h.public.loadPublicDealerStore('public-shop-a'),null);}
 finally{await database.exec('drop trigger public_store_cross_layer_audit_failure on private.public_dealer_store_audit;drop function private.public_store_cross_layer_audit_failure()');}
});

test('public store cross-layer: valid zero-price ready advertisement survives the public SQL-to-parser contract',async()=>{
 const h=await integration();await database.exec(`update public.stock_items set asking_price_ore=0 where id='${id(401)}';update private.advertising_listings set version=3 where id='${LISTING}';insert into private.advertising_versions(company_id,listing_id,version,snapshot,created_by)values('${COMPANY}','${LISTING}',3,private.advertising_snapshot('${COMPANY}','${id(401)}','Publik Volvo','Beskrivning',array['${PHOTO}']::uuid[],true),'${OWNER}');`);
 success(await h.actions.publishCompanyPublicStoreAction(publishInput({listings:[{listingId:LISTING,version:3}]})),h);
 assert.equal((await h.public.loadPublicDealerStore('public-shop-a')).listings[0].priceOre,'0');
});
