export type GuestInvitationRenewalInput = {
  companyId: string;
  dealId: string;
  kind: 'offer_invitation' | 'contract_invitation';
  referenceId: string;
};
export type GuestInvitationRenewalReview = GuestInvitationRenewalInput & {
  actorUserId: string;
  actorRole: string;
  recipientEmail: string;
  documentHash: string;
  documentVersion: number;
  emailId: string | null;
  generation: number;
  status: 'pending' | 'processing' | 'accepted' | 'rejected' | 'unknown' | 'cancelled' | null;
  invitationId: string | null;
  expiresAt: string | null;
  canWrite: boolean;
  canRenew: boolean;
  transport: 'paused' | 'unconfigured' | 'configured';
};
export type RenewGuestDocumentInvitationInput = GuestInvitationRenewalInput & {
  expectedEmailId: string;
  expectedGeneration: number;
  expectedDocumentHash: string;
  requestId: string;
  reviewAcknowledged: true;
};
export type GuestInvitationRenewalReceipt = GuestInvitationRenewalInput & {
  actorUserId: string;
  actorRole: string;
  expectedEmailId: string;
  expectedGeneration: number;
  requestId: string;
  emailId: string;
  generation: number;
  recipientEmail: string;
  documentHash: string;
  documentVersion: number;
  dispatchStatus: string;
};
export type GuestInvitationRenewalFailure = {
  ok: false;
  code: 'invalid_input' | 'access_denied' | 'conflict' | 'unavailable';
  message: string;
};
