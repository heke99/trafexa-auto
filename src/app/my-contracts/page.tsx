import Link from 'next/link';
import { getAccountAccessContext } from '@/lib/account-access/context';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { CustomerContractSignings } from '@/components/contract-signings';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { signOutAction } from '@/lib/data/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mina avtal', robots: { index: false, follow: false } };

export default async function MyContractsPage({searchParams}:{searchParams?:Promise<{contract?:string|string[]}>}={}) {
  const query=await searchParams;
  const rawContract=query?.contract;
  const signingId=typeof rawContract==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawContract)?rawContract.toLowerCase():undefined;
  const invalidLink=rawContract!==undefined&&!signingId;
  const destination=signingId?`/my-contracts?${new URLSearchParams({contract:signingId})}`:'/my-contracts';
  const loginPath=signingId?`/login?${new URLSearchParams({next:destination})}`:'/login?next=/my-contracts';
  const pendingPath=`/account-pending?${new URLSearchParams({next:destination})}`;
  const db = await createServerSupabaseClient();
  const { data, error } = await db.auth.getUser();
  const user = data?.user;
  if (error || !user) redirect(loginPath);
  let access; try { access = await getAccountAccessContext(); } catch { redirect(pendingPath); }
  if (!access || !access.emailVerified || access.status !== 'approved') redirect(pendingPath);
  const verified = !user.is_anonymous && Boolean(user.email && user.email_confirmed_at && Number.isFinite(Date.parse(user.email_confirmed_at)));
  return <div className="wrap">
    <header className="public-header"><Brand href="/my-contracts"/><nav className="nav-login" aria-label="Konto"><Link className="text-link" href="/my-offers">Mina offerter</Link><Link className="text-link" href="/privacy">Integritet</Link><form action={signOutAction}><input type="hidden" name="next" value={destination}/><button className="text-link" type="submit">Logga ut</button></form></nav></header>
    <main id="my-contracts-main" className="workspace-main" style={{paddingInline:0}}>
      {verified ? <><div className="workspace-heading"><div><h1>Mina avtal</h1><p>Granska avtalsinnehållet och skriv under den exakta avtalsversionen.</p></div></div>{invalidLink?<div className="empty-state"><p role="alert">Avtalslänken är ogiltig. Öppna en giltig länk eller visa dina avtal.</p><Link className="text-link" href="/my-contracts">Visa alla mina avtal</Link></div>:<CustomerContractSignings key={`${user.id}:${user.email?.trim().toLowerCase()}:${user.email_confirmed_at}:${signingId||''}`} userId={user.id} signingId={signingId}/>}</> : <div className="empty-state"><h1>Verifiera din e-postadress</h1><p>Bekräfta kontot genom mejlet från Trafexa. Använd samma e-postadress som bilhandlaren har angett i ditt avtal.</p><Link className="button button-outline" href={destination}>Kontrollera igen</Link></div>}
      <p className="form-note">Behöver du hjälp? <a className="text-link" href="mailto:info@trafexa.com">Kontakta Trafexa</a>.</p>
    </main>
  </div>;
}
