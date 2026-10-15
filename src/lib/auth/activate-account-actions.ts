'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireApprovedAccountAccess } from '@/lib/account-access/context';

function failed(message: string): never { redirect(`/activate-account?${new URLSearchParams({ error: message })}`); }
/** Token and recipient are never accepted from browser fields. Next enforces same-origin POST. */
export async function activateAccountAction(form: FormData) {
  const password = form.get('password');
  if (typeof password !== 'string' || password.length < 12 || password.length > 256 || /[\u0000-\u001f\u007f]/.test(password) || form.get('acknowledged') !== 'yes') failed('Välj ett lösenord med minst 12 tecken och godkänn användarvillkoren.');
  const store = await cookies(), token = store.get('trafexa-account-invitation')?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) failed('Inbjudningslänken saknas eller har gått ut. Kontakta info@trafexa.com för en ny inbjudan.');
  const db = await createServerSupabaseClient();
  let verified = false, verifiedUserId: string | undefined;
  try {
    const result = await db.auth.verifyOtp({ token_hash: token, type: 'invite' });
    verified = !result.error && Boolean(result.data?.user?.id && result.data.user.email_confirmed_at);
    if (verified) verifiedUserId = result.data.user?.id;
  } catch { /* A failed verification never becomes activation success. */ }
  if (!verified) failed('Inbjudningslänken kunde inte användas. Den kan ha gått ut eller redan ha använts. Kontakta info@trafexa.com.');
  store.set('trafexa-account-invitation', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/activate-account', maxAge: 0 });
  let approved = false;
  try { const access = await requireApprovedAccountAccess(); approved = access.userId === verifiedUserId && access.emailVerified && access.status === 'approved'; } catch { /* Current private approval is authoritative. */ }
  if (!approved) {
    await db.auth.signOut({ scope: 'global' });
    redirect('/login?error=Kontot+saknar+godkänd+åtkomst.+Kontakta+info%40trafexa.com.');
  }
  let saved = false;
  try { const result = await db.auth.updateUser({ password }); saved = !result.error; } catch { /* Existing verified session can retry the password form. */ }
  if (!saved) redirect('/reset-password?error=Lösenordet+kunde+inte+sparas.+Välj+ett+nytt+lösenord+och+försök+igen.');
  await db.auth.signOut({ scope: 'global' });
  store.delete('trafexa-company');
  redirect('/login?success=Kontot+är+aktiverat.+Logga+in+med+din+e-postadress+och+ditt+nya+lösenord.');
}
