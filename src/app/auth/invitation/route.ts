import { NextResponse, type NextRequest } from 'next/server';
import { getAuthAppOrigin } from '@/lib/auth/app-origin';

/** GET never consumes an Auth token: mail scanners only reach the password form. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token_hash');
  const origin = getAuthAppOrigin(request.nextUrl.origin);
  const response = NextResponse.redirect(new URL(token && /^[a-f0-9]{64}$/.test(token) ? '/activate-account' : '/login?error=Inbjudningslänken+är+ogiltig.+Kontakta+info%40trafexa.com.', origin));
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (token && /^[a-f0-9]{64}$/.test(token)) response.cookies.set('trafexa-account-invitation', token, { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/activate-account', maxAge: 3600 });
  return response;
}
