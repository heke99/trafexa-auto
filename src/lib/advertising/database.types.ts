import type { Database, Json } from '@/lib/supabase/database.types';

type AdvertisingFunctions = {
  get_platform_advertising_credit_page: { Args: { p_company_id: string; p_original_invoice_id: string }; Returns: Json };
  list_advertising_credit_page: { Args: { p_company_id: string; p_original_invoice_id: string }; Returns: Json };
  get_platform_advertising_credit_invoice: { Args: { p_company_id: string; p_id: string }; Returns: Json };
  get_advertising_credit_invoice: { Args: { p_company_id: string; p_id: string }; Returns: Json };
  configure_advertising_credit_series: { Args: { p_company_id: string; p_original_invoice_id: string; p_expected_original_source_hash: string; p_year: number; p_prefix: string; p_first_number: string; p_seller_registered_seat: string; p_reason: string; p_review_acknowledged: boolean; p_request_id: string }; Returns: Json };
  issue_advertising_credit_invoice: { Args: { p_company_id: string; p_original_invoice_id: string; p_expected_original_source_hash: string; p_expected_series_id: string; p_expected_series_review_token: string; p_expected_review_token: string; p_reason: string; p_review_acknowledged: boolean; p_request_id: string }; Returns: Json };

  list_company_advertising: { Args: { p_company_id: string; p_page_key: string | null; p_jobs_page_key: string | null; p_limit: number }; Returns: Json };
  list_advertising_stock: { Args: { p_company_id: string; p_page_key: string | null; p_limit: number }; Returns: Json };
  get_stock_advertising: { Args: { p_company_id: string; p_stock_id: string }; Returns: Json };
  save_vehicle_advertisement: { Args: { p_company_id: string; p_stock_id: string; p_listing_id: string; p_expected_version: number; p_title: string; p_description: string; p_photo_ids: string[]; p_include_registration_number: boolean; p_request_id: string }; Returns: Json };
  mark_vehicle_advertisement_ready: { Args: { p_company_id: string; p_listing_id: string; p_expected_version: number; p_request_id: string }; Returns: Json };
  send_vehicle_advertisement: { Args: { p_company_id: string; p_listing_id: string; p_expected_version: number; p_channels: string[]; p_request_id: string }; Returns: Json };
  get_advertising_send_quote: { Args: { p_company_id: string; p_listing_id: string; p_expected_version: number; p_channels: string[] }; Returns: Json };
  send_vehicle_advertisement_priced: { Args: { p_company_id: string; p_listing_id: string; p_expected_version: number; p_channels: string[]; p_request_id: string; p_expected_quote_token: string }; Returns: Json };
  request_advertising_connection: { Args: { p_company_id: string; p_channel: string; p_account_reference: string; p_request_id: string }; Returns: Json };
};
export type AdvertisingDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & AdvertisingFunctions };
};
export type AdvertisingRole = 'owner' | 'admin' | 'sales' | 'finance' | 'viewer';
export type AdvertisingChannel = 'blocket' | 'wayke';
export type AdvertisingPhoto = { id: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp'; sizeBytes: number; version: number; status: 'active' | 'archived'; createdAt: string };
export type AdvertisingSnapshot = { title: string; description: string; priceGrossOre: string; make: string; model: string; year: number; mileageKm: number; fuel: string; transmission: string; photos: AdvertisingPhoto[]; includeRegistrationNumber: boolean; registrationNumber: string | null };
export type AdvertisingListing = { id: string; companyId: string; stockId: string; version: number; status: 'draft' | 'ready'; snapshot: AdvertisingSnapshot; createdAt: string; updatedAt: string };
export type AdvertisingJobStatus = 'queued' | 'dispatching' | 'outcome_unknown' | 'submitted' | 'published' | 'rejected' | 'retryable';
export type AdvertisingJob = { id: string; companyId: string; stockId: string; listingId: string; listingVersion: number; channel: AdvertisingChannel; status: AdvertisingJobStatus; version: number; providerAdId: string | null; providerUrl: string | null; snapshot: AdvertisingSnapshot; createdAt: string; updatedAt: string };
export type AdvertisingConnection = { channel: AdvertisingChannel; status: 'disconnected' | 'requested' | 'verified'; accountReference: string | null; dispatcherAvailable: boolean };
export type AdvertisingStock = { id: string; make: string; model: string; year: number; priceGrossOre: string; status: 'available' | 'reserved' | 'sold' };
export type AdvertisingScope = { companyId: string; actorUserId: string; actorRole: AdvertisingRole };
export type AdvertisingWorkspacePage = AdvertisingScope & { listings: AdvertisingListing[]; jobs: AdvertisingJob[]; channels: AdvertisingConnection[]; nextPageKey: string | null; nextJobsPageKey: string | null };
export type AdvertisingStockPage = AdvertisingScope & { stock: AdvertisingStock[]; nextPageKey: string | null };
export type StockAdvertisingDetails = AdvertisingScope & { listing: AdvertisingListing | null; jobs: AdvertisingJob[]; channels: AdvertisingConnection[] };
export type AdvertisingListingReceipt = { listing: AdvertisingListing };
export type AdvertisingSendQuoteItem = { channel: AdvertisingChannel; rateId: string | null; rateVersion: number | null; unitPriceOre: string | null; chargeOre: string | null; alreadyPublished: boolean; publicationId: string | null };
export type AdvertisingSendQuote = { companyId: string; actorUserId: string; listingId: string; listingVersion: number; channels: AdvertisingChannel[]; currency: 'SEK'; taxBasis: 'exclusive'; billingUnit: 'unique_publication'; items: AdvertisingSendQuoteItem[]; totalOre: string | null; reviewToken: string };
export type AdvertisingSendReceipt = { status: 'queued'; jobs: AdvertisingJob[]; listing: AdvertisingListing; quote: AdvertisingSendQuote };
export type AdvertisingResult<T> = ({ ok: true } & T) | { ok: false; code: 'unauthenticated' | 'access_denied' | 'invalid_input' | 'conflict' | 'not_found' | 'connection_required' | 'unavailable'; message: string };
