import type { Database, Json } from '@/lib/supabase/database.types';
type ReviewFunctions = {
 list_deal_offer_reviews: {Args:{p_company_id:string;p_deal_id:string};Returns:Json};
 publish_offer_review: {Args:{p_company_id:string;p_deal_id:string;p_offer_id:string;p_request_id:string};Returns:Json};
 withdraw_offer_review: {Args:{p_company_id:string;p_deal_id:string;p_review_id:string;p_expected_version:number;p_reason:string;p_request_id:string};Returns:Json};
 list_my_offer_reviews: {Args:{p_page_key:string|null;p_limit:number};Returns:Json};
 respond_offer_review: {Args:{p_review_id:string;p_expected_version:number;p_decision:string;p_responder_name:string;p_reason:string|null;p_ack_version:string;p_request_id:string};Returns:Json};
};
export type ReviewDatabase = Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'> & {Functions:Database['public']['Functions'] & ReviewFunctions}};
