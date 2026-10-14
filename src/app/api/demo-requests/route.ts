import { NextRequest,NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { WebApplicationDatabase } from '@/lib/web-applications/database.types';
import { validateWebApplication } from '@/lib/web-applications/validation';
export async function POST(request:NextRequest) {
 const origin=request.headers.get('origin');const allowed=new Set(['https://trafexa.com','https://www.trafexa.com','https://app.trafexa.com',process.env.NEXT_PUBLIC_SITE_URL,process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:undefined,process.env.VERCEL_BRANCH_URL?`https://${process.env.VERCEL_BRANCH_URL}`:undefined]);
 if(process.env.NODE_ENV!=='production') {
  allowed.add('http://localhost:3000');
  allowed.add('http://127.0.0.1:3000');
 }
 if(!origin||!allowed.has(origin))return NextResponse.json({error:'Begäran kunde inte godkännas.'},{status:403});
 if(Number(request.headers.get('content-length')??0)>8192)return NextResponse.json({error:'Formuläret är för stort.'},{status:413});
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return NextResponse.json({error:'Formuläret måste skickas som JSON.'},{status:415});
 // Enforce the limit on received bytes, including streamed requests without Content-Length.
 let data:Record<string,unknown>;
 const reader=request.body?.getReader();
 if(!reader)return NextResponse.json({error:'Kontrollera formuläret.'},{status:400});
 try {
  const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,body='';
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
   if(size>8192){await reader.cancel().catch(()=>{});return NextResponse.json({error:'Formuläret är för stort.'},{status:413});}
   body+=decoder.decode(chunk.value,{stream:true});
  }
  body+=decoder.decode();const parsed:unknown=JSON.parse(body);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return NextResponse.json({error:'Kontrollera formuläret.'},{status:400});
  data=parsed as Record<string,unknown>;
 }catch{return NextResponse.json({error:'Kontrollera formuläret.'},{status:400});}
 finally{reader.releaseLock();}
 let application:ReturnType<typeof validateWebApplication>;
 try {application=validateWebApplication(data);}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Kontrollera formuläret.'},{status:400});}
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return NextResponse.json({error:'Förfrågan kunde inte sparas just nu.'},{status:503});
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),10000);
 try {
  const db=createClient<WebApplicationDatabase>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:receipt,error}=await db.rpc('submit_web_application',{p_request_id:application.requestId,p_name:application.name,p_email:application.email,p_company:application.company,p_phone:application.phone,p_organisation_number:application.organisationNumber,p_seeking:application.seeking,p_message:application.message,p_privacy_version:application.privacyVersion,p_privacy_acknowledged:true}).abortSignal(controller.signal);
  if(controller.signal.aborted)return NextResponse.json({error:'Det tog för lång tid att spara förfrågan. Försök igen senare.'},{status:504});
  if(error)return NextResponse.json({error:'Ansökan kunde inte sparas. Försök igen senare.'},{status:error.code==='P0001'?429:error.code==='40001'?409:error.code==='22023'?400:503});
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||receipt.request_id!==application.requestId||receipt.accepted!==true)return NextResponse.json({error:'Ansökan kunde inte verifieras. Försök igen med samma uppgifter.'},{status:503});
  return NextResponse.json({success:true,receipt:{requestId:application.requestId,accepted:true}},{status:201});
 }catch {
  return NextResponse.json({error:controller.signal.aborted?'Det tog för lång tid att spara förfrågan. Försök igen senare.':'Förfrågan kunde inte sparas. Försök igen senare.'},{status:controller.signal.aborted?504:503});
 }finally {clearTimeout(timeout);}
}
