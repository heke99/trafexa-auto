export const UPLOADED_PDF_CONSENT = '2026-11-13' as const;
export const UPLOADED_PDF_MAX_BYTES = 4 * 1024 * 1024;
export type PdfReceipt = { actorId:string|null;fullName: string; signedAt: string; documentHash: string; consentVersion: typeof UPLOADED_PDF_CONSENT };
export type UploadedPdfSource = {
 id:string;companyId:string;dealId:string;customerId:string;companyName:string;recipientName:string;recipientEmail:string;filename:string;
 originalSha256:string;byteSize:number;pageCount:number;objectPath:string;documentHash:string;canonicalContent:string;createdAt:string;expiresAt:string;
 linkRevoked:boolean;status:'draft'|'pending'|'completed'|'unavailable';companySignature:PdfReceipt|null;customerSignature:PdfReceipt|null;
 delivery:'queued'|'processing'|'sent'|'rejected'|'unknown'|null;
 archive:{pdfPath:string;pdfSha256:string;evidencePath:string;evidenceSha256:string}|null;
};
export type UploadedPdfPage = {companyId:string;dealId:string;actorId:string;recipientName:string;recipientEmail:string;documents:UploadedPdfSource[]};
export type UploadedPdfResult<T> = {ok:true}&T|{ok:false;code:'invalid_input'|'access_denied'|'conflict'|'unavailable';message:string};
