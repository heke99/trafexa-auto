import {NextRequest} from 'next/server';
import {requireUploadedPdfGuest} from '@/lib/uploaded-pdf/server';
import {uploadedPdfArtifact,uploadedPdfDownloadHeaders} from '@/lib/uploaded-pdf/download';
export const runtime='nodejs';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string;artifact:string}>}){try{const{id,artifact}=await params;if(!['original','signed','evidence'].includes(artifact))throw Error();const c=await requireUploadedPdfGuest(id),file=await uploadedPdfArtifact(c.db,c.source,artifact,()=>requireUploadedPdfGuest(id));await requireUploadedPdfGuest(id);return new Response(new Uint8Array(file.bytes),{headers:uploadedPdfDownloadHeaders(file.mime,file.filename,artifact==='original'&&request.nextUrl.searchParams.get('download')!=='1')});}catch{return new Response('Dokumentlänken är inte tillgänglig.',{status:403,headers:{'Cache-Control':'no-store'}});}}
