import Link from 'next/link';
import { getAccountAccessContext } from '@/lib/account-access/context';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { CustomerContractSignings } from '@/components/contract-signings';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { signOutAction } from '@/lib/data/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mina avtal', robots: { index: false, follow: false } };

export default async function MyContractsPage() {
  const db = await createServerSupabaseClient();
  const { data, error } = await db.auth.getUser();
  const user = data?.user;
  if (error || !user) redirect('/login?next=/my-contracts');
  let access; try { access = await getAccountAccessContext(); } catch { redirect('/account-pending?next=%2Fmy-contracts'); }
  if (!access || !access.emailVerified || access.status !== 'approved') redirect('/account-pending?next=%2Fmy-contracts');
  const verified = !user.is_anonymous && Boolean(user.email && user.email_confirmed_at && Number.isFinite(Date.parse(user.email_confirmed_at)));
  return <div className="wrap">
    <header className="public-header"><Brand href="/my-contracts"/><nav className="nav-login" aria-label="Konto"><Link className="text-link" href="/my-offers">Mina offerter</Link><Link className="text-link" href="/privacy">Integritet</Link><form action={signOutAction}><input type="hidden" name="next" value="/my-contracts"/><button className="text-link" type="submit">Logga ut</button></form></nav></header>
    <main id="my-offers-main" className="workspace-main" style={{paddingInline:0}}>
      {verified ? <><div className="workspace-heading"><div><h1>Mina avtal</h1><p>Granska avtalsinnehållet och skriv under den exakta avtalsversionen.</p></div></div><CustomerContractSignings key={`${user.id}:${user.email?.trim().toLowerCase()}:${user.email_confirmed_at}`} userId={user.id}/></> : <div className="empty-state"><h1>Verifiera din e-postadress</h1><p>Bekräfta kontot genom mejlet från Trafexa. Använd samma e-postadress som bilhandlaren har angett i ditt avtal.</p><Link className="button button-outline" href="/my-contracts">Kontrollera igen</Link></div>}
      <p className="form-note">Behöver du hjälp? <a className="text-link" href="mailto:info@trafexa.com">Kontakta Trafexa</a>.</p>
    </main>
  </div>;
}
