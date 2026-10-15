'use server';

import { requirePlatformAdminContext, PlatformAdminError } from '@/lib/platform-admin/context';
import { advertisingInvoiceEmailConfigured, dispatchAdvertisingInvoiceEmail } from '@/lib/email/advertising-invoice-server';
function failure(error: unknown) {
  const code = error instanceof PlatformAdminError ? error.code === 'forbidden' ? 'access_denied' : error.code : 'unavailable';
  return { ok: false as const, code, message: code === 'unavailable' ? 'Utskicket kunde inte verifieras. Uppdatera status innan du försöker igen.' : 'Din behörighet till fakturamejlen kunde inte verifieras.' };
}
export async function getAdvertisingInvoiceEmailConfigurationAction() {
  try {
    const first = await requirePlatformAdminContext();
    const configured = advertisingInvoiceEmailConfigured();
    if ((await requirePlatformAdminContext()).userId !== first.userId) throw new PlatformAdminError('forbidden');
    return { ok: true as const, configured, sender: 'kundtjanst@trafexa.com', replyTo: 'info@trafexa.com' };
  } catch (error) { return failure(error); }
}
export async function sendAdvertisingInvoiceEmailAction(value: { companyId: string; emailId: string }) {
  try { return { ok: true as const, ...await dispatchAdvertisingInvoiceEmail(value) }; }
  catch (error) { return failure(error); }
}
