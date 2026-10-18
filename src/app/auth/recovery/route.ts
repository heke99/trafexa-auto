import { NextResponse, type NextRequest } from 'next/server';
import { getAuthAppOrigin } from '@/lib/auth/app-origin';
import { safeNextPath } from '@/lib/routing.mjs';
import { PASSWORD_RECOVERY_COOKIE, PASSWORD_RECOVERY_COOKIE_PATH, validPasswordRecoveryToken } from '@/lib/auth/password-recovery-token';

/** A mail scanner can reach only the form. The recovery token is consumed on its explicit password POST. */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams, token = query.get('token_hash');
  const origin = getAuthAppOrigin(request.nextUrl.origin), next = safeNextPath(query.get('next'));
  const valid = validPasswordRecoveryToken(token) && query.getAll('token_hash').length === 1
    && query.getAll('next').length <= 1 && [...query.keys()].every(key => key === 'token_hash' || key === 'next');
  const destination = valid ? PASSWORD_RECOVERY_COOKIE_PATH : '/forgot-password';
  const target = new URL(destination, origin);
  if (next !== '/dashboard') target.searchParams.set('next', next);
  if (!valid) target.searchParams.set('error', 'Återställningslänken är ogiltig. Begär en ny länk.');
  const response = NextResponse.redirect(target);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // Clear a prior token even for an invalid new link; never fall back to another account's recovery.
  response.cookies.set(PASSWORD_RECOVERY_COOKIE, valid ? token : '', {
    httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: PASSWORD_RECOVERY_COOKIE_PATH, maxAge: valid ? 3600 : 0,
  });
  return response;
}
