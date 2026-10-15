import { loadPublicDealerStore } from '@/lib/public-dealer-store/public';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','Referrer-Policy':'no-referrer'};
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}) {
  if([...new URL(request.url).searchParams].length)return Response.json({error:'invalid_input'},{status:400,headers});
  try {const {slug}=await params,store=await loadPublicDealerStore(slug);return store?Response.json({schemaVersion:1,store},{headers}):Response.json({error:'not_found'},{status:404,headers});}
  catch{return Response.json({error:'unavailable'},{status:503,headers});}
}
