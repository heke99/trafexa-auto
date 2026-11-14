import{NextRequest}from'next/server';
import{requireDealerSigningContext}from'@/lib/contracts/signing-context';
import{templateUuid}from'@/lib/pdf-templates/validation';
import{readTemplateAsset,templateAssetBytes}from'@/lib/pdf-templates/server';
import{freshUploadedPdfDealer}from'@/lib/uploaded-pdf/server';
import{uploadedPdfDownloadHeaders}from'@/lib/uploaded-pdf/download';
export const runtime='nodejs';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const{id}=await params,companyId=templateUuid.parse(request.nextUrl.searchParams.get('companyId')),c=await requireDealerSigningContext(companyId,true),asset=await readTemplateAsset(c,templateUuid.parse(id)),bytes=await templateAssetBytes(asset);await freshUploadedPdfDealer(c,true);return new Response(new Uint8Array(bytes),{headers:uploadedPdfDownloadHeaders('application/pdf',asset.filename,true)});}catch{return new Response('PDF-mallen är inte tillgänglig.',{status:404,headers:{'Cache-Control':'no-store'}});}}
