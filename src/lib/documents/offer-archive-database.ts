import type { Database, Json } from '../supabase/database.types';

/** Additive local RPC overlay; the live generated database types remain unchanged. */
export type OfferArchiveDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & {
      get_offer_archive_source: {
        Args: { p_company_id: string; p_offer_id: string };
        Returns: Json;
      };
      get_offer_document_archive: {
        Args: { p_company_id: string; p_offer_id: string };
        Returns: Json;
      };
      get_offer_archive_by_document: {
        Args: { p_company_id: string; p_document_id: string };
        Returns: Json;
      };
      register_offer_document_archive: {
        Args: {
          p_company_id: string;
          p_offer_id: string;
          p_offer_version: number;
          p_pdf_sha256: string;
          p_snapshot_sha256: string;
          p_object_path: string;
          p_submission_id: string;
          p_actor_user_id: string;
        };
        Returns: Json;
      };
    };
  };
};
