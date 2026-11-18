export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type GeneratedDatabase = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          customer_id: string | null
          deal_id: string | null
          description: string
          id: string
        }
        ComputedFields: never
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          customer_id?: string | null
          deal_id?: string | null
          description: string
          id?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          customer_id?: string | null
          deal_id?: string | null
          description?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_company_id_customer_id_fkey"
            columns: ["company_id", "customer_id"]
            referencedRelation: "customers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "activities_company_id_deal_id_fkey"
            columns: ["company_id", "deal_id"]
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "activities_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          company_id: string
          created_at: string
          entity_id: string
          entity_table: string
          id: string
        }
        ComputedFields: never
        Insert: {
          action: string
          actor_user_id?: string | null
          company_id: string
          created_at?: string
          entity_id: string
          entity_table: string
          id?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          company_id?: string
          created_at?: string
          entity_id?: string
          entity_table?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          organisation_number: string
          status: string
          team_version: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          organisation_number: string
          status?: string
          team_version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organisation_number?: string
          status?: string
          team_version?: number
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          company_id: string
          contact_version: number
          created_at: string
          email: string | null
          id: string
          kind: string
          name: string
          notes: string | null
          phone: string | null
        }
        ComputedFields: never
        Insert: {
          address?: string | null
          company_id: string
          contact_version?: number
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          company_id?: string
          contact_version?: number
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dealer_approvals: {
        Row: {
          company_id: string
          confirmed_at: string | null
          created_at: string
          external_reference: string | null
          id: string
          partner_id: string
          product: string
          status: string
        }
        ComputedFields: never
        Insert: {
          company_id: string
          confirmed_at?: string | null
          created_at?: string
          external_reference?: string | null
          id?: string
          partner_id: string
          product: string
          status?: string
        }
        Update: {
          company_id?: string
          confirmed_at?: string | null
          created_at?: string
          external_reference?: string | null
          id?: string
          partner_id?: string
          product?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "dealer_approvals_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_approvals_partner_id_fkey"
            columns: ["partner_id"]
            referencedRelation: "finance_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          customer_id: string
          id: string
          sale_price_ore: number
          status: string
          stock_item_id: string
        }
        ComputedFields: never
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          customer_id: string
          id?: string
          sale_price_ore: number
          status?: string
          stock_item_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          sale_price_ore?: number
          status?: string
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_customer_id_fkey"
            columns: ["company_id", "customer_id"]
            referencedRelation: "customers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_company_id_stock_item_id_fkey"
            columns: ["company_id", "stock_item_id"]
            referencedRelation: "stock_items"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      documents: {
        Row: {
          company_id: string
          created_at: string
          deal_id: string | null
          id: string
          kind: string
          name: string
          object_path: string
        }
        ComputedFields: never
        Insert: {
          company_id: string
          created_at?: string
          deal_id?: string | null
          id?: string
          kind: string
          name: string
          object_path: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deal_id?: string | null
          id?: string
          kind?: string
          name?: string
          object_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_company_id_deal_id_fkey"
            columns: ["company_id", "deal_id"]
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "documents_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_applications: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          deal_id: string | null
          deposit_ore: number
          id: string
          note: string | null
          partner_id: string | null
          product: string
          requested_amount_ore: number
          status: string
          term_months: number | null
        }
        ComputedFields: never
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          deal_id?: string | null
          deposit_ore?: number
          id?: string
          note?: string | null
          partner_id?: string | null
          product: string
          requested_amount_ore: number
          status?: string
          term_months?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          deal_id?: string | null
          deposit_ore?: number
          id?: string
          note?: string | null
          partner_id?: string | null
          product?: string
          requested_amount_ore?: number
          status?: string
          term_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_applications_company_id_deal_id_fkey"
            columns: ["company_id", "deal_id"]
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "finance_applications_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_applications_partner_id_fkey"
            columns: ["partner_id"]
            referencedRelation: "finance_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_partners: {
        Row: {
          created_at: string
          id: string
          name: string
          status: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          name: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          status?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string | null
          id: string
          status: string
          subject: string
        }
        ComputedFields: never
        Insert: {
          company_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          status?: string
          subject: string
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_customer_id_fkey"
            columns: ["company_id", "customer_id"]
            referencedRelation: "customers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: string
          status: string
          user_id: string
          version: number
        }
        ComputedFields: never
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role: string
          status?: string
          user_id: string
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: string
          status?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "memberships_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_document_archives: {
        Row: {
          archived_by: string
          company_id: string
          created_at: string
          deal_id: string
          document_id: string
          document_kind: string
          document_name: string
          object_path: string
          offer_id: string
          offer_version: number
          pdf_sha256: string
          snapshot_sha256: string
          storage_bucket: string
          submission_id: string
        }
        ComputedFields: never
        Insert: {
          archived_by: string
          company_id: string
          created_at?: string
          deal_id: string
          document_id: string
          document_kind?: string
          document_name: string
          object_path: string
          offer_id: string
          offer_version: number
          pdf_sha256: string
          snapshot_sha256: string
          storage_bucket?: string
          submission_id: string
        }
        Update: {
          archived_by?: string
          company_id?: string
          created_at?: string
          deal_id?: string
          document_id?: string
          document_kind?: string
          document_name?: string
          object_path?: string
          offer_id?: string
          offer_version?: number
          pdf_sha256?: string
          snapshot_sha256?: string
          storage_bucket?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_document_archives_company_id_deal_id_fkey"
            columns: ["company_id", "deal_id"]
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "offer_document_archives_company_id_document_id_fkey"
            columns: ["company_id", "document_id"]
            referencedRelation: "documents"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "offer_document_archives_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_document_archives_company_id_offer_id_fkey"
            columns: ["company_id", "offer_id"]
            referencedRelation: "offers"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      offers: {
        Row: {
          company_id: string
          created_at: string
          deal_id: string
          id: string
          snapshot: NonNullable<Json>
          version: number
        }
        ComputedFields: never
        Insert: {
          company_id: string
          created_at?: string
          deal_id: string
          id?: string
          snapshot: NonNullable<Json>
          version: number
        }
        Update: {
          company_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          snapshot?: NonNullable<Json>
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "offers_company_id_deal_id_fkey"
            columns: ["company_id", "deal_id"]
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "offers_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          deal_id: string
          expires_at: string
          id: string
          status: string
          stock_item_id: string
        }
        ComputedFields: never
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          deal_id: string
          expires_at: string
          id?: string
          status?: string
          stock_item_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          deal_id?: string
          expires_at?: string
          id?: string
          status?: string
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_company_id_deal_id_fkey"
            columns: ["company_id", "deal_id"]
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "reservations_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_company_id_stock_item_id_fkey"
            columns: ["company_id", "stock_item_id"]
            referencedRelation: "stock_items"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      signing_document_versions: {
        Row: {
          approved_signers: NonNullable<Json>
          approved_template_id: number
          approved_template_sha256: string
          approved_template_version: number
          company_id: string
          created_at: string
          document_id: string
          document_version: number
          registered_by: string
          source_object_path: string
          source_sha256: string
        }
        ComputedFields: never
        Insert: {
          approved_signers: NonNullable<Json>
          approved_template_id: number
          approved_template_sha256: string
          approved_template_version: number
          company_id: string
          created_at?: string
          document_id: string
          document_version: number
          registered_by: string
          source_object_path: string
          source_sha256: string
        }
        Update: {
          approved_signers?: NonNullable<Json>
          approved_template_id?: number
          approved_template_sha256?: string
          approved_template_version?: number
          company_id?: string
          created_at?: string
          document_id?: string
          document_version?: number
          registered_by?: string
          source_object_path?: string
          source_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "signing_document_versions_company_id_document_id_fkey"
            columns: ["company_id", "document_id"]
            referencedRelation: "documents"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "signing_document_versions_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      signing_jobs: {
        Row: {
          claim_expires_at: string | null
          claim_token: string | null
          company_id: string
          created_at: string
          created_by: string
          deal_id: string | null
          document_id: string
          document_kind: string
          document_version: number
          error_code: string | null
          id: string
          idempotency_key: string
          provider_instance: string
          provider_submission_id: number | null
          signers: NonNullable<Json>
          snapshot: NonNullable<Json>
          source_object_path: string
          source_sha256: string
          state: string
          template_id: number
          template_sha256: string
          template_version: number
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          claim_expires_at?: string | null
          claim_token?: string | null
          company_id: string
          created_at?: string
          created_by: string
          deal_id?: string | null
          document_id: string
          document_kind: string
          document_version: number
          error_code?: string | null
          id?: string
          idempotency_key: string
          provider_instance?: string
          provider_submission_id?: number | null
          signers: NonNullable<Json>
          snapshot: NonNullable<Json>
          source_object_path: string
          source_sha256: string
          state?: string
          template_id: number
          template_sha256: string
          template_version: number
          updated_at?: string
          version?: number
        }
        Update: {
          claim_expires_at?: string | null
          claim_token?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          deal_id?: string | null
          document_id?: string
          document_kind?: string
          document_version?: number
          error_code?: string | null
          id?: string
          idempotency_key?: string
          provider_instance?: string
          provider_submission_id?: number | null
          signers?: NonNullable<Json>
          snapshot?: NonNullable<Json>
          source_object_path?: string
          source_sha256?: string
          state?: string
          template_id?: number
          template_sha256?: string
          template_version?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "signing_jobs_company_id_deal_id_fkey"
            columns: ["company_id", "deal_id"]
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "signing_jobs_company_id_document_id_document_version_fkey"
            columns: ["company_id", "document_id", "document_version"]
            referencedRelation: "signing_document_versions"
            referencedColumns: ["company_id", "document_id", "document_version"]
          },
          {
            foreignKeyName: "signing_jobs_company_id_document_id_fkey"
            columns: ["company_id", "document_id"]
            referencedRelation: "documents"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "signing_jobs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signing_jobs_company_id_provider_instance_template_id_temp_fkey"
            columns: [
              "company_id",
              "provider_instance",
              "template_id",
              "template_version",
            ]
            referencedRelation: "signing_templates"
            referencedColumns: [
              "company_id",
              "provider_instance",
              "template_id",
              "template_version",
            ]
          },
        ]
      }
      signing_templates: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          document_kind: string
          provider_instance: string
          registered_by: string
          template_id: number
          template_sha256: string
          template_version: number
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          document_kind: string
          provider_instance?: string
          registered_by: string
          template_id: number
          template_sha256: string
          template_version: number
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          document_kind?: string
          provider_instance?: string
          registered_by?: string
          template_id?: number
          template_sha256?: string
          template_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "signing_templates_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      signing_webhook_inbox: {
        Row: {
          body_sha256: string
          created_at: string
          event: NonNullable<Json>
          id: string
          job_id: string | null
          processed_at: string | null
          provider_instance: string
          provider_submission_id: number
          status: string
        }
        ComputedFields: never
        Insert: {
          body_sha256: string
          created_at?: string
          event: NonNullable<Json>
          id?: string
          job_id?: string | null
          processed_at?: string | null
          provider_instance?: string
          provider_submission_id: number
          status: string
        }
        Update: {
          body_sha256?: string
          created_at?: string
          event?: NonNullable<Json>
          id?: string
          job_id?: string | null
          processed_at?: string | null
          provider_instance?: string
          provider_submission_id?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "signing_webhook_inbox_job_id_fkey"
            columns: ["job_id"]
            referencedRelation: "signing_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_items: {
        Row: {
          acquired_on: string
          asking_price_ore: number
          calculation_version: number
          company_id: string
          created_at: string
          currency: string
          id: string
          purchase_price_ore: number
          purchase_vat_ore: number | null
          status: string
          vat_basis_confirmed: boolean
          vat_scheme: string
          vehicle_id: string
        }
        ComputedFields: never
        Insert: {
          acquired_on?: string
          asking_price_ore: number
          calculation_version?: number
          company_id: string
          created_at?: string
          currency?: string
          id?: string
          purchase_price_ore: number
          purchase_vat_ore?: number | null
          status?: string
          vat_basis_confirmed?: boolean
          vat_scheme: string
          vehicle_id: string
        }
        Update: {
          acquired_on?: string
          asking_price_ore?: number
          calculation_version?: number
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          purchase_price_ore?: number
          purchase_vat_ore?: number | null
          status?: string
          vat_basis_confirmed?: boolean
          vat_scheme?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_items_company_id_vehicle_id_fkey"
            columns: ["company_id", "vehicle_id"]
            referencedRelation: "vehicles"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      vehicle_costs: {
        Row: {
          amount_ore: number
          category: string
          company_id: string
          created_at: string
          deductible_vat_ore: number | null
          description: string
          id: string
          incurred_on: string
          stock_item_id: string
        }
        ComputedFields: never
        Insert: {
          amount_ore: number
          category: string
          company_id: string
          created_at?: string
          deductible_vat_ore?: number | null
          description: string
          id?: string
          incurred_on?: string
          stock_item_id: string
        }
        Update: {
          amount_ore?: number
          category?: string
          company_id?: string
          created_at?: string
          deductible_vat_ore?: number | null
          description?: string
          id?: string
          incurred_on?: string
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_costs_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_costs_company_id_stock_item_id_fkey"
            columns: ["company_id", "stock_item_id"]
            referencedRelation: "stock_items"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      vehicles: {
        Row: {
          company_id: string
          created_at: string
          fuel: string
          gearbox: string
          id: string
          make: string
          mileage_km: number
          model: string
          model_year: number
          registration_number: string
          vin: string | null
        }
        ComputedFields: never
        Insert: {
          company_id: string
          created_at?: string
          fuel?: string
          gearbox?: string
          id?: string
          make: string
          mileage_km?: number
          model: string
          model_year: number
          registration_number: string
          vin?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          fuel?: string
          gearbox?: string
          id?: string
          make?: string
          mileage_km?: number
          model?: string
          model_year?: number
          registration_number?: string
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_company_id_fkey"
            columns: ["company_id"]
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_company_invitation: {
        Args: {
          p_expected_version: number
          p_invitation_id: string
          p_request_id: string
        }
        Returns: Json
      }
      accept_company_ownership_transfer: {
        Args: {
          p_acknowledged: boolean
          p_attestation_version: string
          p_company_id: string
          p_expected_team_version: number
          p_expected_version: number
          p_request_id: string
          p_transfer_id: string
        }
        Returns: Json
      }
      activate_customer_contract_account: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      apply_advertising_invoice_email_event: {
        Args: {
          p_email_id?: string
          p_event_at: string
          p_event_id: string
          p_event_type: string
          p_provider_id: string
          p_recipient_hash: string
        }
        Returns: Json
      }
      apply_signing_webhook: {
        Args: {
          p_expected_job_version: number
          p_inbox_id: string
          p_snapshot: Json
        }
        Returns: Json
      }
      approve_direct_deal: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_deal_id: string
          p_draft_id: string
          p_request_id: string
          p_review_hash: string
          p_seller_name: string
        }
        Returns: Json
      }
      archive_uploaded_pdf: {
        Args: {
          p_evidence_sha256: string
          p_pdf_sha256: string
          p_source_id: string
        }
        Returns: Json
      }
      archive_vehicle_photo: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_photo_id: string
          p_request_id: string
        }
        Returns: Json
      }
      begin_blocket_delivery: {
        Args: {
          p_claim_token: string
          p_expected_job_version: number
          p_job_id: string
          p_payload_sha256: string
        }
        Returns: Json
      }
      begin_customer_contract_invitation_send: {
        Args: { p_email_id: string; p_lease_id: string }
        Returns: Json
      }
      begin_prepared_blocket_delivery: {
        Args: {
          p_claim_token: string
          p_expected_job_version: number
          p_expected_provider_ad_id: string
          p_job_id: string
          p_payload_sha256: string
        }
        Returns: Json
      }
      bind_advertising_invoice_email: {
        Args: {
          p_company_id: string
          p_email_id: string
          p_lease_id: string
          p_payload_hash: string
          p_pdf_sha256: string
        }
        Returns: Json
      }
      bind_advertising_listing_program: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_listing_id: string
          p_request_id: string
          p_store_id: string
        }
        Returns: Json
      }
      bind_blocket_company: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_dealer_code: string
          p_evidence_reference: string
          p_expected_connection_version: number
          p_expected_group_version: number
          p_group_id: string
          p_reason: string
          p_request_id: string
          p_valid_until: string
        }
        Returns: Json
      }
      bind_customer_contract_invitation: {
        Args: {
          p_ciphertext: string
          p_email_id: string
          p_invitation_id: string
          p_lease_id: string
        }
        Returns: Json
      }
      bind_guest_document_invitation: {
        Args: {
          p_ciphertext: string
          p_email_id: string
          p_invitation_id: string
          p_lease_id: string
          p_token_sha256: string
        }
        Returns: Json
      }
      bind_platform_application_invitation_delivery: {
        Args: {
          p_actor_user_id: string
          p_ciphertext: string
          p_invitation_id: string
          p_lease_id: string
        }
        Returns: Json
      }
      bind_uploaded_pdf_mail: {
        Args: {
          p_body_sha256: string
          p_email_id: string
          p_lease_id: string
          p_token_sha256: string
        }
        Returns: boolean
      }
      cancel_company_ownership_transfer: {
        Args: {
          p_acknowledged: boolean
          p_attestation_version: string
          p_company_id: string
          p_expected_team_version: number
          p_expected_version: number
          p_reason: string
          p_request_id: string
          p_transfer_id: string
        }
        Returns: Json
      }
      cancel_deal: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_expected_status: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      cancel_uploaded_pdf: {
        Args: { p_company_id: string; p_reason: string; p_source_id: string }
        Returns: boolean
      }
      check_advertising_invoice_email: {
        Args: {
          p_company_id: string
          p_email_id: string
          p_lease_id: string
          p_payload_hash: string
          p_pdf_sha256: string
        }
        Returns: Json
      }
      check_transactional_email_lease: {
        Args: { p_id: string; p_lease_id: string }
        Returns: boolean
      }
      claim_advertising_invoice_email: {
        Args: { p_company_id: string; p_email_id: string }
        Returns: Json
      }
      claim_advertising_job: {
        Args: {
          p_claim_token: string
          p_expected_version: number
          p_job_id: string
        }
        Returns: Json
      }
      claim_platform_admin_access: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      claim_platform_application_invitation_delivery: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      claim_platform_application_invitation_delivery_v2: {
        Args: { p_expected_delivery_id: string; p_invitation_id: string }
        Returns: Json
      }
      claim_signing_job: {
        Args: {
          p_claim_token: string
          p_expected_version: number
          p_job_id: string
        }
        Returns: Json
      }
      claim_transactional_email: {
        Args: { p_kind?: string; p_reference?: string }
        Returns: Json
      }
      claim_transactional_email_enabled: {
        Args: { p_kinds: string[] }
        Returns: Json
      }
      claim_transactional_email_exact:
        | { Args: { p_email_id: string }; Returns: Json }
        | {
            Args: {
              p_expected_email_id: string
              p_kind: string
              p_reference: string
            }
            Returns: Json
          }
      claim_uploaded_pdf_mail: {
        Args: { p_kind: string; p_source_id: string }
        Returns: Json
      }
      configure_advertising_credit_series: {
        Args: {
          p_company_id: string
          p_expected_original_source_hash: string
          p_first_number: string
          p_original_invoice_id: string
          p_prefix: string
          p_reason: string
          p_request_id: string
          p_review_acknowledged: boolean
          p_seller_registered_seat: string
          p_year: number
        }
        Returns: Json
      }
      configure_advertising_invoice_series: {
        Args: {
          p_assessment_id: string
          p_company_id: string
          p_expected_assessment_source_hash: string
          p_first_number: string
          p_prefix: string
          p_reason: string
          p_request_id: string
          p_review_acknowledged: boolean
          p_seller_registered_seat: string
          p_year: number
        }
        Returns: Json
      }
      configure_blocket_group: {
        Args: {
          p_acknowledged: boolean
          p_credential_reference: string
          p_expected_version: number
          p_group_id: string
          p_group_reference: string
          p_reason: string
          p_request_id: string
          p_scope: string
          p_status: string
        }
        Returns: Json
      }
      confirm_paper_sale: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_request_id: string
          p_review_hash: string
          p_review_id: string
        }
        Returns: Json
      }
      create_advertising_financial_assessment: {
        Args: {
          p_company_id: string
          p_draft_id: string
          p_expected_draft_source_hash: string
          p_expected_review_token: string
          p_expected_settings_review_token: string
          p_expected_settings_version: number
          p_month: string
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      create_advertising_financial_assessment_v2: {
        Args: {
          p_company_id: string
          p_draft_id: string
          p_expected_draft_source_hash: string
          p_expected_review_token: string
          p_expected_settings_review_token: string
          p_expected_settings_version: number
          p_month: string
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      create_advertising_invoice_draft: {
        Args: {
          p_company_id: string
          p_expected_buyer_version: number
          p_expected_review_token: string
          p_expected_seller_version: number
          p_month: string
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      create_advertising_reduction: {
        Args: {
          p_amount_ore: string
          p_company_id: string
          p_expected_review_token: string
          p_month: string
          p_publication_id: string
          p_reason: string
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      create_company: {
        Args: { company_name: string; org_number: string }
        Returns: string
      }
      create_company_invitation: {
        Args: {
          p_company_id: string
          p_email: string
          p_expected_team_version: number
          p_request_id: string
          p_role: string
        }
        Returns: Json
      }
      create_company_with_profile: {
        Args: {
          p_fields: Json
          p_legal_name: string
          p_organisation_number: string
          p_representation_acknowledged: boolean
          p_request_id: string
        }
        Returns: Json
      }
      create_contract_template_version: {
        Args: {
          p_body: string
          p_company_id: string
          p_expected_version: number
          p_request_id: string
          p_template_id: string
          p_title: string
        }
        Returns: Json
      }
      create_customer_contact: {
        Args: {
          p_company_id: string
          p_contact_on: string
          p_customer_id: string
          p_follow_up_on: string
          p_kind: string
          p_request_id: string
          p_summary: string
        }
        Returns: Json
      }
      create_customer_lead: {
        Args: {
          company: string
          contact_email: string
          contact_name: string
          contact_phone: string
          lead_subject: string
          submission: string
        }
        Returns: string
      }
      create_customer_request: {
        Args: {
          p_address: string
          p_company_id: string
          p_email: string
          p_kind: string
          p_name: string
          p_notes: string
          p_phone: string
          p_request_id: string
        }
        Returns: Json
      }
      create_deal: {
        Args: {
          company: string
          customer: string
          price_ore: number
          stock: string
        }
        Returns: string
      }
      create_finance_intake_request: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_deposit_ore: number
          p_note: string
          p_product: string
          p_request_id: string
          p_requested_amount_ore: number
          p_term_months: number
        }
        Returns: Json
      }
      create_offer_version: {
        Args: {
          company: string
          deal: string
          gross_confirmed: boolean
          submission: string
          terms: string
          valid_until: string
        }
        Returns: string
      }
      create_offer_version_with_trade_in: {
        Args: {
          company: string
          deal: string
          expected_offer_version: number
          expected_sale_price_ore: number
          expected_trade_in_version: number
          gross_confirmed: boolean
          submission: string
          terms: string
          trade_in_id: string
          valid_until: string
        }
        Returns: string
      }
      create_purchase_condition_version: {
        Args: {
          p_acquired_on: string
          p_checked_on: string
          p_company_id: string
          p_conditions: Json
          p_document_reference: string
          p_expected_calculation_version: number
          p_expected_purchase_price_ore: number
          p_expected_vehicle_id: string
          p_expected_version: number
          p_mileage_km: number
          p_repair_estimate_ore: number
          p_request_id: string
          p_stock_id: string
          p_supplier_kind: string
          p_supplier_name: string
          p_supplier_organisation_number: string
        }
        Returns: Json
      }
      create_sale_contract_draft: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_expected_template_approval_version: number
          p_offer_id: string
          p_request_id: string
          p_template_version_id: string
        }
        Returns: Json
      }
      create_stock: {
        Args: {
          asking_ore: number
          company: string
          fuel_type: string
          gearbox_type: string
          make_name: string
          mileage: number
          model_name: string
          purchase_ore: number
          registration: string
          vat: string
          year: number
        }
        Returns: string
      }
      create_trade_in_version: {
        Args: {
          p_company_id: string
          p_condition_notes: string
          p_deal_id: string
          p_debt_known: boolean
          p_debt_ore: number
          p_equipment_notes: string
          p_expected_sale_price_ore: number
          p_expected_version: number
          p_lender_name: string
          p_make: string
          p_mileage_km: number
          p_model: string
          p_model_year: number
          p_registration: string
          p_request_id: string
          p_value_ore: number
        }
        Returns: Json
      }
      create_vehicle_cost_request: {
        Args: {
          p_amount_ore: number
          p_category: string
          p_company_id: string
          p_description: string
          p_incurred_on: string
          p_request_id: string
          p_stock_item_id: string
        }
        Returns: Json
      }
      current_customer_contract_invitation: {
        Args: {
          p_email_id: string
          p_invitation_id: string
          p_lease_id: string
        }
        Returns: Json
      }
      dealer_document_hub_page: {
        Args: {
          p_company_id: string
          p_cursor?: Json
          p_kind?: string
          p_query?: string
        }
        Returns: Json
      }
      dealer_document_hub_page_v2: {
        Args: {
          p_company_id: string
          p_cursor?: Json
          p_kind?: string
          p_query?: string
        }
        Returns: Json
      }
      dealer_network_more: {
        Args: {
          p_after_id: string
          p_company_id: string
          p_inquiry_id?: string
          p_kind: string
        }
        Returns: Json
      }
      dealer_network_mutate: {
        Args: { p_company_id: string; p_payload: Json; p_request_id: string }
        Returns: Json
      }
      dealer_network_page: {
        Args: { p_company_id: string; p_offset: number; p_query: string }
        Returns: Json
      }
      dealer_register_page: {
        Args: {
          p_company_id: string
          p_cursor?: Json
          p_kind: string
          p_options?: boolean
          p_query?: string
          p_selected_id?: string
          p_sort?: string
          p_status?: string
        }
        Returns: Json
      }
      disable_blocket_company: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_expected_connection_version: number
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      enqueue_signing_webhook: {
        Args: { p_body_sha256: string; p_event: Json }
        Returns: Json
      }
      erase_platform_web_application: {
        Args: {
          p_application_id: string
          p_expected_version: number
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      expire_advertising_dispatch: {
        Args: { p_expected_version: number; p_job_id: string }
        Returns: Json
      }
      finalize_verified_blocket_job: {
        Args: { p_job_id: string }
        Returns: Json
      }
      finish_advertising_invoice_email: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_email_id: string
          p_lease_id: string
          p_outcome: string
          p_payload_hash: string
          p_pdf_sha256: string
          p_provider_id: string
        }
        Returns: Json
      }
      finish_blocket_preparation: {
        Args: {
          p_error_code: string
          p_expected_job_version: number
          p_job_id: string
          p_status: string
          p_token: string
        }
        Returns: Json
      }
      finish_platform_application_invitation_delivery: {
        Args: {
          p_actor_user_id: string
          p_invitation_id: string
          p_lease_id: string
          p_outcome: string
          p_provider_id: string
        }
        Returns: Json
      }
      finish_transactional_email: {
        Args: {
          p_id: string
          p_lease_id: string
          p_provider_id?: string
          p_status: string
        }
        Returns: boolean
      }
      finish_uploaded_pdf_mail: {
        Args: {
          p_email_id: string
          p_lease_id: string
          p_provider_id: string
          p_status: string
        }
        Returns: boolean
      }
      get_account_access: { Args: Record<PropertyKey, never>; Returns: Json }
      get_advertising_credit_invoice: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_advertising_financial_assessment: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_advertising_invoice_draft: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_advertising_issued_invoice: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_advertising_job: { Args: { p_job_id: string }; Returns: Json }
      get_advertising_send_quote: {
        Args: {
          p_channels: string[]
          p_company_id: string
          p_expected_version: number
          p_listing_id: string
        }
        Returns: Json
      }
      get_blocket_delivery: { Args: { p_job_id: string }; Returns: Json }
      get_blocket_worker_binding: { Args: { p_job_id: string }; Returns: Json }
      get_blocket_worker_group: { Args: { p_group_id: string }; Returns: Json }
      get_company_ownership_transfer: {
        Args: { p_company_id: string; p_limit?: number; p_page_key?: string }
        Returns: Json
      }
      get_company_public_store: {
        Args: { p_company_id: string }
        Returns: Json
      }
      get_company_store_export: {
        Args: { p_company_id: string; p_export_id: string }
        Returns: Json
      }
      get_company_store_profile: {
        Args: { p_company_id: string }
        Returns: Json
      }
      get_contract_signing: {
        Args: { p_company_id?: string; p_signing_id: string }
        Returns: Json
      }
      get_contract_signing_archive: {
        Args: { p_company_id?: string; p_signing_id: string }
        Returns: Json
      }
      get_contract_signing_delivery: {
        Args: { p_company_id: string; p_deal_id: string; p_signing_id: string }
        Returns: Json
      }
      get_customer_document_renewal: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_kind: string
          p_reference_id: string
        }
        Returns: Json
      }
      get_customer_portal_access: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_deal_archive: {
        Args: { p_company_id: string; p_deal_id: string }
        Returns: Json
      }
      get_deal_contract_progress: {
        Args: { p_company_id: string; p_deal_ids: string[] }
        Returns: Json
      }
      get_deal_delete: {
        Args: { p_company_id: string; p_deal_id: string }
        Returns: Json
      }
      get_deal_fulfilment: {
        Args: { p_company_id: string; p_deal_id: string }
        Returns: Json
      }
      get_direct_deal_options: {
        Args: {
          p_company_id: string
          p_customer_id?: string
          p_deal_id?: string
        }
        Returns: Json
      }
      get_guest_contract_archive: {
        Args: { p_invitation_id: string; p_token_hash: string }
        Returns: Json
      }
      get_guest_customer_document: {
        Args: { p_invitation_id: string; p_token_hash: string }
        Returns: Json
      }
      get_guest_invitation_renewal_review: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_kind: string
          p_reference_id: string
        }
        Returns: Json
      }
      get_my_company_access_status: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_offer_archive_by_document: {
        Args: { p_company_id: string; p_document_id: string }
        Returns: Json
      }
      get_offer_archive_source: {
        Args: { p_company_id: string; p_offer_id: string }
        Returns: Json
      }
      get_offer_document_archive: {
        Args: { p_company_id: string; p_offer_id: string }
        Returns: Json
      }
      get_offer_review_delivery: {
        Args: { p_company_id: string; p_deal_id: string; p_review_id: string }
        Returns: Json
      }
      get_paper_sale_options: {
        Args: {
          p_company_id: string
          p_deal_id?: string
          p_stock_item_id: string
        }
        Returns: Json
      }
      get_pdf_template_asset: {
        Args: { p_asset_id: string; p_company_id: string }
        Returns: Json
      }
      get_platform_admin_activation_access: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_platform_admin_session: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_platform_advertising_billing: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      get_platform_advertising_corrections: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      get_platform_advertising_credit_invoice: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_platform_advertising_credit_page: {
        Args: { p_company_id: string; p_original_invoice_id: string }
        Returns: Json
      }
      get_platform_advertising_financial_assessment: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_platform_advertising_financial_page: {
        Args: {
          p_before_version?: number
          p_company_id: string
          p_draft_id?: string
          p_month: string
        }
        Returns: Json
      }
      get_platform_advertising_financial_page_v2: {
        Args: {
          p_before_version?: number
          p_company_id: string
          p_draft_id?: string
          p_month: string
        }
        Returns: Json
      }
      get_platform_advertising_invoice_draft: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_platform_advertising_invoice_email_page: {
        Args: {
          p_company_id: string
          p_document_id: string
          p_document_kind: string
        }
        Returns: Json
      }
      get_platform_advertising_invoice_page: {
        Args: {
          p_before_version?: number
          p_company_id: string
          p_month: string
        }
        Returns: Json
      }
      get_platform_advertising_issuance_page: {
        Args: { p_assessment_id: string; p_company_id: string; p_month: string }
        Returns: Json
      }
      get_platform_advertising_issued_invoice: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_platform_advertising_payment_page: {
        Args: {
          p_before_sequence?: string
          p_company_id: string
          p_invoice_id: string
        }
        Returns: Json
      }
      get_platform_advertising_quantities: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      get_platform_advertising_receivables: {
        Args: { p_cursor?: Json; p_filter: string }
        Returns: Json
      }
      get_platform_advertising_usage: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      get_platform_application_invitation: {
        Args: { p_application_id: string }
        Returns: Json
      }
      get_platform_application_invitation_delivery: {
        Args: {
          p_actor_user_id: string
          p_invitation_id: string
          p_lease_id: string
        }
        Returns: Json
      }
      get_platform_blocket_provisioning: {
        Args: { p_company_id: string; p_limit?: number; p_page_key?: string }
        Returns: Json
      }
      get_platform_overview: { Args: Record<PropertyKey, never>; Returns: Json }
      get_platform_web_application: {
        Args: { p_application_id: string }
        Returns: Json
      }
      get_private_document_inventory: {
        Args: {
          p_after_bucket?: string
          p_after_path?: string
          p_limit?: number
        }
        Returns: Json
      }
      get_public_dealer_store: { Args: { p_slug: string }; Returns: Json }
      get_public_store_photo: {
        Args: { p_photo_id: string; p_slug: string }
        Returns: Json
      }
      get_purchase_condition_version: {
        Args: { p_company_id: string; p_stock_id: string; p_version: number }
        Returns: Json
      }
      get_sale_contract_draft: {
        Args: { p_company_id: string; p_draft_id: string }
        Returns: Json
      }
      get_stock_advertising: {
        Args: { p_company_id: string; p_stock_id: string }
        Returns: Json
      }
      get_trade_in_acquisition: {
        Args: { p_company_id: string; p_deal_id: string }
        Returns: Json
      }
      get_transactional_email_status: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_uploaded_pdf_guest: {
        Args: { p_source_id: string; p_token_sha256: string }
        Returns: Json
      }
      get_uploaded_pdf_source: {
        Args: { p_company_id: string; p_source_id: string }
        Returns: Json
      }
      get_vehicle_calculation: {
        Args: { p_company_id: string; p_stock_item_id: string }
        Returns: Json
      }
      get_vehicle_photo: {
        Args: { p_company_id: string; p_photo_id: string }
        Returns: Json
      }
      get_workspace_inventory: { Args: { p_company_id: string }; Returns: Json }
      import_stock_batch: {
        Args: { company: string; payload: Json; submission: string }
        Returns: number
      }
      inventory_dashboard_totals: {
        Args: { p_company_id: string }
        Returns: Json
      }
      issue_advertising_credit_invoice: {
        Args: {
          p_company_id: string
          p_expected_original_source_hash: string
          p_expected_review_token: string
          p_expected_series_id: string
          p_expected_series_review_token: string
          p_original_invoice_id: string
          p_reason: string
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      issue_advertising_invoice: {
        Args: {
          p_assessment_id: string
          p_company_id: string
          p_expected_assessment_source_hash: string
          p_expected_review_token: string
          p_expected_series_id: string
          p_expected_series_review_token: string
          p_month: string
          p_request_id: string
          p_review_acknowledged: boolean
          p_service_dates_acknowledged: boolean
        }
        Returns: Json
      }
      list_advertising_billing: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      list_advertising_corrections: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      list_advertising_credit_page: {
        Args: { p_company_id: string; p_original_invoice_id: string }
        Returns: Json
      }
      list_advertising_financial_page: {
        Args: {
          p_before_version?: number
          p_company_id: string
          p_draft_id?: string
          p_month: string
        }
        Returns: Json
      }
      list_advertising_financial_page_v2: {
        Args: {
          p_before_version?: number
          p_company_id: string
          p_draft_id?: string
          p_month: string
        }
        Returns: Json
      }
      list_advertising_invoice_email_page: {
        Args: {
          p_company_id: string
          p_document_id: string
          p_document_kind: string
        }
        Returns: Json
      }
      list_advertising_invoice_page: {
        Args: {
          p_before_version?: number
          p_company_id: string
          p_month: string
        }
        Returns: Json
      }
      list_advertising_issuance_page: {
        Args: { p_assessment_id: string; p_company_id: string; p_month: string }
        Returns: Json
      }
      list_advertising_payment_page: {
        Args: {
          p_before_sequence?: string
          p_company_id: string
          p_invoice_id: string
        }
        Returns: Json
      }
      list_advertising_program: { Args: { p_company: string }; Returns: Json }
      list_advertising_quantities: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      list_advertising_stock: {
        Args: { p_company_id: string; p_limit?: number; p_page_key?: string }
        Returns: Json
      }
      list_advertising_usage: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      list_company_advertising: {
        Args: {
          p_company_id: string
          p_jobs_page_key?: string
          p_limit?: number
          p_page_key?: string
        }
        Returns: Json
      }
      list_company_branches: {
        Args: {
          p_company_id: string
          p_limit?: number
          p_page_key?: string
          p_status: string
        }
        Returns: Json
      }
      list_company_team: {
        Args: {
          p_company_id: string
          p_invitations_page_key?: string
          p_limit?: number
          p_members_page_key?: string
        }
        Returns: Json
      }
      list_contract_templates: {
        Args: {
          p_before_template_id?: string
          p_company_id: string
          p_template_id?: string
        }
        Returns: Json
      }
      list_customer_contacts: {
        Args: {
          p_company_id: string
          p_customer_id: string
          p_limit?: number
          p_page_key?: string
        }
        Returns: Json
      }
      list_customer_follow_ups: {
        Args: {
          p_company_id: string
          p_filter?: string
          p_limit?: number
          p_page_key?: string
        }
        Returns: Json
      }
      list_deal_contract_signings: {
        Args: { p_company_id: string; p_deal_id: string }
        Returns: Json
      }
      list_deal_contracts: {
        Args: {
          p_before_draft_version?: number
          p_company_id: string
          p_deal_id: string
        }
        Returns: Json
      }
      list_deal_offer_reviews: {
        Args: { p_company_id: string; p_deal_id: string }
        Returns: Json
      }
      list_deal_trade_ins: {
        Args: {
          p_before_version?: number
          p_company_id: string
          p_deal_id: string
          p_limit?: number
        }
        Returns: Json
      }
      list_direct_deal_template_selection: {
        Args: {
          p_before_template_id: string
          p_company_id: string
          p_search: string
        }
        Returns: Json
      }
      list_finance_history: {
        Args: { p_before?: string; p_company_id: string; p_limit?: number }
        Returns: Json
      }
      list_my_company_invitations: {
        Args: { p_limit?: number; p_page_key?: string }
        Returns: Json
      }
      list_my_contract_signings: {
        Args: { p_before_id?: string }
        Returns: Json
      }
      list_my_offer_reviews: {
        Args: { p_limit?: number; p_page_key?: string }
        Returns: Json
      }
      list_pdf_template_selection: {
        Args: {
          p_before_template_id: string
          p_company_id: string
          p_search: string
        }
        Returns: Json
      }
      list_pdf_template_versions: {
        Args: { p_company_id: string }
        Returns: Json
      }
      list_platform_account_memberships: {
        Args: { p_limit?: number; p_page_key?: string; p_user_id: string }
        Returns: Json
      }
      list_platform_accounts: {
        Args: { p_filter?: string; p_limit?: number; p_page_key?: string }
        Returns: Json
      }
      list_platform_companies: {
        Args: { p_limit?: number; p_page_key?: string; p_search?: string }
        Returns: Json
      }
      list_platform_company_members: {
        Args: { p_company_id: string; p_limit?: number; p_page_key?: string }
        Returns: Json
      }
      list_platform_contact_requests: {
        Args: { p_limit?: number; p_page_key?: string }
        Returns: Json
      }
      list_stock_purchase_conditions: {
        Args: {
          p_before_version?: number
          p_company_id: string
          p_limit?: number
          p_stock_id: string
        }
        Returns: Json
      }
      list_uploaded_pdf_signings: {
        Args: { p_company_id: string; p_deal_id: string }
        Returns: Json
      }
      list_vehicle_photos: {
        Args: {
          p_company_id: string
          p_limit?: number
          p_page_key?: string
          p_stock_id: string
        }
        Returns: Json
      }
      lock_advertising_billing_period: {
        Args: {
          p_company_id: string
          p_expected_review_token: string
          p_month: string
          p_partial_coverage_acknowledged: boolean
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      lookup_advertising_payment: {
        Args: {
          p_company_id: string
          p_invoice_id: string
          p_payment_identifier: string
        }
        Returns: Json
      }
      mark_expired_signing_dispatch: {
        Args: { p_expected_version: number; p_job_id: string }
        Returns: Json
      }
      mark_vehicle_advertisement_ready: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_listing_id: string
          p_request_id: string
        }
        Returns: Json
      }
      mutate_deal_archive: {
        Args: { p_company_id: string; p_deal_id: string; p_input: Json }
        Returns: Json
      }
      mutate_deal_delete: {
        Args: { p_company_id: string; p_deal_id: string; p_input: Json }
        Returns: Json
      }
      mutate_deal_fulfilment: {
        Args: { p_company_id: string; p_deal_id: string; p_input: Json }
        Returns: Json
      }
      prepare_company_store_export: {
        Args: {
          p_acknowledged: boolean
          p_attestation_version: string
          p_channel: string
          p_company_id: string
          p_expected_source_sha256: string
          p_expected_version: number
          p_purpose: string
          p_request_id: string
        }
        Returns: Json
      }
      prepare_customer_contract_invitation: {
        Args: { p_email_id: string; p_lease_id: string }
        Returns: Json
      }
      prepare_direct_deal: {
        Args: {
          p_company_id: string
          p_customer: Json
          p_customer_id: string
          p_deal_id: string
          p_expected_customer_version: number
          p_expected_template_approval_version: number
          p_price_ore: number
          p_request_id: string
          p_stock_item_id: string
          p_template_version_id: string
        }
        Returns: Json
      }
      prepare_direct_deal_with_trade_in: {
        Args: {
          p_company_id: string
          p_customer: Json
          p_customer_id: string
          p_deal_id: string
          p_expected_customer_version: number
          p_expected_template_approval_version: number
          p_expected_trade_in_version: number
          p_price_ore: number
          p_request_id: string
          p_stock_item_id: string
          p_template_version_id: string
          p_trade_in_id: string
        }
        Returns: Json
      }
      prepare_paper_sale: {
        Args: {
          p_buyer: Json
          p_company_id: string
          p_customer_id: string
          p_deal_id: string
          p_note: string
          p_paper_reference: string
          p_price_ore: number
          p_request_id: string
          p_signed_on: string
          p_stock_item_id: string
        }
        Returns: Json
      }
      prepare_pdf_template_document: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_deal_id: string
          p_request_id: string
          p_template_version_id: string
        }
        Returns: Json
      }
      prepare_platform_application_invitation: {
        Args: {
          p_application_id: string
          p_expected_version: number
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      prepare_signing_job: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_document_id: string
          p_document_version: number
          p_expected_template_sha256: string
          p_expected_template_version: number
          p_idempotency_key: string
          p_signers: Json
          p_source_sha256: string
          p_template_id: number
        }
        Returns: Json
      }
      publish_company_public_store: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_expected_version: number
          p_listings: Json
          p_profile_version: number
          p_request_id: string
          p_slug: string
        }
        Returns: Json
      }
      publish_offer_review: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_offer_id: string
          p_request_id: string
        }
        Returns: Json
      }
      queue_advertising_invoice_email: {
        Args: {
          p_company_id: string
          p_document_id: string
          p_document_kind: string
          p_expected_document_source_hash: string
          p_expected_review_token: string
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      reconcile_advertising_billing: {
        Args: {
          p_channel: string
          p_company_id: string
          p_expected_review_token: string
          p_month: string
          p_reason: string
          p_request_id: string
          p_review_acknowledged: boolean
          p_unit_price_ore: string
        }
        Returns: Json
      }
      record_blocket_delivery: {
        Args: {
          p_claim_token: string
          p_delivery_id: string
          p_evidence_sha256: string
          p_expected_version: number
          p_job_id: string
          p_provider_ad_id: string
          p_provider_request_id: string
          p_status: string
        }
        Returns: Json
      }
      record_trade_in_acquisition: {
        Args: {
          p_acknowledged: boolean
          p_acquired_on: string
          p_asking_price_ore: number
          p_attestation_version: string
          p_company_id: string
          p_deal_id: string
          p_debt_confirmed: boolean
          p_debt_confirmed_on: string
          p_debt_confirmed_ore: number
          p_debt_evidence_reference: string
          p_expected_source_sha256: string
          p_fuel: string
          p_gearbox: string
          p_purchase_agreement_reference: string
          p_purchase_confirmed: boolean
          p_received_confirmed: boolean
          p_request_id: string
        }
        Returns: Json
      }
      refresh_advertising_dispatcher: {
        Args: {
          p_available_until: string
          p_channel: string
          p_dispatcher_id: string
        }
        Returns: Json
      }
      register_advertising_payment: {
        Args: {
          p_amount_ore: string
          p_bank_reference: string
          p_booked_date: string
          p_company_id: string
          p_expected_invoice_source_hash: string
          p_expected_replaced_entry_hash: string
          p_expected_review_token: string
          p_invoice_id: string
          p_payment_identifier: string
          p_reason: string
          p_replaces_entry_id: string
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      register_contract_signing_archive: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_document_content_sha256: string
          p_evidence_bytes: number
          p_evidence_sha256: string
          p_pdf_bytes: number
          p_pdf_sha256: string
          p_renderer_version: string
          p_request_id: string
          p_revision: number
          p_signing_id: string
        }
        Returns: Json
      }
      register_offer_document_archive: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_object_path: string
          p_offer_id: string
          p_offer_version: number
          p_pdf_sha256: string
          p_snapshot_sha256: string
          p_submission_id: string
        }
        Returns: Json
      }
      register_pdf_template_asset: {
        Args: {
          p_actor_id: string
          p_asset_id: string
          p_byte_size: number
          p_company_id: string
          p_filename: string
          p_pages: Json
          p_sha256: string
        }
        Returns: Json
      }
      register_pdf_template_document: {
        Args: {
          p_actor_id: string
          p_byte_size: number
          p_company_id: string
          p_page_count: number
          p_sha256: string
          p_source_id: string
        }
        Returns: Json
      }
      register_signing_document_version: {
        Args: {
          p_actor_user_id: string
          p_approved_signers: Json
          p_approved_template_id: number
          p_approved_template_sha256: string
          p_approved_template_version: number
          p_company_id: string
          p_document_id: string
          p_document_version: number
          p_source_object_path: string
          p_source_sha256: string
        }
        Returns: Json
      }
      register_signing_template: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_document_kind: string
          p_template_id: number
          p_template_sha256: string
          p_template_version: number
        }
        Returns: Json
      }
      register_uploaded_pdf_source: {
        Args: {
          p_actor_id: string
          p_byte_size: number
          p_company_id: string
          p_deal_id: string
          p_filename: string
          p_page_count: number
          p_sha256: string
          p_source_id: string
        }
        Returns: Json
      }
      register_vehicle_photo: {
        Args: {
          p_company_id: string
          p_content_type: string
          p_object_path: string
          p_photo_id: string
          p_request_id: string
          p_size_bytes: number
          p_stock_id: string
        }
        Returns: Json
      }
      release_reservation: {
        Args: { company: string; deal: string }
        Returns: undefined
      }
      release_reservation_checked: {
        Args: { company: string; deal: string; expected_reservation: string }
        Returns: undefined
      }
      renew_customer_document_link: {
        Args: {
          p_allow_create?: boolean
          p_company_id: string
          p_deal_id: string
          p_document_hash: string
          p_document_version: number
          p_expected_email_id: string
          p_expected_generation: number
          p_expected_invitation_id: string
          p_kind: string
          p_reason: string
          p_recipient_email: string
          p_reference_id: string
          p_request_id: string
          p_review_token: string
        }
        Returns: Json
      }
      renew_guest_document_invitation: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_expected_document_hash: string
          p_expected_email_id: string
          p_expected_generation: number
          p_kind: string
          p_reference_id: string
          p_request_id: string
        }
        Returns: Json
      }
      renew_platform_application_invitation: {
        Args: {
          p_expected_delivery_id: string
          p_expected_version: number
          p_invitation_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      reprepare_platform_application_invitation: {
        Args: {
          p_expected_application_version: number
          p_expected_version: number
          p_invitation_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      request_advertising_connection: {
        Args: {
          p_account_reference: string
          p_channel: string
          p_company_id: string
          p_request_id: string
        }
        Returns: Json
      }
      request_company_ownership_transfer: {
        Args: {
          p_acknowledged: boolean
          p_attestation_version: string
          p_company_id: string
          p_expected_owner_version: number
          p_expected_target_version: number
          p_expected_team_version: number
          p_reason: string
          p_request_id: string
          p_target_membership_id: string
        }
        Returns: Json
      }
      request_contract_signing: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_deal_id: string
          p_draft_id: string
          p_request_id: string
        }
        Returns: Json
      }
      request_uploaded_pdf_signing: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_document_hash: string
          p_full_name: string
          p_request_id: string
          p_source_id: string
        }
        Returns: Json
      }
      reserve_blocket_preparation: {
        Args: {
          p_expected_job_version: number
          p_job_id: string
          p_token: string
        }
        Returns: Json
      }
      reserve_vehicle: {
        Args: { company: string; deal: string; hours?: number }
        Returns: string
      }
      resolve_advertising_program_request: {
        Args: { p_company: string; p_request_id: string }
        Returns: Json
      }
      respond_guest_offer: {
        Args: {
          p_ack_version: string
          p_acknowledged: boolean
          p_decision: string
          p_expected_version: number
          p_full_name: string
          p_invitation_id: string
          p_reason: string
          p_request_id: string
          p_token_hash: string
        }
        Returns: Json
      }
      respond_offer_review: {
        Args: {
          p_ack_version: string
          p_decision: string
          p_expected_version: number
          p_reason: string
          p_request_id: string
          p_responder_name: string
          p_review_id: string
        }
        Returns: Json
      }
      reverse_advertising_payment: {
        Args: {
          p_company_id: string
          p_entry_id: string
          p_expected_invoice_source_hash: string
          p_expected_review_token: string
          p_invoice_id: string
          p_reason: string
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      review_advertising_store_fee: {
        Args: {
          p_amount_ore: string
          p_amount_override_acknowledged?: boolean
          p_company_id: string
          p_expected_program_review_token?: string
          p_month: string
          p_period_id: string
          p_program_version: number
          p_reason: string
          p_request_id: string
          p_review_acknowledged: boolean
          p_service_date: string
          p_store_id: string
        }
        Returns: Json
      }
      review_contract_template: {
        Args: {
          p_company_id: string
          p_expected_approval_version: number
          p_reason: string
          p_request_id: string
          p_status: string
          p_template_version_id: string
        }
        Returns: Json
      }
      revoke_company_invitation: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_invitation_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      save_advertising_buyer_profile: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_fields: Json
          p_request_id: string
        }
        Returns: Json
      }
      save_advertising_channel_rate: {
        Args: {
          p_channel: string
          p_company_id: string
          p_expected_version: number
          p_request_id: string
          p_unit_price_ore: string
        }
        Returns: Json
      }
      save_advertising_financial_settings: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_fields: Json
          p_request_id: string
          p_review_acknowledged: boolean
        }
        Returns: Json
      }
      save_advertising_job: {
        Args: {
          p_claim_token: string
          p_error_code?: string
          p_expected_version: number
          p_job_id: string
          p_provider_ad_id?: string
          p_provider_url?: string
          p_status: string
        }
        Returns: Json
      }
      save_advertising_program: {
        Args: { p_company: string; p_input: Json; p_store: string }
        Returns: string
      }
      save_advertising_program_request: {
        Args: {
          p_company: string
          p_input: Json
          p_request_id: string
          p_store: string
        }
        Returns: Json
      }
      save_advertising_seller_profile: {
        Args: {
          p_expected_version: number
          p_fields: Json
          p_request_id: string
        }
        Returns: Json
      }
      save_company_branch: {
        Args: {
          p_acknowledged: boolean
          p_branch_id: string
          p_company_id: string
          p_expected_version: number
          p_fields: Json
          p_request_id: string
        }
        Returns: Json
      }
      save_company_store_profile: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_expected_version: number
          p_fields: Json
          p_request_id: string
        }
        Returns: Json
      }
      save_pdf_template_version: {
        Args: {
          p_acknowledged: boolean
          p_asset_id: string
          p_company_id: string
          p_expected_version: number
          p_fields: Json
          p_request_id: string
          p_template_id: string
          p_title: string
        }
        Returns: Json
      }
      save_platform_advertising_buyer_profile: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_fields: Json
          p_request_id: string
        }
        Returns: Json
      }
      save_signing_job: {
        Args: {
          p_claim_token: string
          p_error_code?: string
          p_expected_version: number
          p_job_id: string
          p_snapshot: Json
        }
        Returns: Json
      }
      save_vehicle_advertisement: {
        Args: {
          p_company_id: string
          p_description: string
          p_expected_version: number
          p_include_registration_number: boolean
          p_listing_id: string
          p_photo_ids: string[]
          p_request_id: string
          p_stock_id: string
          p_title: string
        }
        Returns: Json
      }
      save_vehicle_calculation_metadata: {
        Args: {
          p_company_id: string
          p_cost_vat: Json
          p_expected_version: string
          p_purchase_vat_ore: string
          p_stock_item_id: string
          p_vat_basis_confirmed: boolean
        }
        Returns: Json
      }
      search_platform_accounts: {
        Args: {
          p_cursor?: Json
          p_filter?: string
          p_limit?: number
          p_query?: string
        }
        Returns: Json
      }
      send_vehicle_advertisement: {
        Args: {
          p_channels: string[]
          p_company_id: string
          p_expected_version: number
          p_listing_id: string
          p_request_id: string
        }
        Returns: Json
      }
      send_vehicle_advertisement_priced: {
        Args: {
          p_channels: string[]
          p_company_id: string
          p_expected_quote_token: string
          p_expected_version: number
          p_listing_id: string
          p_request_id: string
        }
        Returns: Json
      }
      set_company_branch_status: {
        Args: {
          p_acknowledged: boolean
          p_branch_id: string
          p_company_id: string
          p_expected_version: number
          p_reason: string
          p_request_id: string
          p_status: string
        }
        Returns: Json
      }
      set_platform_account_access: {
        Args: {
          p_expected_version: number
          p_reason: string
          p_request_id: string
          p_status: string
          p_user_id: string
        }
        Returns: Json
      }
      set_platform_company_status: {
        Args: {
          p_company_id: string
          p_expected_status: string
          p_reason: string
          p_request_id: string
          p_status: string
        }
        Returns: Json
      }
      set_platform_web_application_status: {
        Args: {
          p_application_id: string
          p_expected_version: number
          p_reason: string
          p_request_id: string
          p_status: string
        }
        Returns: Json
      }
      sign_contract: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_consent_version: string
          p_document_hash: string
          p_expected_revision: number
          p_full_name: string
          p_request_id: string
          p_signing_id: string
          p_strokes: Json
        }
        Returns: Json
      }
      sign_guest_contract: {
        Args: {
          p_acknowledged: boolean
          p_consent_version: string
          p_document_hash: string
          p_expected_revision: number
          p_full_name: string
          p_invitation_id: string
          p_request_id: string
          p_strokes: Json
          p_token_hash: string
        }
        Returns: Json
      }
      sign_uploaded_pdf_guest: {
        Args: {
          p_acknowledged: boolean
          p_document_hash: string
          p_full_name: string
          p_request_id: string
          p_source_id: string
          p_token_sha256: string
        }
        Returns: Json
      }
      stock_import_duplicate_registrations: {
        Args: { company: string; registrations: string[] }
        Returns: string[]
      }
      submit_demo_request: {
        Args: {
          company_name: string
          contact_email: string
          contact_message?: string
          contact_name: string
          contact_phone?: string
        }
        Returns: undefined
      }
      submit_web_application: {
        Args: {
          p_company: string
          p_email: string
          p_message: string
          p_name: string
          p_organisation_number: string
          p_phone: string
          p_privacy_acknowledged: boolean
          p_privacy_version: string
          p_request_id: string
          p_seeking: string[]
        }
        Returns: Json
      }
      unpublish_company_public_store: {
        Args: {
          p_acknowledged: boolean
          p_company_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: Json
      }
      update_company_team_member: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_membership_id: string
          p_reason: string
          p_request_id: string
          p_role: string
          p_status: string
        }
        Returns: Json
      }
      update_customer_follow_up: {
        Args: {
          p_company_id: string
          p_contact_id: string
          p_customer_id: string
          p_expected_version: number
          p_reason: string
          p_request_id: string
          p_status: string
        }
        Returns: Json
      }
      update_platform_company_member: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_membership_id: string
          p_reason: string
          p_request_id: string
          p_role: string
          p_status: string
        }
        Returns: Json
      }
      withdraw_offer_review: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_expected_version: number
          p_reason: string
          p_request_id: string
          p_review_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type RpcArgumentCompatibility = {
  // SQL explicitly accepts no linked deal/term for a standalone finance intake.
  create_finance_intake_request: { p_deal_id: string | null; p_term_months: number | null }
  // A null store creates a new advertiser store in the reviewed program request.
  save_advertising_program_request: { p_store: string | null }
  create_customer_contact: { p_follow_up_on: string | null }
  create_offer_version_with_trade_in: {
    trade_in_id: string | null
    expected_trade_in_version: number | null
    expected_sale_price_ore: number | string
  }
  create_purchase_condition_version: {
    p_expected_purchase_price_ore: number | string
    p_expected_calculation_version: number | string
    p_supplier_organisation_number: string | null
    p_document_reference: string | null
    p_repair_estimate_ore: number | string | null
  }
  create_trade_in_version: {
    p_expected_sale_price_ore: number | string
    p_value_ore: number | string
    p_debt_ore: number | string | null
    p_lender_name: string | null
  }
  dealer_register_page: { p_selected_id: string | null }
  finish_transactional_email: { p_provider_id: string | null }
  get_contract_signing: { p_company_id: string | null }
  get_contract_signing_archive: { p_company_id: string | null }
  list_advertising_stock: { p_page_key: string | null }
  list_company_advertising: {
    p_page_key: string | null
    p_jobs_page_key: string | null
  }
  list_company_team: {
    p_members_page_key: string | null
    p_invitations_page_key: string | null
  }
  list_contract_templates: {
    p_before_template_id: string | null
    p_template_id: string | null
  }
  list_customer_contacts: { p_page_key: string | null }
  list_customer_follow_ups: { p_page_key: string | null }
  list_deal_contracts: { p_before_draft_version: number | null }
  list_deal_trade_ins: { p_before_version: number | null }
  list_my_company_invitations: { p_page_key: string | null }
  list_my_contract_signings: { p_before_id: string | null }
  list_my_offer_reviews: { p_page_key: string | null }
  list_platform_accounts: { p_page_key: string | null }
  list_platform_companies: { p_page_key: string | null }
  list_platform_contact_requests: { p_page_key: string | null }
  list_stock_purchase_conditions: { p_before_version: number | null }
  list_vehicle_photos: { p_page_key: string | null }
  record_trade_in_acquisition: {
    p_debt_confirmed_ore: number | string
    p_asking_price_ore: number | string
  }
  respond_offer_review: { p_reason: string | null }
  save_vehicle_calculation_metadata: { p_purchase_vat_ore: string | null }
  sign_contract: { p_company_id: string | null }
}

type GeneratedFunctions = GeneratedDatabase["public"]["Functions"]
type PatchRpcArguments<Arguments, Patch> = {
  // A homomorphic mapped type preserves the generator's optional argument flags.
  [Key in keyof Arguments]: Key extends keyof Patch ? Patch[Key] : Arguments[Key]
}
type CompatibleFunctions = {
  [Name in keyof GeneratedFunctions]: Omit<GeneratedFunctions[Name], "Args"> & {
    Args: [GeneratedFunctions[Name]["Args"]] extends [never]
      ? Record<string, never>
      : Name extends keyof RpcArgumentCompatibility
        ? PatchRpcArguments<GeneratedFunctions[Name]["Args"], RpcArgumentCompatibility[Name]>
        : GeneratedFunctions[Name]["Args"]
  }
}

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Functions"> & {
    Functions: CompatibleFunctions
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
