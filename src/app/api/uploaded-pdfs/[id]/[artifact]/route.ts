import {NextRequest} from 'next/server';
import {requireDealerSigningContext} from '@/lib/contracts/signing-context';
import {uploadedPdfId,uploadedPdfSource} from '@/lib/uploaded-pdf/validation';
import {pdfRpc,uploadedPdfService,freshUploadedPdfDealer} from '@/lib/uploaded-pdf/server';
import {uploadedPdfArtifact,uploadedPdfDownloadHeaders} from '@/lib/uploaded-pdf/download';
export const runtime='nodejs';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string;artifact:string}>}){try{const{id,artifact}=await params;if(!['original','signed','evidence'].includes(artifact))throw Error();const companyId=uploadedPdfId(request.nextUrl.searchParams.get('companyId')),actor=await requireDealerSigningContext(companyId),r=await pdfRpc(actor.db as never,'get_uploaded_pdf_source',{p_company_id:companyId,p_source_id:uploadedPdfId(id)}) as Record<string,unknown>;if(r.actorId!==actor.userId)throw Error();const source=uploadedPdfSource(r.source,{id,companyId}),file=await uploadedPdfArtifact(uploadedPdfService(),source,artifact);await freshUploadedPdfDealer(actor);return new Response(new Uint8Array(file.bytes),{headers:uploadedPdfDownloadHeaders(file.mime,file.filename,artifact==='original'&&request.nextUrl.searchParams.get('download')!=='1')});}catch{return new Response('Dokumentet är inte tillgängligt.',{status:404,headers:{'Cache-Control':'no-store'}});}}
