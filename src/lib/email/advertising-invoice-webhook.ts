import { createHash } from 'node:crypto';
import { Webhook } from 'svix';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid webhook');
  return value as Record<string, unknown>;
}
/** Verify the untouched raw body before interpreting any provider data. Svix enforces timestamp tolerance. */
export function verifyAdvertisingInvoiceEmailWebhook(raw: string, headers: Headers, secret: string) {
  const id = headers.get('svix-id'), timestamp = headers.get('svix-timestamp'), signature = headers.get('svix-signature');
  if (!id || !/^[a-zA-Z0-9_-]{1,200}$/.test(id) || !timestamp || !signature || signature.length > 4096 || raw.length > 65536) throw Error('Invalid webhook');
  new Webhook(secret).verify(raw, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature });
  const event = object(JSON.parse(raw));
  if (!['email.delivered', 'email.bounced', 'email.complained'].includes(String(event.type))) return null;
  const data = object(event.data), tags = data.tags === undefined ? {} : object(data.tags);
  // A dedicated tag isolates invoice messages from Auth, application and contract email events.
  if (typeof tags.trafexa_invoice_email_id !== 'string' || !uuid.test(tags.trafexa_invoice_email_id)) return null;
  if (typeof data.email_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.email_id)
    || typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at))
    || !Array.isArray(data.to) || data.to.length !== 1 || typeof data.to[0] !== 'string' || data.to[0].length > 254
    || /[\s\u0000-\u001f\u007f]/.test(data.to[0]) || !/^[^@]+@[^@]+\.[^@]+$/.test(data.to[0])) throw Error('Invalid invoice delivery event');
  const eventTime = Date.parse(event.created_at);
  if (eventTime > Date.now() + 5 * 60 * 1000) throw Error('Future event');
  return {
    emailId: tags.trafexa_invoice_email_id.toLowerCase(), eventId: id, providerId: data.email_id, eventType: String(event.type).slice(6) as 'delivered' | 'bounced' | 'complained',
    eventAt: new Date(eventTime).toISOString(),
    recipientHash: createHash('sha256').update(data.to[0].toLowerCase()).digest('hex'),
  };
}
