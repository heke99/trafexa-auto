import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { PlatformAdminError, requirePlatformAdminContext } from '@/lib/platform-admin/context';
import { programCompanySchema } from '@/lib/advertising-program/validation';
import { AdvertisingProgramWorkspace } from '@/components/advertising-program-workspace';

export default async function AdvertisingProgramPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { companyId } = await params;
  if (!z.uuid().safeParse(companyId).success) notFound();
  const query = await searchParams;
  const nextPath = `/admin/annonsprogram/${companyId}${typeof query.result === 'string' ? `?${new URLSearchParams({ result: query.result })}` : ''}`;
  const { db, userId } = await requirePlatformAdminContext().catch(error => {
    if (error instanceof PlatformAdminError && error.code === 'unauthenticated') redirect(`/login?${new URLSearchParams({ next: nextPath })}`);
    if (error instanceof PlatformAdminError && error.code === 'forbidden') notFound();
    throw error;
  });
  const response = await db.rpc('list_advertising_program', { p_company: companyId });
  if (response.error) throw Error('Annonsprogrammet kunde inte läsas in.');
  if (!response.data) notFound();
  const company = programCompanySchema.parse(response.data);
  if (company.companyId !== companyId || company.stores.some(store => store.company_id !== companyId)) throw Error('Felaktig butikslista.');
  return <AdvertisingProgramWorkspace company={company} actorId={userId}/>;
}
