import type { Database, Json } from '@/lib/supabase/database.types';

export const PHOTO_BUCKET = 'ads-vehicle-photos';
export const MAX_PHOTO_BYTES = 10485760;
export type PhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type VehiclePhoto = { id: string; companyId: string; stockId: string; contentType: PhotoContentType; sizeBytes: number; version: number; status: 'active' | 'archived'; createdAt: string };
export type StoredVehiclePhoto = VehiclePhoto & { objectPath: string; storageBucket: typeof PHOTO_BUCKET; storageVisibility: 'private' };
export type PhotoResult<T> = ({ ok: true } & T) | { ok: false; code: 'access_denied' | 'invalid_input' | 'conflict' | 'unavailable'; message: string };
type Functions = {
  list_vehicle_photos: { Args: { p_company_id: string; p_stock_id: string; p_page_key: string | null; p_limit: number }; Returns: Json };
  get_vehicle_photo: { Args: { p_company_id: string; p_photo_id: string }; Returns: Json };
  register_vehicle_photo: { Args: { p_company_id: string; p_stock_id: string; p_photo_id: string; p_object_path: string; p_content_type: string; p_size_bytes: number; p_request_id: string }; Returns: Json };
  archive_vehicle_photo: { Args: { p_company_id: string; p_photo_id: string; p_expected_version: number; p_request_id: string }; Returns: Json };
};
export type PhotoDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & Functions } };
