export const OWNERSHIP_ATTESTATION_VERSION = '2026-10-15' as const;
export type OwnershipRole = 'owner' | 'admin';
export type OwnershipMember = { membershipId: string; userId: string; email: string; version: number };
export type OwnershipStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';
export type OwnershipTransfer = {
  id: string; companyId: string; from: OwnershipMember; to: OwnershipMember;
  status: OwnershipStatus; version: number; teamVersionAtRequest: number;
  reason: string; attestationVersion: typeof OWNERSHIP_ATTESTATION_VERSION;
  createdAt: string; expiresAt: string; resolvedAt: string | null; cancelReason: string | null;
};
export type OwnershipPage = {
  companyId: string; actorUserId: string; actorRole: OwnershipRole; teamVersion: number; serverNow: string;
  owner: OwnershipMember | null; candidates: OwnershipMember[]; nextPageKey: string | null;
  transfer: OwnershipTransfer | null; canRequest: boolean; canAccept: boolean; canCancel: boolean;
  blockReason: null | 'owner_missing' | 'multiple_owners' | 'pending_transfer' | 'not_owner';
};
export type OwnershipReceipt = { companyId: string; actorUserId: string; requestId: string; teamVersion: number; transfer: OwnershipTransfer };
export type OwnershipResult<T> = ({ ok: true } & T) | { ok: false; code: 'unauthenticated' | 'access_denied' | 'invalid_input' | 'conflict' | 'unavailable'; message: string };
