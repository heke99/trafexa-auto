import{NextRequest,NextResponse}from'next/server';
import{z}from'zod';
import{requireDealerSigningContext}from'@/lib/contracts/signing-context';
import{templateUuid,templateFields}from'@/lib/pdf-templates/validation';
import{assertTemplateOrigin,boundedTemplateBody,templateFailure,readTemplateAsset,templateAssetBytes}from'@/lib/pdf-templates/server';
import{fillPdfTemplate}from'@/lib/pdf-templates/pdf';
import{freshUploadedPdfDealer,UploadedPdfError}from'@/lib/uploaded-pdf/server';
import{uploadedPdfDownloadHeaders}from'@/lib/uploaded-pdf/download';
export const runtime='nodejs';
export async function POST(request:NextRequest){try{assertTemplateOrigin(request);if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new UploadedPdfError('invalid_input');const companyId=templateUuid.parse(request.nextUrl.searchParams.get('companyId')),c=await requireDealerSigningContext(companyId,true),body=await boundedTemplateBody(request,65536),v=z.object({assetId:templateUuid,fields:templateFields}).strict().parse(parseJson(body)),asset=await readTemplateAsset(c,v.assetId),pdf=await fillPdfTemplate(await templateAssetBytes(asset),asset,v.fields,null,'2026-01-01T00:00:00Z');await freshUploadedPdfDealer(c,true);return new Response(new Uint8Array(pdf.bytes),{headers:uploadedPdfDownloadHeaders('application/pdf','mallplacering.pdf',true)});}catch(e){const r=templateFailure(e);return NextResponse.json(r,{status:r.code==='access_denied'?403:r.code==='invalid_input'?400:r.code==='conflict'?409:503,headers:{'Cache-Control':'no-store'}});}}

function parseJson(body:Uint8Array):unknown{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{throw new UploadedPdfError('invalid_input','Kontrollera mallens fält.');}}
