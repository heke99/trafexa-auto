import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/routing.mjs';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  if (code) {
    try {
      const db = await createServerSupabaseClient();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, origin));
    } catch { /* Provider failures use the same safe retry route. */ }
  }
  return NextResponse.redirect(new URL(`/login?${new URLSearchParams({next,error:'Bekräftelselänken kunde inte användas. Försök logga in.'})}`, origin));
}
