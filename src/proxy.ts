import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { domainRedirect, isWorkspacePath, isPlatformAdminPath, isAuthPath } from '@/lib/routing.mjs';

export async function proxy(request: NextRequest) {
  const { pathname, search, hostname } = request.nextUrl;
  const destination = domainRedirect(hostname, pathname, search);
  if (destination && ['GET', 'HEAD'].includes(request.method)) return NextResponse.redirect(destination);
  if (!isWorkspacePath(pathname) && !isPlatformAdminPath(pathname) && !isAuthPath(pathname)) return NextResponse.next();
  let response = NextResponse.next({ request });
  response.headers.set('Cache-Control', 'private, no-store');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const db = createServerClient(url, key, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll(items) {
      items.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      response.headers.set('Cache-Control', 'private, no-store');
      items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    }
  } });
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub && (isWorkspacePath(pathname) || isPlatformAdminPath(pathname) || pathname === '/onboarding')) {
    const login = request.nextUrl.clone(); login.pathname = '/login'; login.search = '';
    if (isPlatformAdminPath(pathname)) login.searchParams.set('next', '/admin');
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    redirect.headers.set('Cache-Control', 'private, no-store');
    return redirect;
  }
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)'] };
