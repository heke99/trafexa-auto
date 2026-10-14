import { notFound, redirect } from 'next/navigation';
import { PlatformAdminActivation, PlatformAdminWorkspace } from '@/components/platform-admin-workspace';
import { PlatformAdminError, requirePlatformAdminPageContext, requirePlatformAuthenticatedContext } from '@/lib/platform-admin/context';
import { getAccountAccessContext } from '@/lib/account-access/context';
import { listPlatformCompaniesAction } from '@/lib/platform-admin/actions';

export default async function AdminPage() {
  let actorUserId: string;
  try { const context = await requirePlatformAdminPageContext(); actorUserId = context.userId; } catch (error) {
    if (error instanceof PlatformAdminError && error.code === 'unauthenticated') redirect('/login?next=/admin');
    if (error instanceof PlatformAdminError && error.code === 'forbidden') {
      try { await requirePlatformAuthenticatedContext(); } catch { notFound(); }
      let access;
      try { access = await getAccountAccessContext(); } catch { redirect('/account-pending?next=%2Fadmin'); }
      if (!access?.emailVerified || access.status !== 'approved') redirect('/account-pending?next=%2Fadmin');
      return <PlatformAdminActivation/>;
    }
    throw error;
  }
  const result = await listPlatformCompaniesAction({ limit: 50 });
  if (!result.ok && result.code === 'access_denied') notFound();
  return <PlatformAdminWorkspace key={actorUserId} actorUserId={actorUserId} initialPage={result.ok ? { companies: result.companies, nextPageKey: result.nextPageKey } : { companies: [], nextPageKey: null }} initialError={result.ok ? null : result.message}/>;
}
