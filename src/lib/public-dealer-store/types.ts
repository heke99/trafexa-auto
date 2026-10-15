export type PublicStoreSelection = { listingId: string; version: number };
export type PublicStoreState = { slug: string; version: number; status: 'published' | 'unpublished'; profileVersion: number; publishedAt: string; updatedAt: string; selectedListings: PublicStoreSelection[] };
export type PublicStorePage = { companyId: string; actorUserId: string; actorRole: 'owner' | 'admin'; store: PublicStoreState | null };
export type PublicStoreReceipt = { companyId: string; actorUserId: string; requestId: string; action: 'publish' | 'unpublish'; store: PublicStoreState };
export type PublicDealerStore = {
  slug: string; version: number; publishedAt: string;
  shop: { legalName: string; organisationNumber: string; displayName: string; addressLine1: string; addressLine2: string | null; postalCode: string; city: string; countryCode: 'SE'; publicEmail: string; publicPhone: string; websiteUrl: string | null; logoUrl: string | null; description: string | null; openingHoursText: string | null };
  listings: { id: string; version: number; title: string; description: string; priceOre: string; currency: 'SEK'; make: string; model: string; year: number; mileageKm: number; fuel: string; transmission: string; photos: { id: string }[] }[];
};
export type PublicStoreCode = 'unauthenticated' | 'access_denied' | 'invalid_input' | 'conflict' | 'unavailable';
export type PublicStoreResult<T> = ({ ok: true } & T) | { ok: false; code: PublicStoreCode; message: string };
export type PublishPublicStoreInput = { companyId: string; slug: string; expectedVersion: number; profileVersion: number; listings: PublicStoreSelection[]; acknowledged: true; requestId: string };
export type UnpublishPublicStoreInput = { companyId: string; expectedVersion: number; acknowledged: true; requestId: string };
