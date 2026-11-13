import {NextRequest,NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {requireDealerSigningContext} from '@/lib/contracts/signing-context';
import {uploadedPdfId,uploadedPdfSource} from '@/lib/uploaded-pdf/validation';
import {UPLOADED_PDF_MAX_BYTES} from '@/lib/uploaded-pdf/types';
import {inspectUploadedPdf} from '@/lib/uploaded-pdf/pdf';
import {uploadedPdfService,pdfRpc,storePdfBlob,freshUploadedPdfDealer,UploadedPdfError} from '@/lib/uploaded-pdf/server';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 const origin=request.headers.get('origin');
 // Some same-origin multipart clients omit Origin. Fetch Metadata remains a
 // browser-controlled CSRF signal; an explicit foreign Origin always wins.
 if(origin!==null?origin!==request.nextUrl.origin:request.headers.get('sec-fetch-site')!=='same-origin')return NextResponse.json({ok:false,code:'access_denied',message:'Begäran kunde inte godkännas.'},{status:403});
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;'))return NextResponse.json({ok:false,code:'invalid_input',message:'Välj en PDF-fil.'},{status:415});
 try{
  const companyId=uploadedPdfId(request.nextUrl.searchParams.get('companyId')),dealId=uploadedPdfId(request.nextUrl.searchParams.get('dealId')),actor=await requireDealerSigningContext(companyId,true),db=uploadedPdfService();
  const context=await pdfRpc(actor.db as never,'list_uploaded_pdf_signings',{p_company_id:companyId,p_deal_id:dealId}) as Record<string,unknown>;if(context.actorId!==actor.userId||context.companyId!==companyId||context.dealId!==dealId)throw Error('Invalid deal');
  if(typeof context.recipientEmail!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(context.recipientEmail))return NextResponse.json({ok:false,code:'invalid_input',message:'Komplettera kundens mejladress i affären före uppladdning.'},{status:400});
  const limit=UPLOADED_PDF_MAX_BYTES+65536;if(Number(request.headers.get('content-length')??0)>limit)return NextResponse.json({ok:false,code:'invalid_input',message:'PDF-filen får vara högst 4 MB.'},{status:413});
  const reader=request.body?.getReader();if(!reader)throw Error('Missing file');let size=0;const chunks:Uint8Array[]=[];try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();return NextResponse.json({ok:false,code:'invalid_input',message:'PDF-filen får vara högst 4 MB.'},{status:413});}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}const form=await new Response(bytes,{headers:{'content-type':request.headers.get('content-type')!}}).formData();
  if([...form.keys()].some(k=>!['file','sourceId'].includes(k))||form.getAll('file').length!==1||form.getAll('sourceId').length!==1)throw new UploadedPdfError('invalid_input','Kontrollera PDF-filen och uppladdningsbegäran.');const id=uploadedPdfId(form.get('sourceId')),file=form.get('file');
  if(!(file instanceof File)||file.size>UPLOADED_PDF_MAX_BYTES||!file.name.toLowerCase().endsWith('.pdf')||file.name.length>160||/[\u0000-\u001f\u007f/\\]/.test(file.name))return NextResponse.json({ok:false,code:'invalid_input',message:'Välj en PDF-fil med ett vanligt filnamn, högst 4 MB.'},{status:400});
  let info;const original=new Uint8Array(await file.arrayBuffer());try{info=await inspectUploadedPdf(original);}catch{return NextResponse.json({ok:false,code:'invalid_input',message:'PDF-filen kunde inte läsas. Använd en okrypterad, statisk PDF utan formulärfält, aktiva funktioner eller tidigare digital signatur (1–100 sidor, högst 4 MB).'},{status:400});}
  await freshUploadedPdfDealer(actor,true);const path=`${companyId}/uploaded-pdfs/${id}/original-${info.sha256}.pdf`;await storePdfBlob(db,path,original,'application/pdf');await freshUploadedPdfDealer(actor,true);
  const source=uploadedPdfSource(await pdfRpc(db,'register_uploaded_pdf_source',{p_actor_id:actor.userId,p_company_id:companyId,p_deal_id:dealId,p_source_id:id,p_filename:file.name,p_sha256:info.sha256,p_byte_size:info.byteSize,p_page_count:info.pageCount}),{id,companyId,dealId});await freshUploadedPdfDealer(actor,true);return NextResponse.json({ok:true,source},{headers:{'Cache-Control':'no-store'}});
 }catch(e){const code=e&&typeof e==='object'&&'code'in e?String(e.code):'';const denied=['42501','access_denied','unauthenticated'].includes(code),invalid=e instanceof ZodError||code==='invalid_input';return NextResponse.json({ok:false,code:denied?'access_denied':invalid?'invalid_input':'unavailable',message:denied?'Din behörighet till dokumentet kunde inte verifieras.':invalid?'Kontrollera PDF-filen och uppladdningsbegäran.':'Uppladdningen kunde inte bekräftas. Uppdatera dokumentlistan innan du försöker igen.'},{status:denied?403:invalid?400:503});}
}
