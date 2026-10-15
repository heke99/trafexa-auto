import 'server-only';

export type BlocketDelivery = {
  id: string; companyId: string; listingId: string; listingVersion: number; sourceId: string;
  dealerCode: string; revision: number; operation: 'create' | 'update'; providerAdId: string | null;
  connectionId: string; connectionVersion: number; payloadSha256: string; providerRequestId: string | null;
  status: 'dispatching' | 'submitted' | 'outcome_unknown' | 'published' | 'rejected'; version: number;
};
export type BlocketProviderOutcome = AdvertisingProviderOutcome & { providerRequestId?: string; evidenceSha256?: string; providerAdId?: string };

/** Server-side contracts. Credentials and media access URLs never enter dealer DTOs. */
export type AdvertisingChannel = 'blocket' | 'wayke';
export type AdvertisingJobStatus = 'queued' | 'dispatching' | 'submitted' | 'outcome_unknown' | 'published' | 'rejected' | 'retryable';
export type AdvertisingPhoto = {
  id: string; companyId: string; stockId: string; objectPath: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'; sizeBytes: number;
  version: number; status: 'active' | 'archived'; createdAt: string;
  storageBucket: 'ads-vehicle-photos'; storageVisibility: 'private';
};
export type AdvertisingSnapshot = {
  title: string; description: string; priceGrossOre: string; make: string;
  model: string; year: number; mileageKm: number; fuel: string;
  transmission: string; includeRegistrationNumber: boolean; registrationNumber: string | null; photos: AdvertisingPhoto[];
};
export type AdvertisingWorkerJob = {
  id: string; companyId: string; stockId: string; listingId: string; listingVersion: number;
  channel: AdvertisingChannel; connectionId: string; connectionVersion: number;
  accountReference: string; dispatcherId: string; createdBy: string;
  status: AdvertisingJobStatus; version: number; claimToken: string | null;
  claimExpiresAt: string | null; providerAdId: string | null; providerUrl: string | null;
  errorCode: string | null; snapshot: AdvertisingSnapshot; createdAt: string; updatedAt: string;
};
export type AdvertisingPublicPayload = {
  sourceId: string; listingVersion: number; accountReference: string; title: string; description: string;
  make: string; model: string; fuel: string; transmission: string;
  priceGrossOre: string; year: number; mileageKm: number; registrationNumber?: string;
  photos: { url: string; contentType: AdvertisingPhoto['contentType']; expiresAt: string }[];
};
export type AdvertisingProviderOutcome =
  | { status: 'published'; providerAdId: string; providerUrl: string | null }
  | { status: 'submitted'; providerAdId?: string; errorCode?: string }
  | { status: 'outcome_unknown'; errorCode: string }
  | { status: 'rejected' | 'retryable'; errorCode: string };
export interface AdvertisingProvider {
  readonly deliveryProtocol?: 'blocket-v5';
  readonly channel: AdvertisingChannel;
  readonly dispatcherId: string;
  /** Set only by trusted provisioning after verifying the dealer credentials' actual scope. */
  readonly verifiedBinding: {
    companyId: string; connectionId: string; connectionVersion: number;
    accountReference: string; validUntil: string;
  };
  submit(payload: AdvertisingPublicPayload, delivery?: BlocketDelivery): Promise<BlocketProviderOutcome>;
  /** Must only read remote state. Never POST again after uncertain or accepted delivery. */
  reconcile(payload: Pick<AdvertisingPublicPayload, 'sourceId' | 'listingVersion' | 'accountReference'>, delivery?: BlocketDelivery): Promise<BlocketProviderOutcome>;
}

export function isAdvertisingProviderUrl(channel: AdvertisingChannel, value: string): boolean {
  try {
    const url = new URL(value);
    const hosts = channel === 'blocket' ? ['blocket.se', 'www.blocket.se'] : ['wayke.se', 'www.wayke.se'];
    return url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password
      && !url.port && !url.search && !url.hash && url.pathname.length > 1;
  } catch { return false; }
}
