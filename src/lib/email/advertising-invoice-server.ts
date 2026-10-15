import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { requirePlatformAdminContext, PlatformAdminError } from '@/lib/platform-admin/context';
import { record } from '@/lib/advertising/billing-validation';
import { invoiceUuid } from '@/lib/advertising/issuance-validation';
import { parseAdvertisingInvoiceEmailJob } from '@/lib/advertising/invoice-email-validation';
import { prepareAdvertisingInvoiceEmail } from './advertising-invoice-content';
import { sendPreparedAdvertisingInvoiceEmail } from './advertising-invoice-transport';

const PROJECT_URL = 'https://buqdtssxrotkzndublrt.supabase.co';
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
export type AdvertisingEmailDispatchStatus = 'accepted' | 'pending' | 'rejected' | 'unknown' | 'cancelled' | 'empty' | 'unconfigured' | 'unavailable' | 'busy';
export function advertisingInvoiceEmailConfigured() {
  return process.env.ADVERTISING_INVOICE_EMAIL_ENABLED === 'true'
    && process.env.TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED === 'true'
    && process.env.NEXT_PUBLIC_SUPABASE_URL === PROJECT_URL
    && Boolean(process.env.RESEND_API_KEY) && Boolean(process.env.SUPABASE_SECRET_KEY) && Boolean(process.env.RESEND_WEBHOOK_SECRET);
}
async function rpc(db: RpcClient, name: string, args: Record<string, unknown>) {
  const result = await db.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

/** An explicit admin action sends at most one already-reviewed, frozen queue item. */
export async function dispatchAdvertisingInvoiceEmail(value: { companyId: string; emailId: string }): Promise<{ status: AdvertisingEmailDispatchStatus }> {
  const raw = record(value);
  if (Object.keys(raw).length !== 2 || !('companyId' in raw) || !('emailId' in raw)) throw Error('Invalid dispatch');
  const companyId = invoiceUuid(raw.companyId), emailId = invoiceUuid(raw.emailId);
  const actor = await requirePlatformAdminContext();
  if (!advertisingInvoiceEmailConfigured()) return { status: 'unconfigured' };
  // Dedicated service client records historical provider outcomes even if access changes after sending.
  const service = createClient(PROJECT_URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) as unknown as RpcClient;
  const envelope = record(await rpc(actor.db as unknown as RpcClient, 'claim_advertising_invoice_email', { p_company_id: companyId, p_email_id: emailId }));
  if (envelope.companyId !== companyId || envelope.actorUserId !== actor.userId || envelope.actorRole !== 'platform_admin') throw Error('Invalid claim scope');
  if (envelope.job === null) return { status: 'empty' };
  const job = parseAdvertisingInvoiceEmailJob(envelope.job, companyId, emailId);
  let prepared: Awaited<ReturnType<typeof prepareAdvertisingInvoiceEmail>> | null = null;
  let bound = false;
  const finish = async (outcome: 'accepted' | 'retryable' | 'rejected' | 'unknown' | 'cancelled', providerId: string | null = null): Promise<{ status: AdvertisingEmailDispatchStatus }> => {
    let status: AdvertisingEmailDispatchStatus = 'unknown';
    try {
      const result = record(await rpc(service, 'finish_advertising_invoice_email', {
        p_company_id: companyId, p_email_id: emailId, p_lease_id: job.leaseId, p_actor_user_id: actor.userId,
        p_payload_hash: bound ? prepared!.payloadHash : job.payloadHash, p_pdf_sha256: bound ? prepared!.pdfSha256 : job.pdfSha256,
        p_outcome: outcome, p_provider_id: providerId,
      }));
      if (['accepted', 'pending', 'rejected', 'unknown', 'cancelled'].includes(String(result.status))) status = result.status as AdvertisingEmailDispatchStatus;
    } catch { /* Preserve ambiguity: a provider acceptance cannot safely become another send. */ }
    const current = await requirePlatformAdminContext();
    if (current.userId !== actor.userId) throw new PlatformAdminError('forbidden');
    return { status };
  };
  try {
    prepared = await prepareAdvertisingInvoiceEmail(job);
  } catch { return finish('rejected'); }
  const leaseArgs = { p_company_id: companyId, p_email_id: emailId, p_lease_id: job.leaseId, p_payload_hash: prepared.payloadHash, p_pdf_sha256: prepared.pdfSha256 };
  try {
    const binding = record(await rpc(actor.db as unknown as RpcClient, 'bind_advertising_invoice_email', leaseArgs));
    if (binding.ok !== true) return finish('cancelled');
    bound = true;
    const fresh = await requirePlatformAdminContext();
    if (fresh.userId !== actor.userId) return finish('cancelled');
    const check = record(await rpc(fresh.db as unknown as RpcClient, 'check_advertising_invoice_email', leaseArgs));
    if (check.ok !== true) return finish('cancelled');
  } catch { return finish('cancelled'); }
  const result = await sendPreparedAdvertisingInvoiceEmail({ emailId, firstAttemptAt: job.firstAttemptAt, body: prepared.body, apiKey: process.env.RESEND_API_KEY! });
  return finish(result.status, result.status === 'accepted' ? result.providerId : null);
}
