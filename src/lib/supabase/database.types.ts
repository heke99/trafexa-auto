export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          organisation_number: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organisation_number?: string
          status?: string
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
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role: string
          status?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: string
          status?: string
          user_id?: string
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
          company_id: string
          created_at: string
          currency: string
          id: string
          purchase_price_ore: number
          status: string
          vat_scheme: string
          vehicle_id: string
        }
        Insert: {
          acquired_on?: string
          asking_price_ore: number
          company_id: string
          created_at?: string
          currency?: string
          id?: string
          purchase_price_ore: number
          status?: string
          vat_scheme: string
          vehicle_id: string
        }
        Update: {
          acquired_on?: string
          asking_price_ore?: number
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          purchase_price_ore?: number
          status?: string
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
      create_company: {
        Args: { company_name: string; org_number: string }
        Returns: string
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
      import_stock_batch: {
        Args: { company: string; payload: Json; submission: string }
        Returns: number
      }
      release_reservation: {
        Args: { company: string; deal: string }
        Returns: undefined
      }
      reserve_vehicle: {
        Args: { company: string; deal: string; hours?: number }
        Returns: string
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
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
