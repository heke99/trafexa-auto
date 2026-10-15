export type InvoiceEmailTransportResult = { status: 'accepted'; providerId: string } | { status: 'retryable' | 'rejected' | 'unknown' };
const providerId = /^[a-zA-Z0-9_-]{1,100}$/;

/** A single bounded network attempt. Only a known non-acceptance is eligible for a later retry. */
export async function sendPreparedAdvertisingInvoiceEmail(input: { emailId: string; firstAttemptAt: string; body: string; apiKey: string }, fetcher: typeof fetch = fetch): Promise<InvoiceEmailTransportResult> {
  const age = Date.now() - Date.parse(input.firstAttemptAt);
  if (!Number.isFinite(age) || age < -60_000 || age >= 23 * 60 * 60 * 1000) return { status: 'unknown' };
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `trafexa/invoice-email/${input.emailId}` }, body: input.body,
    });
    if (response.status === 429) return { status: 'retryable' };
    if (response.status >= 500) return { status: 'unknown' };
    if (response.status === 409) {
      const value: unknown = await response.json();
      return value && typeof value === 'object' && 'name' in value && value.name === 'concurrent_idempotent_requests' ? { status: 'retryable' } : { status: 'rejected' };
    }
    if (!response.ok) return { status: 'rejected' };
    const value: unknown = await response.json();
    return value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && providerId.test(value.id)
      ? { status: 'accepted', providerId: value.id } : { status: 'unknown' };
  } catch { return { status: 'unknown' }; }
}
