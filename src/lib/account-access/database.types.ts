import type { Database, Json } from '@/lib/supabase/database.types';
type AccountFunctions = {
 get_account_access: { Args: Record<string, never>; Returns: Json };
 list_platform_accounts: { Args: { p_filter: string; p_page_key: string | null; p_limit: number }; Returns: Json };
 search_platform_accounts: { Args: { p_filter: string; p_query: string; p_cursor: Json | null; p_limit: number }; Returns: Json };
 set_platform_account_access: { Args: { p_user_id: string; p_expected_version: number; p_status: string; p_reason: string; p_request_id: string }; Returns: Json };
};
export type AccountDatabase = Omit<Database,'public'> & { public: Omit<Database['public'],'Functions'> & { Functions: Database['public']['Functions'] & AccountFunctions } };
