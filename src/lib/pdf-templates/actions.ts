'use server';
import{z}from'zod';
import{requireDealerSigningContext}from'@/lib/contracts/signing-context';
import{pdfRpc,uploadedPdfService,freshUploadedPdfDealer,storePdfBlob,UploadedPdfError}from'../uploaded-pdf/server';
import{uploadedPdfSource}from'../uploaded-pdf/validation';
import{parsePdfTemplateVersion,templateFields,templateUuid}from'./validation';
import{readTemplateAsset,templateAssetBytes,templateFailure}from'./server';
import{fillPdfTemplate}from'./pdf';
import{PDF_TEMPLATE_KEYS,type PdfTemplateResult,type PdfTemplateVersion,type SavePdfTemplateVersionInput,type GeneratePdfTemplateInput,type GeneratedPdfTemplateResult}from'./types';
export async function listPdfTemplateVersionsAction(value:{companyId:string;search?:string;beforeTemplateId?:string}):Promise<PdfTemplateResult<{templates:PdfTemplateVersion[];nextBeforeTemplateId:string|null}>>{
 try{
  const v=z.object({companyId:templateUuid,search:z.string().trim().max(160).regex(/^[^\u0000-\u001f\u007f]*$/).default(''),beforeTemplateId:templateUuid.optional()}).strict().parse(value);
  const c=await requireDealerSigningContext(v.companyId,true);
  const r=await pdfRpc(c.db as never,'list_pdf_template_selection',{p_company_id:v.companyId,p_search:v.search,p_before_template_id:v.beforeTemplateId??null}) as Record<string,unknown>;
  if(r.actorId!==c.userId||r.companyId!==v.companyId)throw new UploadedPdfError('access_denied');
  if(!Array.isArray(r.templates)||r.templates.length>50)throw new Error('Invalid template page');
  const templates=r.templates.map(t=>parsePdfTemplateVersion(t,v.companyId));
  const nextBeforeTemplateId=r.nextBeforeTemplateId===null?null:templateUuid.parse(r.nextBeforeTemplateId);
  if(templates.some((t,i)=>v.beforeTemplateId!==undefined&&t.templateId>=v.beforeTemplateId||i>0&&t.templateId>=templates[i-1].templateId)
   ||nextBeforeTemplateId!==null&&(templates.length!==50||nextBeforeTemplateId!==templates.at(-1)?.templateId))throw new Error('Invalid template page');
  await freshUploadedPdfDealer(c,true);
  return{ok:true,templates,nextBeforeTemplateId};
 }catch(e){return templateFailure(e);}
}
export async function savePdfTemplateVersionAction(value:SavePdfTemplateVersionInput):Promise<PdfTemplateResult<{template:PdfTemplateVersion}>>{try{const v=z.object({companyId:templateUuid,assetId:templateUuid,templateId:templateUuid,expectedVersion:z.number().int().min(0).max(2147483646),title:z.string().trim().min(2).max(160).regex(/^[^\u0000-\u001f\u007f]+$/),fields:templateFields,requestId:templateUuid,acknowledged:z.literal(true)}).strict().parse(value),c=await requireDealerSigningContext(v.companyId,true),asset=await readTemplateAsset(c,v.assetId);await fillPdfTemplate(await templateAssetBytes(asset),asset,v.fields,null,'2026-01-01T00:00:00Z');await freshUploadedPdfDealer(c,true);const r=await pdfRpc(c.db as never,'save_pdf_template_version',{p_company_id:v.companyId,p_asset_id:v.assetId,p_template_id:v.templateId,p_expected_version:v.expectedVersion,p_title:v.title,p_fields:v.fields,p_request_id:v.requestId,p_acknowledged:true})as Record<string,unknown>;if(r.actorId!==c.userId)throw new UploadedPdfError('access_denied');const template=parsePdfTemplateVersion(r.template,v.companyId);if(template.templateId!==v.templateId||template.asset.id!==v.assetId||template.title!==v.title||template.version!==v.expectedVersion+1||JSON.stringify(template.fields)!==JSON.stringify(v.fields))throw Error('Invalid saved template');await freshUploadedPdfDealer(c,true);return{ok:true,template};}catch(e){return templateFailure(e);}}
export async function generatePdfTemplateSourceAction(value:GeneratePdfTemplateInput):Promise<GeneratedPdfTemplateResult>{try{const v=z.object({companyId:templateUuid,dealId:templateUuid,templateVersionId:templateUuid,requestId:templateUuid,acknowledged:z.literal(true)}).strict().parse(value),c=await requireDealerSigningContext(v.companyId,true),r=await pdfRpc(c.db as never,'prepare_pdf_template_document',{p_company_id:v.companyId,p_deal_id:v.dealId,p_template_version_id:v.templateVersionId,p_request_id:v.requestId,p_acknowledged:true})as Record<string,unknown>;if(r.actorId!==c.userId||r.companyId!==v.companyId||r.dealId!==v.dealId||r.sourceId!==v.requestId||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt))||typeof r.dataSha256!=='string'||!/^[a-f0-9]{64}$/.test(r.dataSha256))throw new UploadedPdfError('access_denied');const template=parsePdfTemplateVersion(r.template,v.companyId);if(template.id!==v.templateVersionId)throw new UploadedPdfError('access_denied');const data=z.record(z.string(),z.string()).parse(r.data),keys=new Set(template.fields.map(f=>f.key));if(Object.keys(data).length!==keys.size||Object.keys(data).some(k=>!keys.has(k as typeof PDF_TEMPLATE_KEYS[number])))throw Error('Invalid mapped data');await freshUploadedPdfDealer(c,true);const output=await fillPdfTemplate(await templateAssetBytes(template.asset),template.asset,template.fields,data,r.createdAt),service=uploadedPdfService();await freshUploadedPdfDealer(c,true);await storePdfBlob(service,`${v.companyId}/uploaded-pdfs/${v.requestId}/original-${output.sha256}.pdf`,output.bytes,'application/pdf');await freshUploadedPdfDealer(c,true);const registered=await pdfRpc(service,'register_pdf_template_document',{p_actor_id:c.userId,p_company_id:v.companyId,p_source_id:v.requestId,p_sha256:output.sha256,p_byte_size:output.byteSize,p_page_count:output.pageCount});
 const source=validateGeneratedSource(registered,{id:v.requestId,companyId:v.companyId,dealId:v.dealId});await freshUploadedPdfDealer(c,true);return{ok:true,source};}catch(e){return templateFailure(e);}}


function validateGeneratedSource(value:unknown,scope:{id:string;companyId:string;dealId:string}){
 try{return uploadedPdfSource(value,scope);}
 catch{throw new UploadedPdfError('unavailable');}
}
