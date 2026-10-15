import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import sharp from 'sharp';
import { createSourceLoader } from './helpers/source-loader.mjs';
const id=n=>`f3720000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const PHOTO=id(3),PATH=`${id(1)}/${id(2)}/${PHOTO}.jpg`,SLUG='bilfirman';
const originalEnv={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY};
before(()=>{process.env.NEXT_PUBLIC_SUPABASE_URL='https://public-fixture.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-publishable-key';});
after(()=>{for(const[key,value]of[['NEXT_PUBLIC_SUPABASE_URL',originalEnv.url],['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',originalEnv.key]])if(value===undefined)delete process.env[key];else process.env[key]=value;});
async function harness({bytes,metas,downloadError=false,rpcError=false,arrayBuffer}={}){
 bytes??=await sharp({create:{width:8,height:8,channels:3,background:'#396b52'}}).jpeg().withMetadata({exif:{IFD0:{ImageDescription:'PRIVATE_IMAGE_METADATA'}}}).toBuffer();
 const meta={objectPath:PATH,contentType:'image/jpeg',sizeBytes:bytes.length};const calls={clients:[],rpc:[],storage:[],downloads:[],arrayBuffers:0};const sequence=metas??[meta,meta];
 const db={rpc:async(name,args)=>{calls.rpc.push({name,args});return {data:sequence.shift()??null,error:rpcError?{message:'PRIVATE_BACKEND_FAILURE'}:null};},storage:{from:bucket=>{calls.storage.push(bucket);return {download:async path=>{calls.downloads.push(path);return {error:downloadError?{message:'PRIVATE_STORAGE_FAILURE'}:null,data:{size:bytes.length,arrayBuffer:async()=>{calls.arrayBuffers++;return arrayBuffer?arrayBuffer():bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}}};}};}}};
 class PhotoError extends Error{constructor(code){super(code);this.code=code;}}
 const loader=await createSourceLoader({'@supabase/supabase-js':{createClient:(...args)=>{calls.clients.push(args);return db;}},'./server':{PhotoError}});
 return {source:loader.load('src/lib/public-dealer-store/public.ts'),calls,bytes,meta,db};
}
test('actual public SDK client is isolated from app sessions and uses only explicit public config with bounded uncached fetch',async()=>{
 const h=await harness();h.source.createPublicStoreClient();const[url,key,options]=h.calls.clients[0];assert.equal(url,'https://public-fixture.supabase.co');assert.equal(key,'fixture-publishable-key');assert.deepEqual(options.auth,{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});assert.deepEqual(Object.keys(options).sort(),['auth','global']);
 const previous=globalThis.fetch;let captured;try{globalThis.fetch=async(input,init)=>{captured={input,init};return new Response('ok');};await options.global.fetch('https://public-fixture.supabase.co/rest/v1/rpc/get_public_dealer_store',{cache:'force-cache'});assert.equal(captured.init.cache,'no-store');assert.ok(captured.init.signal instanceof AbortSignal);assert.equal(captured.init.signal.aborted,false);assert.equal(captured.init.headers,undefined);}finally{globalThis.fetch=previous;}
});
test('missing public config blocks before SDK construction and does not fall back to app or service identities',async()=>{
 const h=await harness();const saved=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;try{assert.throws(()=>h.source.createPublicStoreClient(),e=>e.code==='unavailable');assert.equal(h.calls.clients.length,0);}finally{process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=saved;}
});
test('invalid public slug or photo ID performs no SDK or Storage request',async()=>{
 const h=await harness();for(const[slug,photo]of[['admin',PHOTO],['../store',PHOTO],[SLUG,'../file'],[SLUG,'not-uuid']])assert.equal(await h.source.loadPublicStorePhoto(slug,photo),null);assert.equal(await h.source.loadPublicDealerStore('admin'),null);assert.equal(h.calls.clients.length,0);assert.equal(h.calls.downloads.length,0);
});
test('actual decoder reencodes selected image and strips embedded metadata before returning public bytes',async()=>{
 const h=await harness();assert.ok(h.bytes.includes(Buffer.from('PRIVATE_IMAGE_METADATA')));const result=await h.source.loadPublicStorePhoto(SLUG,PHOTO);assert.equal(result.contentType,'image/jpeg');assert.ok(!Buffer.from(result.bytes).includes(Buffer.from('PRIVATE_IMAGE_METADATA')));const decoded=await sharp(result.bytes).metadata();assert.equal(decoded.width,8);assert.equal(decoded.height,8);assert.equal(decoded.exif,undefined);assert.deepEqual(h.calls.storage,['ads-vehicle-photos']);assert.deepEqual(h.calls.downloads,[PATH]);assert.equal(h.calls.rpc.length,2);assert.deepEqual(h.calls.rpc[0].args,{p_slug:SLUG,p_photo_id:PHOTO});
});
test('publication withdrawn while bytes download are decoded yields no public bytes',async()=>{
 const h=await harness();h.db.rpc=async(name,args)=>{h.calls.rpc.push({name,args});return {data:h.calls.rpc.length===1?h.meta:null,error:null};};assert.equal(await h.source.loadPublicStorePhoto(SLUG,PHOTO),null);assert.equal(h.calls.arrayBuffers,1);assert.equal(h.calls.rpc.length,2);
});
test('changed photo identity or metadata after IO withholds bytes',async()=>{
 for(const change of [{objectPath:`${id(1)}/${id(9)}/${PHOTO}.jpg`},{sizeBytes:999},{contentType:'image/png',objectPath:`${id(1)}/${id(2)}/${PHOTO}.png`}]){const h=await harness();h.db.rpc=async()=>({data:h.calls.rpc.push(1)===1?h.meta:{...h.meta,...change},error:null});assert.equal(await h.source.loadPublicStorePhoto(SLUG,PHOTO),null);assert.equal(h.calls.downloads.length,1);}
});
test('unselected, path traversal, mismatched photo ID, MIME or oversized metadata never reaches Storage download',async()=>{
 const cases=[null,{objectPath:'../secret.jpg',contentType:'image/jpeg',sizeBytes:12},{objectPath:`${id(1)}/${id(2)}/${id(99)}.jpg`,contentType:'image/jpeg',sizeBytes:12},{objectPath:PATH,contentType:'image/png',sizeBytes:12},{objectPath:PATH,contentType:'image/jpeg',sizeBytes:10485761}];for(const meta of cases){const h=await harness({metas:[meta]});if(meta===null)assert.equal(await h.source.loadPublicStorePhoto(SLUG,PHOTO),null);else await assert.rejects(()=>h.source.loadPublicStorePhoto(SLUG,PHOTO));assert.equal(h.calls.downloads.length,0);}
});
test('malformed stored image, byte count mismatch and storage failures fail without returning bytes',async()=>{
 const malformed=await harness({bytes:Buffer.from('not a JPEG')});await assert.rejects(()=>malformed.source.loadPublicStorePhoto(SLUG,PHOTO));assert.equal(malformed.calls.rpc.length,1);
 const mismatch=await harness();mismatch.db.rpc=async()=>({data:{...mismatch.meta,sizeBytes:mismatch.meta.sizeBytes+1},error:null});await assert.rejects(()=>mismatch.source.loadPublicStorePhoto(SLUG,PHOTO));assert.equal(mismatch.calls.arrayBuffers,0);
 const failed=await harness({downloadError:true});await assert.rejects(()=>failed.source.loadPublicStorePhoto(SLUG,PHOTO));assert.equal(failed.calls.arrayBuffers,0);
});
test('RPC failures are generic unavailable and cannot return stale metadata or invoke Storage',async()=>{
 const h=await harness({rpcError:true});await assert.rejects(()=>h.source.loadPublicStorePhoto(SLUG,PHOTO),e=>e.code==='unavailable'&&!e.message.includes('PRIVATE_BACKEND_FAILURE'));assert.equal(h.calls.downloads.length,0);
});
