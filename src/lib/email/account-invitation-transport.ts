export type InvitationSendResult = { status: 'sent'; providerId: string } | { status: 'retryable' | 'rejected' | 'unknown' };
/** Only a known non-acceptance permits retry, with the exact persisted body and key. */
export async function sendAccountInvitation(input: { invitationId: string; firstAttemptAt: string; body: string; apiKey: string; idempotencyKey?: string }, fetcher: typeof fetch = fetch): Promise<InvitationSendResult> {
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== `trafexa/${input.invitationId}`) return { status: 'rejected' };
  const age = Date.now() - Date.parse(input.firstAttemptAt);
  if (!Number.isFinite(age) || age < -60_000 || age >= 23 * 60 * 60 * 1000) return { status: 'unknown' };
  try {
    const response = await fetcher('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey ?? `trafexa/account-invitation/${input.invitationId}` }, body: input.body });
    if (response.status === 429) return { status: 'retryable' };
    if (response.status >= 500) return { status: 'unknown' };
    if (response.status === 409) {
      const value: unknown = await response.json();
      return value && typeof value === 'object' && 'name' in value && value.name === 'concurrent_idempotent_requests' ? { status: 'retryable' } : { status: 'rejected' };
    }
    if (!response.ok) return { status: 'rejected' };
    const value: unknown = await response.json();
    return value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.id) ? { status: 'sent', providerId: value.id } : { status: 'unknown' };
  } catch { return { status: 'unknown' }; }
}
