import {fixture as base,pdfFixture,C,D,id} from '../uploaded-pdf/fixture.mjs';
export {pdfFixture,C,D,id};
export const ASSET=id(100),FAMILY=id(101),SAVE=id(102),GENERATE=id(103);
export const fields=[{id:id(110),key:'customer.name',pageIndex:0,x:.1,y:.1,width:.7,height:.06,fontSize:12},{id:id(111),key:'vehicle.registration',pageIndex:0,x:.1,y:.2,width:.7,height:.06,fontSize:12},{id:id(112),key:'deal.price',pageIndex:0,x:.1,y:.3,width:.7,height:.06,fontSize:12}];
export async function fixture(t){const h=await base(t),actions=h.loader.load('@/lib/pdf-templates/actions'),uploadRoute=h.loader.load('@/app/api/pdf-templates/upload/route'),previewRoute=h.loader.load('@/app/api/pdf-templates/preview/route'),assetRoute=h.loader.load('@/app/api/pdf-templates/assets/[id]/route');
async function upload(bytes,assetId=ASSET){const form=new FormData();form.set('assetId',assetId);form.set('file',new File([bytes??await pdfFixture()],'background.pdf',{type:'application/pdf'}));const response=await uploadRoute.POST(new h.NextRequest(`https://app.fixture.invalid/api/pdf-templates/upload?companyId=${C}`,{method:'POST',headers:{origin:'https://app.fixture.invalid'},body:form}));return{response,result:await response.json()};}
const save=(assetId=ASSET,mapping=fields,extra={})=>actions.savePdfTemplateVersionAction({companyId:C,assetId,templateId:FAMILY,expectedVersion:0,title:'Bilavtal',fields:mapping,requestId:SAVE,acknowledged:true,...extra});
const generate=(templateVersionId,extra={})=>actions.generatePdfTemplateSourceAction({companyId:C,dealId:D,templateVersionId,requestId:GENERATE,acknowledged:true,...extra});
return{...h,templateActions:actions,templateUpload:upload,templateSave:save,templateGenerate:generate,templatePreviewRoute:previewRoute,templateAssetRoute:assetRoute};}
