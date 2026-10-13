import { notFound, redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { signOutAction } from '@/lib/data/actions';
import { PlatformAdminActivation } from '@/components/platform-admin-workspace';
import { PlatformAdminError, requirePlatformAdminPageContext, requirePlatformAuthenticatedContext } from '@/lib/platform-admin/context';

export const dynamic = 'force-dynamic';

function AdminHeader() {
  return <header className="public-header"><Brand/><nav className="nav-login" aria-label="Administration"><a className="text-link" href="mailto:info@trafexa.com">Kontakta Trafexa</a><form action={signOutAction}><button className="text-link" type="submit">Logga ut</button></form></nav></header>;
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try { await requirePlatformAdminPageContext(); } catch (error) {
    if (error instanceof PlatformAdminError && error.code === 'unauthenticated') redirect('/login?next=/admin');
    if (error instanceof PlatformAdminError && error.code === 'forbidden') {
      try { await requirePlatformAuthenticatedContext(); } catch { notFound(); }
      return <div className="wrap"><AdminHeader/><PlatformAdminActivation/></div>;
    }
    throw error;
  }
  return <div className="wrap"><AdminHeader/>{children}</div>;
}
