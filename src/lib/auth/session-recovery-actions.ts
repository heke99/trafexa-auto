'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/routing.mjs';
import { savedPasswordSignOutWarning, tryGlobalSignOut } from './sign-out';

/** Retry only session revocation: never reapply a password or consume a token. */
export async function retryPasswordSignOutAction(form: FormData) {
  const next = safeNextPath(form.get('next'));
  let signedOut = false;
  try { signedOut = await tryGlobalSignOut(await createServerSupabaseClient()); } catch { /* Keep the warning visible. */ }
  (await cookies()).delete('trafexa-company');
  const query = new URLSearchParams(next === '/dashboard' ? {} : { next });
  if (!signedOut) query.set('error', savedPasswordSignOutWarning);
  redirect(`/login${query.size ? `?${query}` : ''}`);
}
