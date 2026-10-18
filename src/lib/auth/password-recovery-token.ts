/** GoTrue email token hashes are SHA-224; accept legacy SHA-256 hashes too.
 * Syntax only: Auth verifies actual ownership, expiry and single use on POST. */
export function validPasswordRecoveryToken(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[a-f0-9]{56}|[a-f0-9]{64})$/.test(value);
}
export const PASSWORD_RECOVERY_COOKIE = 'trafexa-password-recovery';
export const PASSWORD_RECOVERY_COOKIE_PATH = '/reset-password';
