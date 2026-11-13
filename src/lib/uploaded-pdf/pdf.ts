import {createHash} from 'node:crypto';
import {PDFDocument,PDFName,PDFDict,PDFArray,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {getContractPdfFontBytes,assertContractPdfName} from '../documents/contract-pdf-font';
import {UPLOADED_PDF_MAX_BYTES,type UploadedPdfSource,type PdfReceipt} from './types';
export const uploadedPdfHash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
/** Accept a static, readable PDF only. The original is retained byte-for-byte. */
export async function inspectUploadedPdf(bytes:Uint8Array){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<5||bytes.byteLength>UPLOADED_PDF_MAX_BYTES||new TextDecoder('ascii').decode(bytes.subarray(0,5))!=='%PDF-')throw Error('Välj en PDF-fil på högst 4 MB.');
 const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false,throwOnInvalidObject:true});
 if(pdf.isEncrypted||pdf.getPageCount()<1||pdf.getPageCount()>100)throw Error('PDF-filen måste vara okrypterad och innehålla 1–100 sidor.');
 // No script/actions, embedded files or existing signature fields whose visible
 // state could differ from the immutable agreement shown to the recipient.
 const prohibited=new Set(['JavaScript','JS','OpenAction','AA','EmbeddedFiles','XFA','RichMedia','Perms','DocMDP','UR3','Launch','SubmitForm','ImportData']);
 const visited=new Set<object>();
 const walk=(object:unknown):void=>{if(!(object instanceof PDFDict||object instanceof PDFArray)||visited.has(object))return;visited.add(object);
  if(object instanceof PDFArray){for(let i=0;i<object.size();i++)walk(object.get(i));return;}
  for(const[key,value]of object.entries()){
   if(prohibited.has(key.asString().slice(1))||value instanceof PDFName&&['/JavaScript','/Launch','/SubmitForm','/ImportData','/GoToR','/RichMedia','/Movie','/Sound','/FileAttachment','/Screen','/EmbeddedFile','/Sig'].includes(value.asString())||key.asString()==='/S'&&value instanceof PDFName&&['/JavaScript','/Launch','/SubmitForm','/ImportData','/GoToR'].includes(value.asString())||key.asString()==='/FT'&&value instanceof PDFName&&value.asString()==='/Sig')throw Error('PDF-filen innehåller aktiva funktioner eller en tidigare digital signatur. Ladda upp en statisk PDF.');
   walk(value);
  }
 };
 walk(pdf.catalog);for(const[,object]of pdf.context.enumerateIndirectObjects())walk(object);
 if(pdf.catalog.has(PDFName.of('AcroForm'))){const form=pdf.getForm();if(form.getFields().length)throw Error('PDF-filen innehåller formulärfält. Exportera en statisk PDF före uppladdning.');}
 return {sha256:uploadedPdfHash(bytes),pageCount:pdf.getPageCount(),byteSize:bytes.byteLength};
}
export async function renderUploadedPdfArtifacts(original:Uint8Array,source:UploadedPdfSource,proposed?:{companySignature?:PdfReceipt;customerSignature?:PdfReceipt}){
 const info=await inspectUploadedPdf(original);if(info.sha256!==source.originalSha256||info.byteSize!==source.byteSize||info.pageCount!==source.pageCount||uploadedPdfHash(source.canonicalContent)!==source.documentHash)throw Error('PDF-originalet kunde inte verifieras.');
 const company=proposed?.companySignature??source.companySignature,customer=proposed?.customerSignature??source.customerSignature;
 if(!company)throw Error('Seller approval required');for(const receipt of[company,customer])if(receipt){await assertContractPdfName(receipt.fullName);if(receipt.documentHash!==source.documentHash)throw Error('Signature source changed');}
 const pdf=await PDFDocument.load(original,{updateMetadata:false});pdf.registerFontkit(fontkit);const font=await pdf.embedFont(await getContractPdfFontBytes(),{subset:true});
 const at=customer?.signedAt??company.signedAt;pdf.setCreationDate(new Date(source.createdAt));pdf.setModificationDate(new Date(at));pdf.setProducer('Trafexa uploaded PDF signing v1');pdf.setCreator('Trafexa');
 const page=pdf.addPage([595.28,841.89]);let y=790;const line=(t:string,size=11)=>{page.drawText(t,{x:42,y,size,font,color:rgb(.1,.2,.18)});y-=size+13;};
 line('SIGNERINGSBEVIS – BILAGA TILL PDF-ORIGINAL',17);line('Originalets innehåll ligger på föregående sidor.');line('En signeringssida har lagts till. Originalfilen bevaras separat.');y-=12;
 line(`Dokument-id: ${source.id}`,9);line('Originalfilens SHA-256:',10);line(source.originalSha256,8);line('Avtalsunderlagets SHA-256:',10);line(source.documentHash,8);y-=15;
 line('Säljaren har godkänt dokumentet för företaget',13);line(company.fullName);line(company.signedAt,9);y-=15;
 line(customer?'Kundens underskrift':'Förhandsgranskning – kunden har ännu inte skrivit under',13);if(customer){line(customer.fullName);line(customer.signedAt,9);}
 y-=18;line('Metod: namn och uttrycklig bekräftelse via personlig mejllänk.',9);line('Säljaren använde ett behörigt Trafexakonto.',9);line('Detta är en enkel elektronisk underskrift, inte BankID eller',9);line('en certifikatbaserad PDF-signatur.',9);
 const output=new Uint8Array(await pdf.save({useObjectStreams:false}));if(output.byteLength>4.25*1024*1024)throw Error('Signed PDF too large');
 const evidence={schemaVersion:1,method:'trafexa-uploaded-pdf-simple-electronic-signature',sourceId:source.id,companyId:source.companyId,dealId:source.dealId,originalPdfSha256:source.originalSha256,documentContentSha256:source.documentHash,signedPdfSha256:uploadedPdfHash(output),originalPageCount:source.pageCount,signedPageCount:source.pageCount+1,company:{...company,authenticationMethod:'authorized_account'},customer:customer?{...customer,authenticationMethod:'email_link',approvalMethod:'typed_name',recipientEmail:source.recipientEmail}:null,assurance:'Original PDF retained byte-for-byte; a signature evidence page is appended. Email-link possession is not independent identity verification, BankID or a certificate-based PDF signature.'};
 return {pdf:output,evidence:new TextEncoder().encode(JSON.stringify(evidence,null,2))};
}
