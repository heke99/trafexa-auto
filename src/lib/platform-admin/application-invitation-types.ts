import type { Database, Json } from '@/lib/supabase/database.types';

export type ApplicationInvitationResult<T> = ({ ok: true } & T) | {
  ok: false;
  code: 'access_denied' | 'invalid_input' | 'conflict' | 'not_found' | 'unavailable' | 'existing_account';
  message: string;
};
export type ApplicationInvitation = {
  id: string;
  applicationId: string;
  applicationVersion: number;
  actorUserId: string;
  requestId: string;
  email: string;
  name: string;
  reason: string;
  status: 'prepared' | 'expired' | 'created';
  userId: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};
export type PrepareApplicationInvitationInput = {
  applicationId: string;
  expectedVersion: number;
  reason: string;
  requestId: string;
  reviewAcknowledged: true;
};
export type ApplicationInvitationDelivery = {
  invitationId: string;
  actorUserId: string;
  leaseId: string | null;
  status: 'generate' | 'send' | 'sent' | 'unknown' | 'busy';
  email: string;
  userId: string | null;
  firstAttemptAt: string | null;
};
export type ApplicationInvitationDeliveryOutcome = 'sent' | 'retryable' | 'rejected' | 'unknown';
type DeliveryIdentity = { p_invitation_id: string; p_lease_id: string; p_actor_user_id: string };
type InvitationFunctions = {
  claim_platform_application_invitation_delivery: { Args: { p_invitation_id: string }; Returns: Json };
  get_platform_application_invitation_delivery: { Args: DeliveryIdentity; Returns: Json };
  bind_platform_application_invitation_delivery: { Args: DeliveryIdentity & { p_ciphertext: string }; Returns: Json };
  finish_platform_application_invitation_delivery: { Args: DeliveryIdentity & { p_outcome: ApplicationInvitationDeliveryOutcome; p_provider_id: string | null }; Returns: Json };
  prepare_platform_application_invitation: {
    Args: { p_application_id: string; p_expected_version: number; p_reason: string; p_request_id: string };
    Returns: Json;
  };
  get_platform_application_invitation: { Args: { p_application_id: string }; Returns: Json };
};
export type ApplicationInvitationDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & InvitationFunctions };
};
