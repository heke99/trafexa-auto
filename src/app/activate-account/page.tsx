import {getAccountInvitationFingerprint} from '@/lib/auth/account-invitation-intent';
import {AuthSubmit} from '@/components/auth-submit';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { AuthShell } from '@/components/auth-shell';
import { activateAccountAction } from '@/lib/auth/activate-account-actions';
import { validAccountInvitationToken } from '@/lib/auth/account-invitation-token';

export const metadata = { title: 'Aktivera ditt konto', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default async function ActivateAccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const token = (await cookies()).get('trafexa-account-invitation')?.value;
  const hasInvitation = validAccountInvitationToken(token);
  const invitationFingerprint = hasInvitation ? getAccountInvitationFingerprint(token) : undefined;
  return <AuthShell title="Aktivera ditt konto." subtitle={hasInvitation ? 'Välj ett unikt lösenord för att bekräfta din e-postadress och aktivera kontot med din kontoinbjudan.' : 'Du behöver en kontoinbjudan från Trafexa för att aktivera ditt konto.'}>
    {query.error ? <p role="alert" className="notice error">{query.error}</p> : null}
    {hasInvitation ? <form action={activateAccountAction}><input type="hidden" name="invitationFingerprint" value={invitationFingerprint}/>
      <label>Välj lösenord<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
      <label className="auth-checkbox"><input type="checkbox" name="acknowledged" value="yes" required /><span>Jag godkänner <Link href="/terms" target="_blank" rel="noreferrer">användarvillkoren</Link> och har tagit del av <Link href="/privacy" target="_blank" rel="noreferrer">integritetspolicyn</Link>.</span></label>
      <AuthSubmit pendingLabel="Aktiverar kontot…">Aktivera konto</AuthSubmit>
    </form> : <p role="alert">Öppna länken i din kontoinbjudan för att fortsätta. Om länken har gått ut, kontakta <a href="mailto:info@trafexa.com">info@trafexa.com</a>.</p>}
    <p>Har du redan aktiverat ditt konto? <Link href="/login">Logga in</Link></p>
  </AuthShell>;
}
