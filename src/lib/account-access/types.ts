export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type AccountAccessContext = { userId: string; email: string; emailVerified: boolean; status: AccountStatus; version: number; isPlatformAdmin: boolean };
export type AccountCompany = { id: string; name: string; organisationNumber: string; status: 'active'|'suspended'; membershipStatus: 'active'|'suspended' };
export type PlatformAccount = AccountAccessContext & { name: string | null; createdAt: string; companies?: AccountCompany[]; companyCount?: number; requestedCompany?: {name:string;organisationNumber:string}|null };
export type AccountPage = { accounts: PlatformAccount[]; nextPageKey: string | null };
export type AccountReceipt = { userId: string; requestId: string; status: AccountStatus; previousStatus: AccountStatus; version: number; reason: string; createdAt: string; changed: boolean };
