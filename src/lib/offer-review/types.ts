import type { OfferSnapshot } from '@/lib/documents/offer-pdf';
export type ReviewStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'superseded' | 'expired' | 'unavailable';
export type OfferReview = { id: string; companyId: string; dealId: string; offerId: string; offerVersion: number; recipientEmail: string; status: ReviewStatus; version: number; createdAt: string; decidedAt: string | null; responderName: string | null; reason: string | null };
export type CustomerOfferReview = OfferReview & { snapshot: OfferSnapshot };
export type ReviewResult<T> = ({ ok: true } & T) | { ok: false; code: 'invalid_input' | 'unauthenticated' | 'access_denied' | 'conflict' | 'unavailable'; message: string };
export type ReviewOfferPreview = { offerId: string; offerVersion: number; recipientEmail: string | null; validUntil: string; vatScheme: 'standard' | 'vmb' | 'unknown' };
export type DealerReviewPage = { companyId: string; reviews: OfferReview[]; latestOffer: ReviewOfferPreview | null };
export type CustomerReviewPage = { reviews: CustomerOfferReview[]; nextPageKey: string | null };
export type RespondOfferReviewInput = { reviewId: string; expectedVersion: number; decision: 'accepted' | 'declined'; responderName: string; reason: string | null; ackVersion: '2026-10-14'; requestId: string };
