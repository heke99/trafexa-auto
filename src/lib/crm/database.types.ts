import type { Database, Json } from '@/lib/supabase/database.types';
type CrmFunctions = {
 list_customer_contacts: {Args:{p_company_id:string;p_customer_id:string;p_page_key:string|null;p_limit:number};Returns:Json};
 list_customer_follow_ups: {Args:{p_company_id:string;p_filter:string;p_page_key:string|null;p_limit:number};Returns:Json};
 create_customer_contact: {Args:{p_company_id:string;p_customer_id:string;p_kind:string;p_contact_on:string;p_summary:string;p_follow_up_on:string|null;p_request_id:string};Returns:Json};
 update_customer_follow_up: {Args:{p_company_id:string;p_customer_id:string;p_contact_id:string;p_expected_version:number;p_status:string;p_reason:string;p_request_id:string};Returns:Json};
};
export type CrmDatabase = Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'> & {Functions:Database['public']['Functions'] & CrmFunctions}};
