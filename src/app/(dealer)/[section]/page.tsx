import {getAccountPendingPath} from '@/lib/auth/landing';
import { notFound, redirect } from 'next/navigation';
import { getWorkspaceSnapshot } from '@/lib/data/workspace';
import { DealerWorkspace, type WorkspaceSection } from '@/components/dealer-workspace';
import { getPlatformAdminContext } from '@/lib/platform-admin/context';
import { getAccountAccessContext } from '@/lib/account-access/context';
import {CompanySuspended} from '@/components/company-suspended';
import { WORKSPACE_SECTIONS } from '@/lib/routing.mjs';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function WorkspacePage({ params, searchParams }: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { section } = await params;
  if (!WORKSPACE_SECTIONS.includes(section)) notFound();
  const admin = await getPlatformAdminContext({navigation:true});
  if (admin && section === 'dashboard') redirect('/admin');
  if (!admin) {
    let access; try { access = await getAccountAccessContext({navigation:true}); } catch (error) { if(error&&typeof error==='object'&&'code'in error&&error.code==='unavailable')throw error;redirect(getAccountPendingPath(`/${section}`)); }
    if (!access) redirect(`/login?next=${encodeURIComponent(`/${section}`)}`);
    if (!access.emailVerified || access.status !== 'approved') redirect(getAccountPendingPath(`/${section}`));
  }
  const [snapshot, query] = await Promise.all([getWorkspaceSnapshot(section), searchParams]);
  if (!snapshot) redirect(`/login?next=${encodeURIComponent(`/${section}`)}`);
  if (admin && (section === 'dashboard' || (!snapshot.organization && !snapshot.memberships.length))) redirect('/admin');
  if (!snapshot.organization && !snapshot.memberships.length && snapshot.hasSuspendedCompany) return <CompanySuspended/>;
  if (!snapshot.organization && !snapshot.memberships.length) redirect('/onboarding');
  if (!snapshot.organization && section !== 'settings') redirect('/settings');
  const notice = query.error ? { type: 'error' as const, message: query.error } : query.success ? { type: 'success' as const, message: query.success } : !snapshot.organization ? { type: 'error' as const, message: 'Ditt tidigare företagsval är inte längre tillgängligt. Välj ett aktivt företag nedan för att fortsätta.' } : undefined;
  return <DealerWorkspace canManagePlatform={Boolean(admin)} snapshot={snapshot} section={section as WorkspaceSection} notice={notice} />;
}
