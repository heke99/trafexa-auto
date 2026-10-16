/** GoTrue GenerateTokenHash uses SHA-224 (56 hexadecimal characters).
 * Keep accepting 64-character hashes from existing invitation links; Auth
 * still verifies the actual token, recipient, expiry and single use. */
export function validAccountInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[a-f0-9]{56}|[a-f0-9]{64})$/.test(value);
}
