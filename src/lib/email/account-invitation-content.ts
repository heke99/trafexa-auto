import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { validRecipient } from './templates';
import { validAccountInvitationToken } from '@/lib/auth/account-invitation-token';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function scope(id: string) { if (!UUID.test(id)) throw Error('Invalid invitation'); return `trafexa/account-invitation/${id.toLowerCase()}`; }
function key(secret: string) {
  if (secret.length < 20) throw Error('Invitation encryption unavailable');
  return Buffer.from(hkdfSync('sha256', secret, 'trafexa-account-invitation-v1', 'email-payload', 32));
}
export type InvitationKeyring={activeKeyId:string;keys:Record<string,string>;legacySecrets?:string[]};
export class InvitationKeyUnavailableError extends Error {constructor(){super('Invitation encryption key unavailable');}}
const KEY_ID=/^[A-Za-z0-9_-]{1,48}$/;
function versionedKey(secret:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(secret))throw new InvitationKeyUnavailableError();
 const bytes=Buffer.from(secret,'base64url');if(bytes.length!==32||bytes.toString('base64url')!==secret)throw new InvitationKeyUnavailableError();
 return Buffer.from(hkdfSync('sha256',bytes,'trafexa-account-invitation-v2','email-payload',32));
}
/** Independent encryption keys; old service secrets are read-only legacy migration keys. */
export function invitationKeyringFromEnvironment():InvitationKeyring{
 try{
  const keys:unknown=JSON.parse(process.env.ACCOUNT_INVITATION_ENCRYPTION_KEYS??'{}');
  const legacy:unknown=JSON.parse(process.env.ACCOUNT_INVITATION_LEGACY_SECRETS??'[]');
  if(!keys||typeof keys!=='object'||Array.isArray(keys)||Object.keys(keys).length>20||!Array.isArray(legacy)||legacy.length>20||legacy.some(v=>typeof v!=='string'||v.length<20))throw Error();
  for(const [id,value]of Object.entries(keys)){if(!KEY_ID.test(id)||typeof value!=='string')throw Error();versionedKey(value);}
  return {activeKeyId:process.env.ACCOUNT_INVITATION_ACTIVE_KEY_ID??'',keys:keys as Record<string,string>,legacySecrets:[...legacy,...(process.env.SUPABASE_SECRET_KEY?[process.env.SUPABASE_SECRET_KEY]:[])]};
 }catch{throw new InvitationKeyUnavailableError();}
}
/** String input remains a v1 fixture/legacy API; production writes use an explicit v2 keyring. */
export function encryptInvitationBody(body:string,invitationId:string,secret:string|InvitationKeyring):string{
 if(Buffer.byteLength(body)>24_000)throw Error('Invalid invitation payload');
 const version=typeof secret==='string'?'v1':'v2';
 const id=typeof secret==='string'?'':secret.activeKeyId;
 if(version==='v2'&&(!KEY_ID.test(id)||!Object.hasOwn((secret as InvitationKeyring).keys,id)))throw new InvitationKeyUnavailableError();
 const bytes=typeof secret==='string'?key(secret):versionedKey(secret.keys[id]);
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',bytes,nonce);
 cipher.setAAD(Buffer.from(scope(invitationId)+(version==='v2'?`/v2/${id}`:'')));
 const encrypted=Buffer.concat([cipher.update(body,'utf8'),cipher.final()]);
 return [version,...(version==='v2'?[id]:[]),nonce.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function decryptInvitationBody(value:string,invitationId:string,secret:string|InvitationKeyring):string{
 if(value.length>36_000||!/^v[12]\.(?:[A-Za-z0-9_-]{1,48}\.)?[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid invitation payload');
 const parts=value.split('.'),version=parts[0];
 const decode=(nonce:string,tag:string,data:string,bytes:Buffer,aad:string)=>{const cipher=createDecipheriv('aes-256-gcm',bytes,Buffer.from(nonce,'base64url'));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([cipher.update(Buffer.from(data,'base64url')),cipher.final()]).toString('utf8');};
 if(version==='v2'){
  if(parts.length!==5||typeof secret==='string'||!Object.hasOwn(secret.keys,parts[1]))throw new InvitationKeyUnavailableError();
  const [,id,nonce,tag,data]=parts;return decode(nonce,tag,data,versionedKey(secret.keys[id]),scope(invitationId)+`/v2/${id}`);
 }
 if(parts.length!==4)throw Error('Invalid invitation payload');
 const [,nonce,tag,data]=parts;const legacy=typeof secret==='string'?[secret]:secret.legacySecrets??[];
 for(const previous of legacy)try{return decode(nonce,tag,data,key(previous),scope(invitationId));}catch{}
 // v1 has no key ID, so absent old key and failed authentication cannot safely be distinguished.
 throw new InvitationKeyUnavailableError();
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
export function renderAccountInvitationBody(input: { invitationId: string; email: string; name: string; tokenHash: string }): string {
  scope(input.invitationId);
  if (!validRecipient(input.email) || !validAccountInvitationToken(input.tokenHash) || input.name.length > 160 || /[\u0000-\u001f\u007f]/.test(input.name)) throw Error('Invalid invitation payload');
  const url = `https://app.trafexa.com/auth/invitation?token_hash=${input.tokenHash}`;
  const subject = 'Välkommen till Trafexa – din ansökan är godkänd';
  const title = 'Välkommen till Trafexa!';
  const intro = `Hej ${input.name}! Din ansökan till Trafexa har granskats och godkänts. Vi ser fram emot att hjälpa dig och ditt företag att komma igång.`;
  const nextStep = 'Aktivera ditt konto för att bekräfta din e-postadress och välja ett lösenord. Därefter kan du logga in på Trafexa.';
  const access = 'Tillgång till företag och produkter hanteras separat. Finansiering kräver ett separat godkännande.';
  const footer = 'Länken är personlig och kan användas en gång. Vidarebefordra inte detta mejl. Om länken har gått ut, kontakta info@trafexa.com för hjälp med en ny inbjudan.';
  return JSON.stringify({ from: 'Trafexa <kundtjanst@trafexa.com>', reply_to: 'info@trafexa.com', to: [input.email], subject,
    text: `${title}\n\n${intro}\n\n${nextStep}\n\nAktivera ditt konto: ${url}\n\n${access}\n\n${footer}\n\nFrågor? Svara på det här mejlet eller kontakta info@trafexa.com.\n\nTrafexa Nordic AB · 556855-4884`,
    html: `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#17212b"><div style="display:none;max-height:0;overflow:hidden">Din ansökan är godkänd. Aktivera ditt konto och kom igång med Trafexa.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-radius:16px"><tr><td style="padding:32px"><div style="font-size:24px;font-weight:700">TRAFEXA</div><h1 style="font-size:26px;line-height:1.3">${title}</h1><p style="line-height:1.6">${escape(intro)}</p><h2 style="font-size:18px;line-height:1.4">Ditt nästa steg</h2><p style="line-height:1.6">${nextStep}</p><p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:14px 20px;background:#173d35;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Aktivera ditt konto</a></p><p style="line-height:1.6;font-size:14px">Om knappen inte fungerar, kopiera den här länken till din webbläsare:<br><a href="${url}" style="color:#173d35;word-break:break-all;overflow-wrap:anywhere">${url}</a></p><p style="line-height:1.6">${access}</p><p style="line-height:1.6;font-size:14px">${footer}</p><p style="line-height:1.6">Frågor? Svara på det här mejlet eller kontakta <a href="mailto:info@trafexa.com" style="color:#173d35">info@trafexa.com</a>.</p><p style="font-size:12px;line-height:1.5;color:#52606d">Trafexa Nordic AB · 556855-4884</p></td></tr></table></td></tr></table></body></html>`,
    tags: [{ name: 'kind', value: 'account_invitation' }, { name: 'invitation_id', value: input.invitationId.toLowerCase() }],
  });
}
