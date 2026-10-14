import Link from 'next/link';
import { safeNextPath } from '@/lib/routing.mjs';
import { getAuthenticatedLandingPath, getAccountPendingPath } from '@/lib/auth/landing';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { signOutAction } from '@/lib/data/actions';
import { getAccountAccessContext } from '@/lib/account-access/context';
import { getPlatformAdminContext } from '@/lib/platform-admin/context';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kontoåtkomst', robots: { index: false, follow: false } };
export default async function AccountPendingPage({ searchParams }: { searchParams?: Promise<{ next?: string }> } = {}) {
  const next = safeNextPath((await searchParams)?.next);
  const originalNext = next.split(/[?#]/, 1)[0] === '/account-pending' ? '/dashboard' : next;
  const pendingPath = getAccountPendingPath(originalNext);
  if (await getPlatformAdminContext()) redirect('/admin');
  let account;
  let unavailable = false;
  try { account = await getAccountAccessContext(); } catch { unavailable = true; }
  if (!unavailable && !account) redirect(originalNext === '/dashboard' ? '/login' : `/login?${new URLSearchParams({ next: originalNext })}`);
  if (account?.emailVerified && account.status === 'approved') redirect(await getAuthenticatedLandingPath(originalNext));
  const title = unavailable ? 'Åtkomsten kunde inte verifieras.' : account?.status === 'rejected' ? 'Registreringen har inte godkänts.' : account?.status === 'suspended' ? 'Din kontoåtkomst är avstängd.' : 'Ditt konto inväntar godkännande.';
  return <AuthShell title={title} subtitle={unavailable ? 'Försök kontrollera åtkomsten igen. Kontakta Trafexa om problemet kvarstår.' : 'Registrering och bekräftad e-post öppnar inte systemet automatiskt. Trafexa granskar och beslutar om åtkomsten.'}>
    {account?.email && <p style={{overflowWrap:'anywhere'}}>Inloggad som <strong>{account.email}</strong>.</p>}
    {account && !account.emailVerified && <p role="status" className="notice">Bekräfta också din e-postadress via mejlet från Trafexa.</p>}
    <p>Du kan använda arbetsytan, kundofferter och företagsinbjudningar efter att ditt konto har godkänts. Kontakta oss om du har frågor om ditt konto.</p>
    <Link className="button button-green" href={pendingPath}>Kontrollera åtkomst igen</Link>
    <p className="auth-links"><a href="mailto:info@trafexa.com">Kontakta info@trafexa.com</a></p>
    <p className="auth-links"><Link href={`/forgot-password?${new URLSearchParams({ next: originalNext })}`}>Glömt lösenordet?</Link></p>
    <form action={signOutAction}><input type="hidden" name="next" value={originalNext}/><button type="submit" className="text-link">Logga ut</button></form>
  </AuthShell>;
}
