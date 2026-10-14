import type { Database, Json } from '@/lib/supabase/database.types';
export type DealCancellationDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & {
  cancel_deal: { Args: { p_company_id: string; p_deal_id: string; p_expected_status: string; p_reason: string; p_request_id: string }; Returns: Json };
} } };
