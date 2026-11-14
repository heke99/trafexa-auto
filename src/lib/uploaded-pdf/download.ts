import 'server-only';
import {originalPdf,archiveUploadedPdf,readPdfBlob,type PdfService} from './server';
import type {UploadedPdfSource} from './types';
export async function uploadedPdfArtifact(db:PdfService,source:UploadedPdfSource,artifact:string,verifyAccess?:()=>Promise<unknown>){
 if(artifact==='original')return{bytes:await originalPdf(db,source),mime:'application/pdf',filename:source.filename};
 if(!source.companySignature||!source.customerSignature)throw Error('Completed document required');
 // A cancelled deal/read link never erases a dealer's already verified archive.
 const s=source.archive?source:await archiveUploadedPdf(db,source,verifyAccess);if(!s.archive)throw Error('Archive unavailable');
 if(artifact==='signed')return{bytes:await readPdfBlob(db,s.archive.pdfPath,s.archive.pdfSha256),mime:'application/pdf',filename:`signerat-${s.filename}`};
 if(artifact==='evidence')return{bytes:await readPdfBlob(db,s.archive.evidencePath,s.archive.evidenceSha256),mime:'application/json',filename:'signeringsbevis.json'};
 throw Error('Unknown artifact');
}
export function uploadedPdfDownloadHeaders(mime:string,filename:string,inline=false){const safe=filename.replace(/[^A-Za-z0-9._-]/g,'_');return{'Content-Type':mime,'Content-Disposition':`${inline?'inline':'attachment'}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'"};}
