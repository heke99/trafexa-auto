import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { validRecipient } from './templates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function scope(id: string) { if (!UUID.test(id)) throw Error('Invalid invitation'); return `trafexa/account-invitation/${id.toLowerCase()}`; }
function key(secret: string) {
  if (secret.length < 20) throw Error('Invitation encryption unavailable');
  return Buffer.from(hkdfSync('sha256', secret, 'trafexa-account-invitation-v1', 'email-payload', 32));
}
/** Service-only encrypted outbox: bearer links never enter an admin DTO or a plaintext database column. */
export function encryptInvitationBody(body: string, invitationId: string, secret: string): string {
  if (Buffer.byteLength(body) > 24_000) throw Error('Invalid invitation payload');
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret), nonce);
  cipher.setAAD(Buffer.from(scope(invitationId)));
  const encrypted = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function decryptInvitationBody(value: string, invitationId: string, secret: string): string {
  if (value.length > 36_000 || !/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(value)) throw Error('Invalid invitation payload');
  const [, nonce, tag, data] = value.split('.');
  const cipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(nonce, 'base64url'));
  cipher.setAAD(Buffer.from(scope(invitationId))); cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8');
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
export function renderAccountInvitationBody(input: { invitationId: string; email: string; name: string; tokenHash: string }): string {
  scope(input.invitationId);
  if (!validRecipient(input.email) || !/^[a-f0-9]{64}$/.test(input.tokenHash) || input.name.length > 160 || /[\u0000-\u001f\u007f]/.test(input.name)) throw Error('Invalid invitation payload');
  const url = `https://app.trafexa.com/auth/invitation?token_hash=${input.tokenHash}`;
  const title = 'Din ansökan till Trafexa är godkänd';
  const intro = `Hej ${input.name}! Din ansökan har granskats och godkänts av Trafexa. Aktivera ditt konto genom att bekräfta din e-postadress och välja ett lösenord.`;
  const footer = 'Länken är personlig och kan användas en gång. Företags- och produktbehörigheter hanteras separat. Om länken har gått ut, kontakta info@trafexa.com för en ny inbjudan.';
  return JSON.stringify({ from: 'Trafexa <kundtjanst@trafexa.com>', reply_to: 'info@trafexa.com', to: [input.email], subject: title,
    text: `${intro}\n\nAktivera ditt konto: ${url}\n\n${footer}\n\nTrafexa Nordic AB · 556855-4884`,
    html: `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#17212b"><table role="presentation" width="100%"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:600px;margin:auto;background:#fff;border-radius:16px"><tr><td style="padding:32px"><div style="font-size:24px;font-weight:700">TRAFEXA</div><h1 style="font-size:22px">${title}</h1><p style="line-height:1.6">${escape(intro)}</p><p><a href="${url}" style="display:inline-block;padding:14px 20px;background:#173d35;color:#fff;text-decoration:none;border-radius:8px">Aktivera ditt konto</a></p><p style="line-height:1.6">${footer}</p><p>Frågor? <a href="mailto:info@trafexa.com">info@trafexa.com</a></p><p style="font-size:12px">Trafexa Nordic AB · 556855-4884</p></td></tr></table></td></tr></table></body></html>`,
    tags: [{ name: 'kind', value: 'account_invitation' }, { name: 'invitation_id', value: input.invitationId.toLowerCase() }],
  });
}
