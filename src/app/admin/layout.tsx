import { notFound, redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { signOutAction } from '@/lib/data/actions';
import { PlatformAdminActivation } from '@/components/platform-admin-workspace';
import { PlatformAdminError, requirePlatformAdminPageContext, getPlatformAdminActivationContext } from '@/lib/platform-admin/context';
import {platformAdminReturnPath} from '@/lib/platform-admin/route-path';

export const dynamic = 'force-dynamic';

function AdminHeader() {
  return <header className="public-header admin-header"><Brand/><nav className="nav-login" aria-label="Administration"><a className="text-link" href="mailto:info@trafexa.com">Kontakta Trafexa</a><form action={signOutAction}><button className="text-link" type="submit">Logga ut</button></form></nav></header>;
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try { await requirePlatformAdminPageContext(); } catch (error) {
    if (error instanceof PlatformAdminError && error.code === 'unauthenticated') redirect(`/login?${new URLSearchParams({next:await platformAdminReturnPath()})}`);
    if (error instanceof PlatformAdminError && error.code === 'forbidden') {
      if(!await getPlatformAdminActivationContext())notFound();
      return <div className="wrap"><AdminHeader/><PlatformAdminActivation/></div>;
    }
    throw error;
  }
  return <div className="wrap"><AdminHeader/>{children}</div>;
}
