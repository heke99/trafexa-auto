import { z } from 'zod';
import { UPLOADED_PDF_CONSENT, UPLOADED_PDF_MAX_BYTES, type UploadedPdfSource } from './types';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),date=z.string().datetime({offset:true});
const receipt=z.object({actorId:uuid.nullable(),fullName:z.string().min(2).max(160),signedAt:date,documentHash:hash,consentVersion:z.literal(UPLOADED_PDF_CONSENT)}).strict();
const source=z.object({id:uuid,companyId:uuid,dealId:uuid,customerId:uuid,companyName:z.string().min(1).max(200),recipientName:z.string().min(1).max(200),recipientEmail:z.string().email().max(254),filename:z.string().min(5).max(160).regex(/^[^\u0000-\u001f\u007f/\\]+\.pdf$/i),originalSha256:hash,byteSize:z.number().int().min(5).max(UPLOADED_PDF_MAX_BYTES),pageCount:z.number().int().min(1).max(100),objectPath:z.string(),documentHash:hash,canonicalContent:z.string().min(2).max(4000),createdAt:date,expiresAt:date,linkRevoked:z.boolean(),status:z.enum(['draft','pending','completed','unavailable']),companySignature:receipt.nullable(),customerSignature:receipt.nullable(),delivery:z.enum(['queued','processing','sent','rejected','unknown']).nullable(),archive:z.object({pdfPath:z.string(),pdfSha256:hash,evidencePath:z.string(),evidenceSha256:hash}).strict().nullable()}).strict();
export const uploadedPdfId=(v:unknown)=>uuid.parse(v);
export function uploadedPdfSource(v:unknown,expected?:{companyId?:string;dealId?:string;id?:string}):UploadedPdfSource{
 const s=source.parse(v),root=`${s.companyId}/uploaded-pdfs/${s.id}/`;
 if(expected?.companyId&&s.companyId!==expected.companyId||expected?.dealId&&s.dealId!==expected.dealId||expected?.id&&s.id!==expected.id||s.objectPath!==`${root}original-${s.originalSha256}.pdf`)throw Error('Document scope mismatch');
 if(s.archive&&(s.archive.pdfPath!==`${root}signed-${s.archive.pdfSha256}.pdf`||s.archive.evidencePath!==`${root}evidence-${s.archive.evidenceSha256}.json`))throw Error('Archive scope mismatch');
 if(s.status==='draft'&&(s.companySignature||s.customerSignature)||s.status==='pending'&&(!s.companySignature||s.customerSignature)||s.status==='completed'&&(!s.companySignature||!s.customerSignature))throw Error('Invalid document state');
 if(s.companySignature?.actorId===null||s.customerSignature&&s.customerSignature.actorId!==null)throw Error('Invalid actor receipt');
 for(const r of[s.companySignature,s.customerSignature])if(r&&(r.documentHash!==s.documentHash||Date.parse(r.signedAt)<Date.parse(s.createdAt)))throw Error('Invalid signature binding');
 const c=JSON.parse(s.canonicalContent);if(c.schemaVersion!==1||c.kind!=='uploaded_pdf'||c.sourceId!==s.id||c.companyId!==s.companyId||c.dealId!==s.dealId||c.customerId!==s.customerId||c.filename!==s.filename||c.originalSha256!==s.originalSha256||c.byteSize!==s.byteSize||c.pageCount!==s.pageCount||c.recipientName!==s.recipientName||c.recipientEmail!==s.recipientEmail)throw Error('Invalid source content');
 return s;
}
