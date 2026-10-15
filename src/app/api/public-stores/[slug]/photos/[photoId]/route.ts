import { loadPublicStorePhoto } from '@/lib/public-dealer-store/public';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; sandbox"};
export async function GET(request:Request,{params}:{params:Promise<{slug:string;photoId:string}>}) {
  if([...new URL(request.url).searchParams].length)return new Response(null,{status:400,headers});
  try {const {slug,photoId}=await params,result=await loadPublicStorePhoto(slug,photoId);return result?new Response(new Uint8Array(result.bytes),{headers:{...headers,'Content-Type':result.contentType,'Content-Length':String(result.bytes.length)}}):new Response(null,{status:404,headers});}
  catch{return new Response(null,{status:503,headers});}
}
