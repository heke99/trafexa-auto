import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveCompanyContext } from '@/lib/data/company-context';
import { PHOTO_BUCKET, MAX_PHOTO_BYTES, type PhotoDatabase, type StoredVehiclePhoto, type VehiclePhoto } from './types';

export class PhotoError extends Error {
  constructor(readonly code: 'access_denied' | 'invalid_input' | 'conflict' | 'unavailable') { super('Bilden kunde inte verifieras.'); }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function photoUuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new PhotoError('invalid_input'); return value.toLowerCase(); }
export function photoObject(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PhotoError('unavailable'); return value as Record<string, unknown>; }
export function photoInput(value: unknown, keys: string[]) { const row = photoObject(value); if (Object.keys(row).some(key => !keys.includes(key))) throw new PhotoError('invalid_input'); return row; }
export async function requirePhotoContext(expectedCompany?: string, write = false) {
  try {
    const current = await getActiveCompanyContext();
    const db = current.db as unknown as SupabaseClient<PhotoDatabase>;
    const { data, error } = await db.auth.getUser();
    const user = data?.user;
    if (error || !user || user.id !== current.user || user.is_anonymous || !user.email || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at)) || !UUID.test(user.id)) throw new PhotoError('access_denied');
    const company = photoUuid(current.company);
    if (expectedCompany && photoUuid(expectedCompany) !== company) throw new PhotoError('access_denied');
    const membership = await deadline(db.from('memberships').select('company_id,user_id,role,status,companies!inner(id,status)')
      .eq('company_id', company).eq('user_id', user.id).eq('status', 'active').eq('companies.status', 'active').maybeSingle());
    const member = membership.data;
    const organization = member?.companies as unknown as { id?: unknown; status?: unknown };
    if (membership.error || !member || member.company_id !== company || member.user_id !== user.id || member.status !== 'active' || organization?.id !== company || organization.status !== 'active' || !['owner', 'admin', 'sales', 'finance', 'viewer'].includes(member.role) || write && !['owner', 'admin', 'sales'].includes(member.role)) throw new PhotoError('access_denied');
    return { db, company, userId: user.id, role: member.role };
  } catch (error) { if (error instanceof PhotoError) throw error; throw new PhotoError('access_denied'); }
}
export function parseStoredPhoto(value: unknown, companyId: string, photoId?: string, stockId?: string): StoredVehiclePhoto {
  const row = photoObject(value);
  const id = photoUuid(row.id), actualCompany = photoUuid(row.companyId), actualStock = photoUuid(row.stockId);
  if (actualCompany !== companyId || photoId && photoId !== id || stockId && stockId !== actualStock || row.storageBucket !== PHOTO_BUCKET || row.storageVisibility !== 'private') throw new PhotoError('unavailable');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(row.contentType)) || !['active', 'archived'].includes(String(row.status)) || typeof row.sizeBytes !== 'number' || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 1 || row.sizeBytes > MAX_PHOTO_BYTES || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw new PhotoError('unavailable');
  const suffix = row.contentType === 'image/jpeg' ? 'jpg' : row.contentType === 'image/png' ? 'png' : 'webp';
  if (row.objectPath !== `${actualCompany}/${actualStock}/${id}.${suffix}`) throw new PhotoError('unavailable');
  return { id, companyId: actualCompany, stockId: actualStock, objectPath: row.objectPath as string, storageBucket: PHOTO_BUCKET, storageVisibility: 'private', contentType: row.contentType as StoredVehiclePhoto['contentType'], sizeBytes: row.sizeBytes, version: row.version, status: row.status as StoredVehiclePhoto['status'], createdAt: row.createdAt };
}
export function publicPhoto(photo: StoredVehiclePhoto): VehiclePhoto { const { objectPath: _path, storageBucket: _bucket, storageVisibility: _visibility, ...safe } = photo; return safe; }
export async function getStoredPhoto(context: Awaited<ReturnType<typeof requirePhotoContext>>, id: string) {
  const result = await deadline(context.db.rpc('get_vehicle_photo', { p_company_id: context.company, p_photo_id: id }));
  photoRpcError(result.error);
  return result.data === null ? null : parseStoredPhoto(result.data, context.company, id);
}
export function photoRpcError(error: { code?: string } | null) { if (error) throw new PhotoError(error.code === '42501' ? 'access_denied' : error.code === '40001' || error.code === '23505' ? 'conflict' : error.code === '22023' ? 'invalid_input' : 'unavailable'); }
export function photoFailure(error: unknown) {
  const code = error instanceof PhotoError ? error.code : 'unavailable';
  const messages = { access_denied: 'Du har inte längre tillgång till bilens bilder.', invalid_input: 'Välj en JPEG-, PNG- eller WebP-bild på högst 10 MiB.', conflict: 'Bilden eller begäran har ändrats. Läs in aktuell information.', unavailable: 'Bilden kunde inte verifieras. Försök igen med samma uppgifter.' };
  return { ok: false as const, code, message: messages[code] };
}
export async function deadline<T>(work: PromiseLike<T>, milliseconds = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PhotoError('unavailable')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
