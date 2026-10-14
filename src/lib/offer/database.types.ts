import type {Database} from '@/lib/supabase/database.types';
type OfferFunctions={create_offer_version_with_trade_in:{Args:{company:string;deal:string;submission:string;terms:string;valid_until:string;gross_confirmed:boolean;trade_in_id:string|null;expected_trade_in_version:number|null;expected_offer_version:number;expected_sale_price_ore:string};Returns:string}};
export type OfferDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:Database['public']['Functions']&OfferFunctions}};
