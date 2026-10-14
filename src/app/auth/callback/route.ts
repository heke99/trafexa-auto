import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/routing.mjs';
import { getAuthAppOrigin } from '@/lib/auth/app-origin';
import { getAuthenticatedLandingPath } from '@/lib/auth/landing';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  const origin = getAuthAppOrigin(request.nextUrl.origin);
  if (code) {
    try {
      const db = await createServerSupabaseClient();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(await getAuthenticatedLandingPath(next), origin));
    } catch { /* Provider failures use the same safe retry route. */ }
  }
  return NextResponse.redirect(new URL(`/login?${new URLSearchParams({next,error:'Bekräftelselänken kunde inte användas. Försök logga in.'})}`, origin));
}
