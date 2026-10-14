import type { Database, Json } from '@/lib/supabase/database.types';

export type WebApplicationSeeking = 'system' | 'purchase_finance' | 'stock_finance' | 'dealer_network' | 'advertising' | 'other';
export type WebApplicationStatus = 'new' | 'in_review' | 'contacted' | 'closed';
type WebApplicationFunctions = {
  submit_web_application: { Args: { p_request_id: string; p_name: string; p_email: string; p_company: string; p_phone: string; p_organisation_number: string; p_seeking: WebApplicationSeeking[]; p_message: string; p_privacy_version: string; p_privacy_acknowledged: boolean }; Returns: Json };
  erase_platform_web_application: { Args: { p_application_id: string; p_expected_version: number; p_reason: 'rights_request' | 'no_longer_needed'; p_request_id: string }; Returns: Json };
  get_platform_web_application: { Args: { p_application_id: string }; Returns: Json };
  set_platform_web_application_status: { Args: { p_application_id: string; p_expected_version: number; p_status: WebApplicationStatus; p_reason: string; p_request_id: string }; Returns: Json };
};
export type WebApplicationDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & WebApplicationFunctions };
};
