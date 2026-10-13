import type { Database, Json } from '../supabase/database.types';
export type CalculationDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & {
      get_vehicle_calculation: { Args: { p_company_id: string; p_stock_item_id: string }; Returns: Json };
      save_vehicle_calculation_metadata: { Args: { p_company_id: string; p_stock_item_id: string; p_expected_version: string; p_purchase_vat_ore: string | null; p_vat_basis_confirmed: boolean; p_cost_vat: Json }; Returns: Json };
      inventory_dashboard_totals: { Args: { p_company_id: string }; Returns: Json };
    };
  };
};
