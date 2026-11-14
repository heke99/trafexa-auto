import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {createHmac} from 'node:crypto';
import {cookies} from 'next/headers';
import {requireDealerSigningContext} from '@/lib/contracts/signing-context';
import {uploadedPdfSource,uploadedPdfId} from './validation';
import {uploadedPdfHash,inspectUploadedPdf,renderUploadedPdfArtifacts} from './pdf';
import type {UploadedPdfSource} from './types';
import {sendAccountInvitation} from '@/lib/email/account-invitation-transport';
export const PDF_BUCKET='uploaded-contracts',PDF_COOKIE='trafexa-uploaded-pdf';
type Reply={data:unknown;error:unknown};
export type PdfService={rpc(name:string,args:Record<string,unknown>):Promise<Reply>;storage:{from(bucket:string):{upload(path:string,bytes:Uint8Array,options:{contentType:string;upsert:false}):Promise<{error:unknown}>;download(path:string):Promise<{data:Blob|null;error:unknown}>}}};
export class UploadedPdfError extends Error{constructor(readonly code:'invalid_input'|'access_denied'|'conflict'|'unavailable',message='Dokumentet kunde inte verifieras.'){super(message);}}
export function uploadedPdfService():PdfService{const secret=process.env.SUPABASE_SECRET_KEY,url=process.env.NEXT_PUBLIC_SUPABASE_URL;if(!secret||url!=='https://buqdtssxrotkzndublrt.supabase.co')throw new UploadedPdfError('unavailable','Dokumentlagringen är inte konfigurerad.');return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}}) as unknown as PdfService;}
export const pdfEmailConfigured=()=>process.env.CONTRACT_EMAIL_ENABLED==='true'&&process.env.TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED==='true'&&!!process.env.RESEND_API_KEY&&!!process.env.SUPABASE_SECRET_KEY;
export async function pdfRpc(db:{rpc(name:string,args:Record<string,unknown>):Promise<Reply>},name:string,args:Record<string,unknown>){const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data;}
export async function freshUploadedPdfDealer(prior:Awaited<ReturnType<typeof requireDealerSigningContext>>,write=false){const next=await requireDealerSigningContext(prior.companyId,write);if(next.userId!==prior.userId||next.role!==prior.role)throw new UploadedPdfError('access_denied');return next;}
export async function readPdfBlob(db:PdfService,path:string,hash:string,max=16*1024*1024){const r=await db.storage.from(PDF_BUCKET).download(path);if(r.error||!r.data||r.data.size>max)throw new UploadedPdfError('unavailable');const bytes=new Uint8Array(await r.data.arrayBuffer());if(uploadedPdfHash(bytes)!==hash)throw new UploadedPdfError('unavailable','Dokumentets hash kunde inte verifieras.');return bytes;}
export async function storePdfBlob(db:PdfService,path:string,bytes:Uint8Array,mime:string){await db.storage.from(PDF_BUCKET).upload(path,bytes,{contentType:mime,upsert:false});const stored=await readPdfBlob(db,path,uploadedPdfHash(bytes));if(stored.length!==bytes.length)throw new UploadedPdfError('unavailable');}
export async function originalPdf(db:PdfService,s:UploadedPdfSource){const bytes=await readPdfBlob(db,s.objectPath,s.originalSha256);const p=await inspectUploadedPdf(bytes);if(p.pageCount!==s.pageCount||p.byteSize!==s.byteSize)throw new UploadedPdfError('unavailable');return bytes;}
export async function archiveUploadedPdf(db:PdfService,s:UploadedPdfSource,verifyAccess?:()=>Promise<unknown>){
 if(s.status!=='completed'||!s.companySignature||!s.customerSignature)throw new UploadedPdfError('conflict');
 if(s.archive){await Promise.all([readPdfBlob(db,s.archive.pdfPath,s.archive.pdfSha256),readPdfBlob(db,s.archive.evidencePath,s.archive.evidenceSha256)]);return s;}
 const artifacts=await renderUploadedPdfArtifacts(await originalPdf(db,s),s),root=`${s.companyId}/uploaded-pdfs/${s.id}/`,pdfHash=uploadedPdfHash(artifacts.pdf),evidenceHash=uploadedPdfHash(artifacts.evidence);
 await verifyAccess?.();await storePdfBlob(db,`${root}signed-${pdfHash}.pdf`,artifacts.pdf,'application/pdf');await verifyAccess?.();await storePdfBlob(db,`${root}evidence-${evidenceHash}.json`,artifacts.evidence,'application/json');
 await verifyAccess?.();return uploadedPdfSource(await pdfRpc(db,'archive_uploaded_pdf',{p_source_id:s.id,p_pdf_sha256:pdfHash,p_evidence_sha256:evidenceHash}),{id:s.id,companyId:s.companyId,dealId:s.dealId});
}
export const validPdfToken=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
export async function requireUploadedPdfGuest(sourceId:string){uploadedPdfId(sourceId);const raw=(await cookies()).get(PDF_COOKIE)?.value,parts=raw?.split('.');if(!parts||parts.length!==2||parts[0]!==sourceId||!validPdfToken(parts[1]))throw new UploadedPdfError('access_denied');const db=uploadedPdfService(),tokenHash=uploadedPdfHash(parts[1]);const source=uploadedPdfSource(await pdfRpc(db,'get_uploaded_pdf_guest',{p_source_id:sourceId,p_token_sha256:tokenHash}),{id:sourceId});return{db,source,tokenHash};}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Same immutable source/token/body and provider key on deliberate retry. A lost
 * provider response becomes unknown and is never automatically sent again. */
export async function dispatchUploadedPdf(db:PdfService,id:string,kind:'invitation'|'completed'){
 if(!pdfEmailConfigured())return 'unconfigured';let lease:{id:string;leaseId:string}|null=null;
 try{
  const r=await pdfRpc(db,'claim_uploaded_pdf_mail',{p_source_id:uploadedPdfId(id),p_kind:kind}) as Record<string,unknown>|null;if(!r)return'empty';if(r.status!=='processing')return String(r.status);
  if(typeof r.firstAttemptAt!=='string')throw Error('Invalid email lease');lease={id:uploadedPdfId(r.id),leaseId:uploadedPdfId(r.leaseId)};const s=uploadedPdfSource(r.source,{id});
  const key=process.env.UPLOADED_PDF_LINK_SECRET||process.env.SUPABASE_SECRET_KEY!;
  const token=kind==='invitation'?createHmac('sha256',key).update(`trafexa/uploaded-pdf/v1/${id}`).digest('base64url'):null;
  if(token&&r.tokenSha256!==null&&r.tokenSha256!==undefined&&r.tokenSha256!==uploadedPdfHash(token)){await pdfRpc(db,'finish_uploaded_pdf_mail',{p_email_id:lease.id,p_lease_id:lease.leaseId,p_status:'unknown',p_provider_id:null});return 'key_changed';}
  const url=token?`https://app.trafexa.com/pdf-document/invitation?id=${id}&token=${token}`:`https://app.trafexa.com/pdf-document/${id}`;
  const subject=kind==='invitation'?'Ett PDF-avtal väntar på din underskrift':'Ditt PDF-avtal är färdigsignerat';
  const intro=kind==='invitation'?`${s.companyName} har godkänt och skickat ${s.filename} för din underskrift. Granska originalet och bekräfta med ditt namn. En signeringssida läggs till; originalet bevaras separat.`:'Båda parter har godkänt dokumentet. Hämta avtalet, originalet och signeringsbeviset via din personliga länk.';
  const linkInstruction=kind==='invitation'?`Öppna dokumentet: ${url}`:`Använd den personliga länken i ditt första avtalsmejl för att hämta filerna. På samma enhet kan du även öppna dokumentvyn: ${url}. Dokumentvyn ger ingen åtkomst utan den personliga länken.`;
  const body=JSON.stringify({from:'Trafexa <kundtjanst@trafexa.com>',reply_to:'info@trafexa.com',to:[s.recipientEmail],subject,text:`${intro}\n\n${linkInstruction}\n\nLänken är personlig och gäller till ${s.expiresAt}. Vidarebefordra den inte.`,html:`<!doctype html><html lang="sv"><body style="font:16px Arial;color:#173d35"><h1>${escape(subject)}</h1><p>${escape(intro)}</p><p>${kind==='invitation'?'Din länk är personlig.':'Använd den personliga länken i ditt första avtalsmejl. På samma enhet kan du även öppna dokumentvyn nedan; den ger ingen åtkomst i sig.'}</p><p><a href="${escape(url)}">${kind==='invitation'?'Öppna dokumentet':'Öppna dokumentvyn på samma enhet'}</a></p><p>Länken är personlig. Vidarebefordra den inte.</p></body></html>`});
  if(await pdfRpc(db,'bind_uploaded_pdf_mail',{p_email_id:lease.id,p_lease_id:lease.leaseId,p_token_sha256:token?uploadedPdfHash(token):null,p_body_sha256:uploadedPdfHash(body)})!==true)throw Error('Lease changed');
  const result=await sendAccountInvitation({invitationId:lease.id,firstAttemptAt:r.firstAttemptAt,body,apiKey:process.env.RESEND_API_KEY!,idempotencyKey:`trafexa/${lease.id}`});const status=result.status==='sent'?'sent':result.status==='retryable'?'queued':result.status;
  const committed=await pdfRpc(db,'finish_uploaded_pdf_mail',{p_email_id:lease.id,p_lease_id:lease.leaseId,p_status:status,p_provider_id:result.status==='sent'?result.providerId:null});return committed===true?status:'unknown';
 }catch{if(lease)try{await pdfRpc(db,'finish_uploaded_pdf_mail',{p_email_id:lease.id,p_lease_id:lease.leaseId,p_status:'unknown',p_provider_id:null});}catch{}return'unknown';}
}
