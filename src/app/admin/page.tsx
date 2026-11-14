import { EmailDeliveryStatus } from '@/components/email-delivery-status';
import { notFound, redirect } from 'next/navigation';
import { PlatformAdminActivation, PlatformAdminWorkspace } from '@/components/platform-admin-workspace';
import { PlatformAdminError, requirePlatformAdminPageContext, getPlatformAdminActivationContext } from '@/lib/platform-admin/context';
import {platformAdminReturnPath} from '@/lib/platform-admin/route-path';
import { listPlatformCompaniesAction } from '@/lib/platform-admin/actions';

export default async function AdminPage() {
  let actorUserId: string;
  try { const context = await requirePlatformAdminPageContext(); actorUserId = context.userId; } catch (error) {
    if (error instanceof PlatformAdminError && error.code === 'unauthenticated') redirect(`/login?${new URLSearchParams({next:await platformAdminReturnPath()})}`);
    if (error instanceof PlatformAdminError && error.code === 'forbidden') {
      if(!await getPlatformAdminActivationContext())notFound();
      return <PlatformAdminActivation/>;
    }
    throw error;
  }
  const result = await listPlatformCompaniesAction({ limit: 50 });
  if (!result.ok && result.code === 'access_denied') notFound();
  return <><aside className="wrap notice" aria-label="Hjälp om kundavtal"><details><summary>Så skickar du kundavtal</summary><p>Öppna företagsvyn och välj Affärer → Skapa affär. Lägg till kunden direkt, ange överenskommet pris och granska avtalet. En behörig ägare eller administratör godkänner och skickar det för kundens signering. Kunden får en personlig mejllänk och behöver inget konto.</p><p>För att förbereda en direkt affär behöver du även vara säljare, ägare eller administratör i företaget. För att godkänna och skicka avtalet krävs ägare eller administratör. Superadminrollen ger ingen automatisk rätt att teckna företagets avtal.</p><a className="text-link" href="/deals">Öppna Affärer i företagsvyn</a> · <a className="text-link" href="/onboarding">Skapa en egen företagsarbetsyta</a></details></aside><PlatformAdminWorkspace key={actorUserId} actorUserId={actorUserId} initialPage={result.ok ? { companies: result.companies, nextPageKey: result.nextPageKey } : { companies: [], nextPageKey: null }} initialError={result.ok ? null : result.message}/><EmailDeliveryStatus key={`email:${actorUserId}`}/></>;
}
