export const EMAIL_KINDS = ['application_received','application_admin','account_approved','offer_invitation','contract_invitation','contract_completed','contract_completed_company'] as const;
export type EmailKind = typeof EMAIL_KINDS[number];
export type TransactionalEmail = { id:string; kind:EmailKind; reference:string; recipient:string; createdAt:string };
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validRecipient(value:unknown):value is string{return typeof value==='string'&&value.length<=254&&!/[\s\u0000-\u001f\u007f]/.test(value)&&/^[^@]+@[^@]+\.[^@]+$/.test(value);}
function escape(value:string){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
/** URLs contain reference IDs, never credentials. Access is checked after login. */
export function renderTransactionalEmail(email:TransactionalEmail){
 if(!UUID.test(email.id)||!UUID.test(email.reference)||!validRecipient(email.recipient)||!EMAIL_KINDS.includes(email.kind))throw new Error('Invalid email envelope');
 const content:Record<EmailKind,[string,string,string,string]>={
 application_received:['Vi har tagit emot din ansökan','Tack för din ansökan till Trafexa. Vi granskar den och återkommer. Ansökan skapar inget konto och innebär inget produktgodkännande.','https://www.trafexa.com','Besök Trafexa'],
 application_admin:['Ny ansökan hos Trafexa','En ny ansökan har registrerats. Logga in i superadmin för att granska uppgifterna.','https://app.trafexa.com/admin','Granska ansökningar'],
 account_approved:['Ditt Trafexa-konto är godkänt','Ditt konto har godkänts av Trafexa. Logga in för att fortsätta. Företags- och produktbehörigheter hanteras separat.','https://app.trafexa.com/login','Logga in'],
 offer_invitation:['En offert väntar på din granskning','Bilhandlaren har skickat en offert för granskning. Logga in med den e-postadress som fått detta mejl.','https://app.trafexa.com/my-offers','Granska offerten'],
 contract_invitation:['Ett avtal väntar på din underskrift','Du har fått ett avtal för granskning och elektronisk underskrift. Logga in med den e-postadress som fått detta mejl.',`https://app.trafexa.com/my-contracts?contract=${email.reference}`,'Granska avtalet'],
 contract_completed_company:['Avtalet är undertecknat','Alla parter har undertecknat avtalet. Öppna affären för att hämta avtalet och signeringsbeviset.','https://app.trafexa.com/deals','Öppna affären'],
 contract_completed:['Avtalet är undertecknat','Alla parter har undertecknat avtalet. Logga in för att hämta avtalet och signeringsbeviset.',`https://app.trafexa.com/my-contracts?contract=${email.reference}`,'Visa avtalet']};
 const [subject,body,url,label]=content[email.kind];
 return {subject,text:`${body}\n\n${label}: ${url}\n\nFrågor? Kontakta info@trafexa.com\nTrafexa Nordic AB · 556855-4884`,html:`<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#17212b"><table role="presentation" width="100%"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:600px;margin:auto;background:#fff;border-radius:16px"><tr><td style="padding:32px"><div style="font-size:24px;font-weight:700">TRAFEXA</div><h1 style="font-size:22px">${escape(subject)}</h1><p style="line-height:1.6">${escape(body)}</p><p><a href="${escape(url)}" style="display:inline-block;padding:14px 20px;background:#173d35;color:#fff;text-decoration:none;border-radius:8px">${escape(label)}</a></p><p style="line-height:1.6">Om knappen inte fungerar: <a href="${escape(url)}">${escape(url)}</a></p><p>Frågor? <a href="mailto:info@trafexa.com">info@trafexa.com</a></p><p style="font-size:12px">Trafexa Nordic AB · 556855-4884</p></td></tr></table></td></tr></table></body></html>`};
}
