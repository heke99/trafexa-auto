import { EmailDeliveryStatus } from '@/components/email-delivery-status';
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
  return <><aside className="wrap notice" aria-labelledby="admin-contract-guide"><h2 id="admin-contract-guide">Avtal och kundutskick</h2><p>Avtal skapas i företagsvyn under Affärer → Avtal och underskrifter. Där granskar du ett utkast och väljer Begär underskrifter. Kunden får en personlig länk via mejl och behöver inget konto.</p><p>För avtalsutkast behöver du även vara ägare, administratör eller ekonomiansvarig i företaget. För att begära underskrifter krävs ägare eller administratör. Superadminrollen ger ingen automatisk rätt att teckna företagets avtal.</p><a className="text-link" href="/deals">Öppna Affärer i företagsvyn</a> · <a className="text-link" href="/onboarding">Skapa en egen företagsarbetsyta</a></aside><PlatformAdminWorkspace key={actorUserId} actorUserId={actorUserId} initialPage={result.ok ? { companies: result.companies, nextPageKey: result.nextPageKey } : { companies: [], nextPageKey: null }} initialError={result.ok ? null : result.message}/><EmailDeliveryStatus key={`email:${actorUserId}`}/></>;
}
