import { guestDocumentToken } from '@/lib/guest-customer/token';
import { validRecipient } from './templates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }

/** One frozen document and recipient; the link never creates or authenticates an account. */
export function renderCustomerContractInvitationBody(input: { emailId: string; invitationId: string; referenceId: string; kind: 'contract_invitation' | 'offer_invitation' | 'contract_completed'; recipient: string; token: string; expiresAt: string }): string {
  const capability = guestDocumentToken(input.invitationId, input.token);
  if (!capability || ![input.emailId, input.referenceId].every(value => UUID.test(value)) || !['contract_invitation', 'offer_invitation', 'contract_completed'].includes(input.kind) || !validRecipient(input.recipient) || !Number.isFinite(Date.parse(input.expiresAt))) throw Error('Invalid document invitation');
  const offer = input.kind === 'offer_invitation';
  const completed = input.kind === 'contract_completed';
  const subject = completed ? 'Avtalet är undertecknat' : offer ? 'En offert väntar på dig' : 'Ett avtal väntar på din underskrift';
  const intro = completed ? 'Alla parter har skrivit under avtalet.' : offer ? 'Du har fått en offert att granska via Trafexa.' : 'Du har fått ett avtal för granskning och underskrift via Trafexa.';
  const instructions = completed ? 'Öppna din personliga länk för att hämta ditt signerade avtal och signeringsbeviset. Du behöver inget konto eller lösenord.' : offer ? 'Öppna din personliga länk för att granska och svara på offerten. Du behöver inget konto eller lösenord.' : 'Öppna din personliga länk för att granska och skriva under avtalet. Du behöver inget konto eller lösenord.';
  const expiry = `Länken gäller till ${new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(input.expiresAt))} (svensk tid).`;
  const account = (offer ? 'Din granskning gäller den offert som visas när du öppnar länken.' : 'När alla parter har skrivit under kan du hämta avtalet som PDF och signeringsbeviset via samma länk.') + ' ' + expiry;
  const security = 'Länken ger tillgång till ditt dokument. Dela eller vidarebefordra den inte. Kontakta avsändaren om du behöver en ny länk.';
  const label = completed ? 'Hämta ditt avtal' : offer ? 'Granska offerten' : 'Granska och skriv under';
  const url = `https://app.trafexa.com/customer-document/invitation?${new URLSearchParams({ invitation: capability.invitationId, token: capability.token })}`;
  return JSON.stringify({
    from: 'Trafexa <kundtjanst@trafexa.com>', reply_to: 'info@trafexa.com', to: [input.recipient], subject,
    text: `${intro}\n\n${instructions}\n\n${label}: ${url}\n\n${account}\n\n${security}\n\nFrågor om dokumentet? Kontakta avsändaren. Behöver du teknisk hjälp? Kontakta info@trafexa.com.\n\nTrafexa Nordic AB · 556855-4884`,
    html: `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#17212b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-radius:16px"><tr><td style="padding:32px"><div style="font-size:24px;font-weight:700">TRAFEXA</div><h1 style="font-size:24px;line-height:1.3">${subject}</h1><p style="line-height:1.6">${intro}</p><p style="line-height:1.6">${instructions}</p><p style="margin:24px 0"><a href="${escape(url)}" style="display:inline-block;padding:14px 20px;background:#173d35;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">${label}</a></p><p style="font-size:14px;line-height:1.6">Om knappen inte fungerar, öppna den här länken:<br><a href="${escape(url)}" style="color:#173d35;word-break:break-all;overflow-wrap:anywhere">${escape(url)}</a></p><p style="line-height:1.6">${account}</p><p style="font-size:14px;line-height:1.6">${security}</p><p style="line-height:1.6">Frågor om dokumentet? Kontakta avsändaren. Behöver du teknisk hjälp? Kontakta <a href="mailto:info@trafexa.com" style="color:#173d35">info@trafexa.com</a>.</p><p style="font-size:12px;color:#52606d">Trafexa Nordic AB · 556855-4884</p></td></tr></table></td></tr></table></body></html>`,
    tags: [{ name: 'kind', value: 'guest_document_invitation' }, { name: 'email_id', value: input.emailId.toLowerCase() }],
  });
}
