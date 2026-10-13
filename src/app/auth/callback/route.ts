import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/routing.mjs';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  if (code) {
    const db = await createServerSupabaseClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL('/login?error=Bekr%C3%A4ftelsel%C3%A4nken%20kunde%20inte%20anv%C3%A4ndas.%20F%C3%B6rs%C3%B6k%20logga%20in.', origin));
}
