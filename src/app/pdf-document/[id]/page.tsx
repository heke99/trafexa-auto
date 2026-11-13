import {UploadedPdfGuest} from '@/components/uploaded-pdf-guest';
import {requireUploadedPdfGuest} from '@/lib/uploaded-pdf/server';
export const dynamic='force-dynamic';
export const metadata={title:'Granska PDF-avtal',robots:{index:false,follow:false}};
export default async function PdfDocumentPage({params}:{params:Promise<{id:string}>}){try{const{id}=await params,c=await requireUploadedPdfGuest(id);return <UploadedPdfGuest key={c.source.id} initialSource={c.source}/>;}catch{return <main className="guest-document-page"><h1>Dokumentet är inte tillgängligt</h1><p>Länken kan ha gått ut eller återkallats. Kontakta avsändaren för hjälp.</p></main>;}}
