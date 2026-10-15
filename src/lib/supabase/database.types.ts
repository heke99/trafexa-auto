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
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "activities_company_id_deal_id_fkey"
            columns: ["company_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
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
            isOneToOne: false
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
          created_at: string
          email: string | null
          id: string
          kind: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          company_id: string
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
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dealer_approvals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_company_id_stock_item_id_fkey"
            columns: ["company_id", "stock_item_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "finance_applications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_applications_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          company_id: string
          created_at: string
          deal_id: string
          id: string
          snapshot: Json
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          deal_id: string
          id?: string
          snapshot: Json
          version: number
        }
        Update: {
          company_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "offers_company_id_deal_id_fkey"
            columns: ["company_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "offers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "reservations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_company_id_stock_item_id_fkey"
            columns: ["company_id", "stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["company_id", "id"]
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
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_items_company_id_vehicle_id_fkey"
            columns: ["company_id", "vehicle_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_costs_company_id_stock_item_id_fkey"
            columns: ["company_id", "stock_item_id"]
            isOneToOne: false
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
            isOneToOne: false
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
      archive_vehicle_photo: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_photo_id: string
          p_request_id: string
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
      check_transactional_email_lease: {
        Args: { p_id: string; p_lease_id: string }
        Returns: boolean
      }
      claim_advertising_job: {
        Args: {
          p_claim_token: string
          p_expected_version: number
          p_job_id: string
        }
        Returns: Json
      }
      claim_platform_admin_access: { Args: never; Returns: Json }
      claim_transactional_email: {
        Args: { p_kind?: string; p_reference?: string }
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
      create_deal: {
        Args: {
          company: string
          customer: string
          price_ore: number
          stock: string
        }
        Returns: string
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
      finish_transactional_email: {
        Args: {
          p_id: string
          p_lease_id: string
          p_provider_id?: string
          p_status: string
        }
        Returns: boolean
      }
      get_account_access: { Args: never; Returns: Json }
      get_advertising_financial_assessment: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_advertising_invoice_draft: {
        Args: { p_company_id: string; p_id: string }
        Returns: Json
      }
      get_advertising_job: { Args: { p_job_id: string }; Returns: Json }
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
      get_platform_admin_session: { Args: never; Returns: Json }
      get_platform_advertising_billing: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      get_platform_advertising_corrections: {
        Args: { p_company_id: string; p_month: string }
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
      get_platform_advertising_invoice_draft: {
        Args: { p_company_id: string; p_id: string }
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
      get_platform_advertising_quantities: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      get_platform_advertising_usage: {
        Args: { p_company_id: string; p_month: string }
        Returns: Json
      }
      get_platform_overview: { Args: never; Returns: Json }
      get_platform_web_application: {
        Args: { p_application_id: string }
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
      get_transactional_email_status: { Args: never; Returns: Json }
      get_vehicle_calculation: {
        Args: { p_company_id: string; p_stock_item_id: string }
        Returns: Json
      }
      get_vehicle_photo: {
        Args: { p_company_id: string; p_photo_id: string }
        Returns: Json
      }
      import_stock_batch: {
        Args: { company: string; payload: Json; submission: string }
        Returns: number
      }
      inventory_dashboard_totals: {
        Args: { p_company_id: string }
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
      list_advertising_financial_page: {
        Args: {
          p_before_version?: number
          p_company_id: string
          p_draft_id?: string
          p_month: string
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
      list_platform_accounts: {
        Args: { p_filter?: string; p_limit?: number; p_page_key?: string }
        Returns: Json
      }
      list_platform_companies: {
        Args: { p_limit?: number; p_page_key?: string; p_search?: string }
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
      mark_vehicle_advertisement_ready: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_listing_id: string
          p_request_id: string
        }
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
      publish_offer_review: {
        Args: {
          p_company_id: string
          p_deal_id: string
          p_offer_id: string
          p_request_id: string
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
      request_advertising_connection: {
        Args: {
          p_account_reference: string
          p_channel: string
          p_company_id: string
          p_request_id: string
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
      reserve_vehicle: {
        Args: { company: string; deal: string; hours?: number }
        Returns: string
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
      save_advertising_seller_profile: {
        Args: {
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
      save_platform_advertising_buyer_profile: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_fields: Json
          p_request_id: string
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

/**
 * PostgreSQL argument metadata does not describe nullable arguments, and the
 * generator represents bigint inputs as number. Existing feature contracts use
 * explicit null for absent cursors/optional values and decimal strings for exact
 * bigint values. Preserve those verified SQL contracts without changing the raw
 * schema, table rows, relationships, return types or the application's callers.
 *
 * Feature databases intersect their RPC contracts with Database. These patches
 * prevent those intersections from removing null or reducing bigint inputs to
 * number & string (never). New generated RPCs remain available automatically.
 */
type RpcArgumentCompatibility = {
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
