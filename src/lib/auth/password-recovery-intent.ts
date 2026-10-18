import 'server-only';
import { createHash } from 'node:crypto';
import { validPasswordRecoveryToken } from './password-recovery-token';

/** A render-to-POST selector, never an Auth credential or a substitute for OTP verification. */
export function getPasswordRecoveryFingerprint(token: string): string {
  if (!validPasswordRecoveryToken(token)) throw new Error('Invalid recovery selector');
  return createHash('sha256').update(token).digest('hex');
}
