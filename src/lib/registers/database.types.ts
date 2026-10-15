import type { Database, Json } from '@/lib/supabase/database.types';

/** Narrow migration-owned overlay until generated public types are refreshed. */
export type RegisterDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & {
      dealer_register_page: {
        Args: { p_company_id: string; p_kind: string; p_query: string; p_status: string; p_sort: string; p_cursor: Json | null; p_options: boolean; p_selected_id: string | null };
        Returns: Json;
      };
    };
  };
};
