'use server';

import { revalidatePath } from 'next/cache';
import { env } from 'node:process';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import { requireDealerSigningContext, requireCustomerSigningContext } from '../contracts/signing-context';
import { getContractSigningAction } from './contract-signing-actions';
import { archiveNativeContract, createNativeContractArchiveRegistrationClient, createNativeContractArchiveUploader, nativeArchiveOperation, parseContractArchiveEnvelope, NativeContractArchiveError, CONTRACT_ARCHIVE_BUCKET, MAX_CONTRACT_EVIDENCE_BYTES, MAX_CONTRACT_PDF_BYTES } from '../documents/native-contract-archive';
import type { ContractArchiveCode, ContractArchiveFailure, ContractArchiveInput, ContractArchiveMutationResult, ContractArchiveReadInput, ContractArchiveResult } from '../contracts/archive-types';

type ArchiveDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & { Functions: Database['public']['Functions'] & { get_contract_signing_archive: { Args: { p_signing_id: string; p_company_id: string | null }; Returns: Json } } } };
type Dealer = Awaited<ReturnType<typeof requireDealerSigningContext>>;
type Customer = Awaited<ReturnType<typeof requireCustomerSigningContext>>;
type Context = Dealer | Customer;
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const messages: Record<ContractArchiveCode, string> = {
  configuration_missing: 'Originalarkivet är inte aktiverat. Kontakta Trafexa.',
  invalid_input: 'Avtalsreferensen är ogiltig. Öppna avtalet igen.',
  unauthenticated: 'Logga in igen för att visa avtalets originalarkiv.',
  access_denied: 'Din aktuella behörighet till avtalets originalarkiv kunde inte verifieras.',
  source_invalid: 'Det färdigsignerade avtalsunderlaget kunde inte verifieras.',
  storage_unverified: 'Originalfilerna kunde inte verifieras i det privata arkivet. Inget nytt original har bekräftats.',
  conflict: 'Arkivets eller avtalets underlag ändrades. Uppdatera avtalet och försök igen.',
  persistence_unknown: 'Arkiveringen kunde inte bekräftas. Försök igen med samma begäran; ett registrerat original återanvänds.',
  unavailable: 'Originalarkivet kunde inte nås. Uppdatera och försök igen med samma begäran.',
};
function failure(error: unknown): ContractArchiveFailure {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code: ContractArchiveCode = error instanceof NativeContractArchiveError ? error.code : raw === 'unauthenticated' ? 'unauthenticated' : raw === 'access_denied' || raw === '42501' ? 'access_denied' : raw === '40001' || raw === '23505' ? 'conflict' : 'unavailable';
  return { ok: false, code, error: messages[code] };
}
async function context(companyId?: string): Promise<Context> { return companyId ? requireDealerSigningContext(companyId) : requireCustomerSigningContext(); }
function sameScope(first: Context, current: Context) {
  if (first.userId !== current.userId || 'companyId' in first && (!('companyId' in current) || current.companyId !== first.companyId || current.role !== first.role) || 'email' in first && (!('email' in current) || current.email !== first.email)) throw new NativeContractArchiveError('access_denied');
}

export async function getContractArchiveAction(value: ContractArchiveReadInput): Promise<ContractArchiveResult> {
  let input: ContractArchiveReadInput;
  try { input = z.object({ signingId: uuid, companyId: uuid.optional() }).strict().parse(value); }
  catch { return failure(new NativeContractArchiveError('invalid_input')); }
  try {
    const bounded = nativeArchiveOperation();
    const initial = await bounded(() => context(input.companyId));
    const role = 'companyId' in initial ? initial.role : 'customer';
    if (role !== 'owner' && role !== 'admin' && role !== 'finance' && role !== 'customer') throw new NativeContractArchiveError('access_denied');
    const db = initial.db as unknown as SupabaseClient<ArchiveDatabase>;
    const result = await bounded(async ({ signal }) => await db.rpc('get_contract_signing_archive', { p_signing_id: input.signingId, p_company_id: input.companyId ?? null }).abortSignal(signal));
    if (result.error) throw result.error;
    const envelope = parseContractArchiveEnvelope(result.data, { ...input, actorId: initial.userId });
    sameScope(initial, await bounded(() => context(input.companyId)));
    return { ok: true, ...envelope, role };
  } catch (error) { return failure(error); }
}

/** Browser inputs contain references only; rendering, storage and hashes stay on this server. */
export async function archiveContractAction(value: ContractArchiveInput): Promise<ContractArchiveMutationResult> {
  let active: Dealer | undefined;
  let registration: ReturnType<typeof createNativeContractArchiveRegistrationClient> | undefined;
  let uploader: ReturnType<typeof createNativeContractArchiveUploader> | undefined;
  function client() { if (!active) throw new NativeContractArchiveError('unauthenticated'); return active.db as unknown as SupabaseClient<ArchiveDatabase>; }
  try {
    const archive = await archiveNativeContract(value, {
      async authorize(companyId) {
        const current = await requireDealerSigningContext(companyId, true);
        if (!['owner', 'admin'].includes(current.role)) throw new NativeContractArchiveError('access_denied');
        if (active) sameScope(active, current);
        active = current;
        return { companyId: current.companyId, actorId: current.userId, role: current.role as 'owner' | 'admin' };
      },
      async getSigning(companyId, signingId) {
        const result = await getContractSigningAction({ companyId, signingId });
        if (!result.ok) throw { code: result.code };
        return result.signing;
      },
      async getArchive(companyId, signingId, { signal }) {
        const response = await client().rpc('get_contract_signing_archive', { p_company_id: companyId, p_signing_id: signingId }).abortSignal(signal);
        if (response.error) {
          if (response.error.code === '42501') throw new NativeContractArchiveError('access_denied');
          throw new NativeContractArchiveError('unavailable');
        }
        return response.data;
      },
      async prepareRegistration() {
        registration = createNativeContractArchiveRegistrationClient({ supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '', serviceKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '' });
        uploader = createNativeContractArchiveUploader({ supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || '', publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '' });
      },
      async upload(path, content, mimeType, { signal }) {
        if (!uploader || !active || signal.aborted) throw new NativeContractArchiveError('configuration_missing');
        const session = await client().auth.getSession();
        const token = session.data.session?.access_token;
        if (session.error || !token || session.data.session?.user.id !== active.userId) throw new NativeContractArchiveError('access_denied');
        const verified = await client().auth.getUser(token);
        if (verified.error || !verified.data.user || verified.data.user.id !== active.userId || verified.data.user.is_anonymous || !verified.data.user.email_confirmed_at) throw new NativeContractArchiveError('access_denied');
        await uploader.upload(path, content, mimeType, token, { signal });
      },
      async download(path, { signal }) {
        const max = path.endsWith('.json') ? MAX_CONTRACT_EVIDENCE_BYTES : MAX_CONTRACT_PDF_BYTES;
        const response = await client().storage.from(CONTRACT_ARCHIVE_BUCKET).download(path, {}, { signal, cache: 'no-store' });
        if (response.error || !response.data || response.data.size < 2 || response.data.size > max) throw new NativeContractArchiveError('storage_unverified');
        return new Uint8Array(await response.data.arrayBuffer());
      },
      async register(input, control) {
        if (!registration) throw new NativeContractArchiveError('configuration_missing');
        return registration.register(input, control);
      },
    });
    if (!active || !['owner', 'admin'].includes(active.role)) throw new NativeContractArchiveError('access_denied');
    try { revalidatePath('/deals'); revalidatePath('/documents'); revalidatePath('/my-contracts'); } catch { /* The verified original remains committed. */ }
    return { ok: true, archive, companyId: archive.companyId, signingId: archive.signingId, actorId: active.userId, role: active.role as 'owner' | 'admin' };
  } catch (error) { return failure(error); }
}
