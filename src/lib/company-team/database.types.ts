import type { Database, Json } from '@/lib/supabase/database.types';

type CompanyTeamFunctions = {
  list_company_team: { Args: { p_company_id: string; p_members_page_key: string | null; p_invitations_page_key: string | null; p_limit: number }; Returns: Json };
  create_company_invitation: { Args: { p_company_id: string; p_email: string; p_role: string; p_expected_team_version: number; p_request_id: string }; Returns: Json };
  revoke_company_invitation: { Args: { p_company_id: string; p_invitation_id: string; p_expected_version: number; p_reason: string; p_request_id: string }; Returns: Json };
  update_company_team_member: { Args: { p_company_id: string; p_membership_id: string; p_expected_version: number; p_role: string; p_status: string; p_reason: string; p_request_id: string }; Returns: Json };
  list_my_company_invitations: { Args: { p_page_key: string | null; p_limit: number }; Returns: Json };
  accept_company_invitation: { Args: { p_invitation_id: string; p_expected_version: number; p_request_id: string }; Returns: Json };
};
export type CompanyTeamDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & CompanyTeamFunctions };
};
export type TeamRole = 'owner' | 'admin' | 'sales' | 'finance' | 'viewer';
export type TeamManagerRole = 'owner' | 'admin';
export type InviteRole = Exclude<TeamRole, 'owner'>;
export type MemberStatus = 'active' | 'suspended';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type TeamMember = { id: string; userId: string; email: string; role: TeamRole; status: MemberStatus; version: number; createdAt: string };
export type TeamInvitation = { id: string; email: string; role: InviteRole; status: InvitationStatus; version: number; expiresAt: string; createdAt: string };
export type MyCompanyInvitation = { id: string; companyId: string; companyName: string; role: InviteRole; status: 'pending'; version: number; expiresAt: string; createdAt: string };
export type CompanyTeamPage = { companyId: string; actorUserId: string; actorRole: TeamManagerRole; teamVersion: number; members: TeamMember[]; invitations: TeamInvitation[]; nextMembersPageKey: string | null; nextInvitationsPageKey: string | null };
export type MyInvitationsPage = { invitations: MyCompanyInvitation[]; nextPageKey: string | null };
export type InvitationReceipt = { companyId: string; teamVersion: number; invitation: TeamInvitation };
export type MemberReceipt = { companyId: string; teamVersion: number; member: TeamMember };
export type AcceptedInvitation = { companyId: string; role: TeamRole };
export type TeamResult<T> = ({ ok: true } & T) | { ok: false; code: 'unauthenticated' | 'access_denied' | 'invalid_input' | 'conflict' | 'not_found' | 'unavailable'; message: string };
