import 'server-only';
import { createHash } from 'node:crypto';
import { validAccountInvitationToken } from './account-invitation-token';

/** Bind the rendered activation form to its invitation without exposing the Auth token. */
export function getAccountInvitationFingerprint(token: string): string {
  if (!validAccountInvitationToken(token)) throw new Error('Invalid invitation selector');
  return createHash('sha256').update(token).digest('hex');
}
