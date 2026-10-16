const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const guestDocumentCookie = 'trafexa-guest-document';
export const guestDocumentPath = '/customer-document';
export const guestDocumentMaxAge = 7 * 24 * 60 * 60;

/** A 256-bit opaque document capability, never an Auth token or account identifier. */
export function guestDocumentToken(invitationId: unknown, token: unknown): { invitationId: string; token: string; value: string } | null {
  if (typeof invitationId !== 'string' || !UUID.test(invitationId) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== token) return null;
  const id = invitationId.toLowerCase();
  return { invitationId: id, token, value: `v1.${id}.${token}` };
}

export function parseGuestDocumentCookie(value: unknown) {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  return parts.length === 3 && parts[0] === 'v1' ? guestDocumentToken(parts[1], parts[2]) : null;
}
