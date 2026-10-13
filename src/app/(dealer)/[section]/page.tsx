import { notFound, redirect } from 'next/navigation';
import { getWorkspaceSnapshot } from '@/lib/data/workspace';
import { DealerWorkspace, type WorkspaceSection } from '@/components/dealer-workspace';
import { getPlatformAdminContext } from '@/lib/platform-admin/context';
import { WORKSPACE_SECTIONS } from '@/lib/routing.mjs';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function WorkspacePage({ params, searchParams }: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { section } = await params;
  if (!WORKSPACE_SECTIONS.includes(section)) notFound();
  const [snapshot, query] = await Promise.all([getWorkspaceSnapshot(), searchParams]);
  if (!snapshot) redirect(`/login?next=${encodeURIComponent(`/${section}`)}`);
  if (!snapshot.organization && !snapshot.memberships.length) redirect('/onboarding');
  if (!snapshot.organization && section !== 'settings') redirect('/settings');
  const notice = query.error ? { type: 'error' as const, message: query.error } : query.success ? { type: 'success' as const, message: query.success } : !snapshot.organization ? { type: 'error' as const, message: 'Ditt tidigare företagsval är inte längre tillgängligt. Välj ett aktivt företag nedan för att fortsätta.' } : undefined;
  const admin = await getPlatformAdminContext();
  return <DealerWorkspace canManagePlatform={Boolean(admin)} snapshot={snapshot} section={section as WorkspaceSection} notice={notice} />;
}
