import type { AccountStatus } from '../account-access/types';
import type { Database, Json } from '../supabase/database.types';

export type PlatformMembershipRole = 'owner' | 'admin' | 'sales' | 'finance' | 'viewer';
export type PlatformMembershipEditableRole = Exclude<PlatformMembershipRole, 'owner'>;
export type PlatformMembershipStatus = 'active' | 'suspended';
export type PlatformCompanyMember = {
  membershipId: string;
  userId: string;
  email: string | null;
  role: PlatformMembershipRole;
  status: PlatformMembershipStatus;
  version: number;
  companyId: string;
  companyName: string;
  companyStatus: 'active' | 'suspended';
  accountStatus: AccountStatus;
  emailVerified: boolean;
  /** Every private platform registry entry is protected, including suspended entries. */
  isPlatformAdmin: boolean;
};
export type PlatformMembership = PlatformCompanyMember;
export type PlatformCompanyMembersPage = {
  companyId: string;
  companyName: string;
  companyStatus: 'active' | 'suspended';
  actorUserId: string;
  teamVersion: number;
  members: PlatformCompanyMember[];
  nextPageKey: string | null;
};
export type PlatformAccountMembershipsPage = {
  userId: string;
  actorUserId: string;
  email: string | null;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  memberships: PlatformCompanyMember[];
  nextPageKey: string | null;
};
export type PlatformMembershipReceipt = {
  companyId: string;
  actorUserId: string;
  requestId: string;
  teamVersion: number;
  member: PlatformCompanyMember;
};
export type PlatformMembershipQuery = { pageKey?: string | null; limit?: number };
export type ListPlatformCompanyMembersInput = PlatformMembershipQuery & { companyId: string };
export type ListPlatformAccountMembershipsInput = PlatformMembershipQuery & { userId: string };
export type UpdatePlatformCompanyMemberInput = {
  companyId: string;
  membershipId: string;
  expectedVersion: number;
  role: PlatformMembershipEditableRole;
  status: PlatformMembershipStatus;
  reason: string;
  requestId: string;
};
type Functions = {
  list_platform_company_members: { Args: { p_company_id: string; p_page_key: string | null; p_limit: number }; Returns: Json };
  list_platform_account_memberships: { Args: { p_user_id: string; p_page_key: string | null; p_limit: number }; Returns: Json };
  update_platform_company_member: { Args: { p_company_id: string; p_membership_id: string; p_expected_version: number; p_role: string; p_status: string; p_reason: string; p_request_id: string }; Returns: Json };
};
export type PlatformMembershipDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & { Functions: Omit<Database['public']['Functions'], keyof Functions> & Functions };
};
