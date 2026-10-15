import { readCompanyStoreProfile, writeCompanyStoreProfile } from '@/lib/company-store-profile/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = readCompanyStoreProfile;
export const PUT = writeCompanyStoreProfile;
