import { downloadCompanyStoreExport } from '@/lib/company-store-profile/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  return downloadCompanyStoreExport(request, (await params).exportId);
}
