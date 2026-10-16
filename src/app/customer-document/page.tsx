import {GuestCustomerDocument} from '@/components/guest-customer-document';
import {getGuestCustomerDocumentAction} from '@/lib/data/guest-customer-actions';

export const dynamic='force-dynamic';
export const metadata={title:'Ditt dokument från bilhandlaren',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function CustomerDocumentPage(){
 const result=await getGuestCustomerDocumentAction();
 if(!result.ok)return <main className="guest-document-page"><header className="guest-document-brand"><strong>TRAFEXA</strong><span>Personligt dokument</span></header><section className="guest-document-card"><h1>Dokumentet kunde inte öppnas</h1><p role="alert">{result.message}</p><p>Öppna den personliga länken i mejlet från din bilhandlare. Om länken inte längre fungerar, be bilhandlaren om hjälp. Du behöver inget konto eller lösenord.</p></section></main>;
 const document=result.document,key=document.kind==='offer'?document.review.id:document.signing.id;
 return <GuestCustomerDocument key={`${document.kind}:${key}`} initialDocument={document}/>;
}
