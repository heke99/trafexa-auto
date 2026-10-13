'use server';

import { revalidatePath } from 'next/cache';
import { env } from 'node:process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveCompanyContext } from './company-context';
import { archiveStoredOffer, createOfferArchiveRegistrationClient, MAX_OFFER_ARCHIVE_BYTES, OFFER_ARCHIVE_BUCKET, OfferArchiveError } from '../documents/offer-archive';
import type { OfferArchiveDatabase } from '../documents/offer-archive-database';
import type { OfferArchiveInput } from '../documents/offer-archive';

export type OfferArchiveActionResult = { ok: boolean; message: string; documentId?: string; offerId?: string; companyId?: string; version?: number; status?: 'archived' };
const messages: Record<OfferArchiveError['code'], string> = {
  configuration_missing: 'Privat offertarkivering är inte konfigurerad ännu.',
  invalid_input: 'Offerten eller företaget är ogiltigt. Öppna offertlistan igen.',
  unauthenticated: 'Logga in igen för att arkivera offerten.',
  company_changed: 'Det aktiva företaget har ändrats. Öppna offertlistan igen.',
  forbidden: 'Du behöver ett aktivt medlemskap som ägare, administratör eller ekonomi för att arkivera offerten.',
  not_found: 'Offerten finns inte i det aktiva företaget.',
  source_invalid: 'Det sparade offertunderlaget kunde inte verifieras för arkivering.',
  storage_unverified: 'Den privata PDF-filen kunde inte verifieras. Offerten har inte bekräftats som arkiverad.',
  conflict: 'Offertens arkivunderlag ändrades. Öppna offertlistan igen.',
  persistence_unknown: 'Arkiveringen kunde inte bekräftas. Försök igen med samma offert; ett befintligt arkiv återanvänds.',
  unavailable: 'Offertarkivet kunde inte nås. Försök igen med samma offert.',
};
function databaseFailure(error: { code?: string } | null): never {
  if (error?.code === '42501') throw new OfferArchiveError('forbidden');
  if (error?.code === 'P0002') throw new OfferArchiveError('not_found');
  if (error?.code === '40001' || error?.code === '23505') throw new OfferArchiveError('conflict');
  throw new OfferArchiveError('unavailable');
}

/** Public Server Action: only references are accepted; PDF, price and hashes are server-derived. */
export async function archiveOfferAction(input: OfferArchiveInput): Promise<OfferArchiveActionResult> {
  let activeDb: SupabaseClient<OfferArchiveDatabase> | null = null;
  let registrationClient: ReturnType<typeof createOfferArchiveRegistrationClient> | null = null;
  function client() { if (!activeDb) throw new OfferArchiveError('unauthenticated'); return activeDb; }
  try {
    const proof = await archiveStoredOffer(input, {
      async authorize(expectedCompany, { signal }) {
        const session = await getActiveCompanyContext();
        if (session.company.toLowerCase() !== expectedCompany) throw new OfferArchiveError('company_changed');
        const db = session.db as unknown as SupabaseClient<OfferArchiveDatabase>;
        const { data: auth, error: authError } = await db.auth.getUser();
        if (authError || !auth.user || auth.user.is_anonymous || auth.user.id !== session.user) throw new OfferArchiveError('unauthenticated');
        const [membership, company] = await Promise.all([
          db.from('memberships').select('company_id,user_id,role,status').eq('company_id', expectedCompany).eq('user_id', auth.user.id).eq('status', 'active').abortSignal(signal).maybeSingle(),
          db.from('companies').select('id,status').eq('id', expectedCompany).abortSignal(signal).maybeSingle(),
        ]);
        if (membership.error || company.error || !membership.data || !company.data || membership.data.company_id !== expectedCompany || membership.data.user_id !== auth.user.id || membership.data.status !== 'active' || company.data.id !== expectedCompany || company.data.status !== 'active') throw new OfferArchiveError('forbidden');
        activeDb = db;
        return { companyId: expectedCompany, userId: auth.user.id, role: membership.data.role, companyActive: true, membershipActive: true };
      },
      async getSource(companyId, offerId, { signal }) {
        const { data, error } = await client().rpc('get_offer_archive_source', { p_company_id: companyId, p_offer_id: offerId }).abortSignal(signal);
        if (error) databaseFailure(error); return data;
      },
      async getArchive(companyId, offerId, { signal }) {
        const { data, error } = await client().rpc('get_offer_document_archive', { p_company_id: companyId, p_offer_id: offerId }).abortSignal(signal);
        if (error) databaseFailure(error); return data;
      },
      async prepareRegistration() {
        registrationClient = createOfferArchiveRegistrationClient({ supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '', serviceKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '' });
      },
      async upload(path, bytes) {
        const { error } = await client().storage.from(OFFER_ARCHIVE_BUCKET).upload(path, bytes, { upsert: false, contentType: 'application/pdf', cacheControl: '0' });
        if (error) throw new OfferArchiveError('unavailable');
      },
      async download(path, { signal }) {
        const { data, error } = await client().storage.from(OFFER_ARCHIVE_BUCKET).download(path, {}, { signal, cache: 'no-store' });
        if (error || !data || data.size < 5 || data.size > MAX_OFFER_ARCHIVE_BYTES) throw new OfferArchiveError('storage_unverified');
        return new Uint8Array(await data.arrayBuffer());
      },
      async register(payload, control) {
        if (!registrationClient) throw new OfferArchiveError('configuration_missing');
        return registrationClient.register(payload, control);
      },
    });
    revalidatePath('/documents'); revalidatePath('/deals');
    return { ok: true, message: 'Offertens PDF har arkiverats privat. Den är inte signerad.', documentId: proof.documentId, offerId: proof.offerId, companyId: proof.companyId, version: proof.version, status: 'archived' };
  } catch (error) { return { ok: false, message: messages[error instanceof OfferArchiveError ? error.code : 'unavailable'] }; }
}
