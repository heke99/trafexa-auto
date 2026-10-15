import { createClient } from '@supabase/supabase-js';
import { verifyAdvertisingInvoiceEmailWebhook } from '@/lib/email/advertising-invoice-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const reply = (status: number) => new Response(status === 200 ? 'OK' : 'Webhook unavailable', { status, headers });
const MAX_BODY = 65536;
async function rawBody(request: Request) {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw Error('Body too large');
  if (!request.body) throw Error('Missing body');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let count = 0, expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; count += part.value.length; if (count > MAX_BODY) throw Error('Body too large'); chunks.push(part.value); }
    if (expired) throw Error('Body timeout');
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { clearTimeout(timer); }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET, key = process.env.SUPABASE_SECRET_KEY;
  if (!secret || !key || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://buqdtssxrotkzndublrt.supabase.co') return reply(503);
  let event;
  try { event = verifyAdvertisingInvoiceEmailWebhook(await rawBody(request), request.headers, secret); }
  catch { return reply(400); }
  if (event === null) return reply(200);
  try {
    const db = createClient('https://buqdtssxrotkzndublrt.supabase.co', key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const result = await db.rpc('apply_advertising_invoice_email_event', {
      p_event_id: event.eventId, p_provider_id: event.providerId, p_event_type: event.eventType,
      p_event_at: event.eventAt, p_recipient_hash: event.recipientHash, p_email_id: event.emailId,
    });
    if (result.error || !result.data || typeof result.data !== 'object' || Array.isArray(result.data) || result.data.ok !== true) return reply(503);
    return reply(200);
  } catch { return reply(503); }
}
