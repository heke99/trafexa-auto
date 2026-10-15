import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { PublicStoreDatabase } from './context';
import { PublicStoreError, parsePublicDealerStore, storeObject, storeSlug, storeUuid } from './validation';
import { normalizeVehicleImage } from '../vehicle-photos/images';
/** Public reads deliberately never inherit the visitor's app cookies or a service key. */
export function createPublicStoreClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new PublicStoreError('unavailable');
  return createClient<PublicStoreDatabase>(url,key,{ auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}, global:{ fetch: (input,init) => fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(15000)}) } });
}
export async function loadPublicDealerStore(input: string) {
  let slug:string; try { slug=storeSlug(input); } catch { return null; }
  const db=createPublicStoreClient(), result=await db.rpc('get_public_dealer_store',{p_slug:slug});
  if(result.error) throw new PublicStoreError('unavailable'); return parsePublicDealerStore(result.data,slug);
}
function photoMeta(value:unknown) {
  if(value===null) return null;
  const row=storeObject(value,['objectPath','contentType','sizeBytes']);
  if(typeof row.objectPath!=='string' || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(row.objectPath) || !['image/jpeg','image/png','image/webp'].includes(row.contentType as string) || typeof row.sizeBytes!=='number' || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes<1 || row.sizeBytes>10485760) throw new PublicStoreError('unavailable');
  const extension=row.contentType==='image/jpeg'?'jpg':row.contentType==='image/png'?'png':'webp'; if(!row.objectPath.endsWith('.'+extension)) throw new PublicStoreError('unavailable');
  return {objectPath:row.objectPath,contentType:row.contentType as 'image/jpeg'|'image/png'|'image/webp',sizeBytes:row.sizeBytes};
}
export async function loadPublicStorePhoto(inputSlug:string,inputId:string) {
  let slug:string, photoId:string;try{slug=storeSlug(inputSlug);photoId=storeUuid(inputId);}catch{return null;}
  const db=createPublicStoreClient();
  const metadata=await db.rpc('get_public_store_photo',{p_slug:slug,p_photo_id:photoId}); if(metadata.error) throw new PublicStoreError('unavailable');
  const before=photoMeta(metadata.data); if(!before) return null;
  if(before.objectPath.split('/').at(-1)!==photoId+'.'+(before.contentType==='image/jpeg'?'jpg':before.contentType==='image/png'?'png':'webp'))throw new PublicStoreError('unavailable');
  const result=await db.storage.from('ads-vehicle-photos').download(before.objectPath);
  if(result.error||!result.data||result.data.size!==before.sizeBytes)throw new PublicStoreError('unavailable');
  const normalized=await normalizeVehicleImage(new Uint8Array(await result.data.arrayBuffer()),before.contentType);
  // A withdrawal, sale or archived image during download must withhold the bytes.
  const current=await db.rpc('get_public_store_photo',{p_slug:slug,p_photo_id:photoId}); if(current.error) throw new PublicStoreError('unavailable');
  const after=photoMeta(current.data); if(!after || after.objectPath!==before.objectPath || after.sizeBytes!==before.sizeBytes || after.contentType!==before.contentType)return null;
  return normalized;
}
