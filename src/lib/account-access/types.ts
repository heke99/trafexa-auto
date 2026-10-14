export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type AccountAccessContext = { userId: string; email: string; emailVerified: boolean; status: AccountStatus; version: number; isPlatformAdmin: boolean };
export type PlatformAccount = AccountAccessContext & { name: string | null; createdAt: string };
export type AccountPage = { accounts: PlatformAccount[]; nextPageKey: string | null };
export type AccountReceipt = { userId: string; requestId: string; status: AccountStatus; previousStatus: AccountStatus; version: number; reason: string; createdAt: string; changed: boolean };
