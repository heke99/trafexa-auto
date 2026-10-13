import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { CompanyInvitations } from '@/components/company-invitations';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { signOutAction } from '@/lib/data/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mina inbjudningar', robots: { index: false, follow: false } };

export default async function InvitationsPage() {
  const db = await createServerSupabaseClient();
  const { data, error } = await db.auth.getUser();
  const user = data?.user;
  if (error || !user) redirect('/login?next=/invitations');
  const verified = !user.is_anonymous && Boolean(user.email && user.email_confirmed_at && Number.isFinite(Date.parse(user.email_confirmed_at)));

  return <div className="wrap">
    <header className="public-header"><Brand/><nav className="nav-login" aria-label="Konto"><Link className="text-link" href="/dashboard">Arbetsytan</Link><form action={signOutAction}><button className="text-link" type="submit">Logga ut</button></form></nav></header>
    {verified ? <main id="invitations-main" className="workspace-main" style={{paddingInline:0}}><div className="workspace-heading"><div><h1>Mina företagsinbjudningar</h1><p>Inloggad som {user.email}</p></div></div><CompanyInvitations/></main> : <main className="workspace-main"><div className="empty-state"><h1>Verifiera din e-postadress</h1><p>Bekräfta kontot genom mejlet från Trafexa innan du granskar eller accepterar en företagsinbjudan.</p><Link className="button button-outline" href="/invitations">Kontrollera igen</Link><a className="text-link" href="mailto:info@trafexa.com">Kontakta Trafexa</a></div></main>}
  </div>;
}
