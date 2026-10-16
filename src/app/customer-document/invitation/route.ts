import { NextResponse, type NextRequest } from 'next/server';
import { getAuthAppOrigin } from '@/lib/auth/app-origin';
import { guestDocumentCookie, guestDocumentMaxAge, guestDocumentPath, guestDocumentToken } from '@/lib/guest-customer/token';

/** Scanner-safe GET: deposit an opaque capability, without creating an account,
 * acknowledging a document or consuming the recipient's review/signature. */
export async function GET(request: NextRequest) {
  const origin = getAuthAppOrigin(request.nextUrl.origin);
  const input = guestDocumentToken(request.nextUrl.searchParams.get('invitation'), request.nextUrl.searchParams.get('token'));
  const destination = input ? guestDocumentPath : `${guestDocumentPath}?${new URLSearchParams({ error: 'Dokumentlänken är ogiltig. Öppna länken i ditt mejl eller kontakta avsändaren.' })}`;
  const response = NextResponse.redirect(new URL(destination, origin));
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(guestDocumentCookie, input?.value || '', { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: guestDocumentPath, maxAge: input ? guestDocumentMaxAge : 0 });
  return response;
}
