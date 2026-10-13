import { NextRequest,NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
export async function POST(request:NextRequest) {
 const origin=request.headers.get('origin');const allowed=new Set(['https://trafexa.com','https://www.trafexa.com','https://app.trafexa.com',process.env.NEXT_PUBLIC_SITE_URL,process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:undefined]);
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
 for(const field of ['name','email','company','phone','message','website']) {
  if(data[field]!==undefined&&typeof data[field]!=='string')return NextResponse.json({error:'Kontrollera formulärets textuppgifter.'},{status:400});
 }
 if(typeof data.website==='string'&&data.website)return NextResponse.json({success:true});
 const val=(key:string)=>typeof data[key]==='string'?String(data[key]).trim():'';
 const name=val('name'),email=val('email'),company=val('company'),phone=val('phone'),message=val('message');
 if(name.length<2||name.length>160||company.length<2||company.length>160||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||phone.length>60||message.length>2000)return NextResponse.json({error:'Fyll i namn, företag och en giltig e-postadress.'},{status:400});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return NextResponse.json({error:'Förfrågan kunde inte sparas just nu.'},{status:503});
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),10000);
 try {
  const db=createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await db.rpc('submit_demo_request',{contact_name:name,contact_email:email,company_name:company,...(phone?{contact_phone:phone}:{}),...(message?{contact_message:message}:{})}).abortSignal(controller.signal);
  if(controller.signal.aborted)return NextResponse.json({error:'Det tog för lång tid att spara förfrågan. Försök igen senare.'},{status:504});
  if(error)return NextResponse.json({error:'Förfrågan kunde inte sparas. Försök igen senare.'},{status:error.message.includes('Too many')?429:503});
  return NextResponse.json({success:true},{status:201});
 }catch {
  return NextResponse.json({error:controller.signal.aborted?'Det tog för lång tid att spara förfrågan. Försök igen senare.':'Förfrågan kunde inte sparas. Försök igen senare.'},{status:controller.signal.aborted?504:503});
 }finally {clearTimeout(timeout);}
}
