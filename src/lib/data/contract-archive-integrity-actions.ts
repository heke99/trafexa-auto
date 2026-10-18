'use server';

import { z } from 'zod';
import { requireDealerSigningContext, requireCustomerSigningContext } from '../contracts/signing-context';
import { signing as parseSigning } from '../contracts/signing-validation';
import { parseCompletedContract } from '../documents/signed-contract-pdf';
import {
  assertContractArchiveSource, verifyContractArchiveFiles, parseContractArchiveEnvelope,
  nativeArchiveOperation, NativeContractArchiveError, CONTRACT_ARCHIVE_BUCKET,
  MAX_CONTRACT_PDF_BYTES, MAX_CONTRACT_EVIDENCE_BYTES,
} from '../documents/native-contract-archive';
import type {
  ContractArchiveCode, ContractArchiveFailure, ContractArchiveReadInput,
  ContractArchiveIntegrityResult, ContractArchiveScope,
} from '../contracts/archive-types';

type Context = Awaited<ReturnType<typeof requireDealerSigningContext>> | Awaited<ReturnType<typeof requireCustomerSigningContext>>;
type RpcClient = { rpc(name: string, args: Record<string, unknown>): { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> } };
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const messages: Partial<Record<ContractArchiveCode, string>> = {
  invalid_input: 'Avtalsreferensen är ogiltig. Öppna avtalet igen.',
  unauthenticated: 'Logga in igen för att kontrollera avtalets originalarkiv.',
  access_denied: 'Din aktuella behörighet till avtalets originalarkiv kunde inte verifieras.',
  source_invalid: 'Det färdigsignerade avtalsunderlaget kunde inte verifieras.',
  storage_unverified: 'Originalfilerna kunde inte verifieras. Ingen lyckad filkontroll har bekräftats.',
  conflict: 'Arkivet eller avtalsunderlaget ändrades under kontrollen. Läs in avtalet och kontrollera igen.',
  unavailable: 'Integritetskontrollen kunde inte slutföras. Försök igen.',
};
function failure(error: unknown): ContractArchiveFailure {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code: ContractArchiveCode = error instanceof NativeContractArchiveError ? error.code
    : raw === 'unauthenticated' ? 'unauthenticated' : raw === 'access_denied' || raw === '42501' ? 'access_denied'
      : raw === '40001' || raw === '23505' ? 'conflict' : 'unavailable';
  return { ok: false, code, error: messages[code] ?? messages.unavailable! };
}
async function context(companyId?: string): Promise<Context> {
  return companyId ? requireDealerSigningContext(companyId) : requireCustomerSigningContext();
}
function sameContext(initial: Context, current: Context) {
  if (current.userId !== initial.userId
    || 'companyId' in initial && (!('companyId' in current) || current.companyId !== initial.companyId || current.role !== initial.role)
    || 'email' in initial && (!('email' in current) || current.email !== initial.email)) throw new NativeContractArchiveError('access_denied');
}

/** Verify registered originals only. This action neither creates nor repairs an archive. */
export async function verifyContractArchiveAction(value: ContractArchiveReadInput): Promise<ContractArchiveIntegrityResult> {
  let input: ContractArchiveReadInput;
  try { input = z.object({ signingId: uuid, companyId: uuid.optional() }).strict().parse(value); }
  catch { return failure(new NativeContractArchiveError('invalid_input')); }
  try {
    const bounded = nativeArchiveOperation();
    const initial = await bounded(() => context(input.companyId));
    const role = 'companyId' in initial ? initial.role : 'customer';
    if (input.companyId !== undefined
      ? !('companyId' in initial) || initial.companyId !== input.companyId || !['owner', 'admin', 'finance'].includes(role)
      : 'companyId' in initial || !('email' in initial)) throw new NativeContractArchiveError('access_denied');
    async function archive(current: Context) {
      const response = await bounded(async ({ signal }) => await (current.db as unknown as RpcClient).rpc('get_contract_signing_archive', {
        p_signing_id: input.signingId, p_company_id: input.companyId ?? null,
      }).abortSignal(signal));
      if (response.error) throw response.error;
      return parseContractArchiveEnvelope(response.data, { ...input, actorId: initial.userId });
    }
    async function fresh() {
      const current = await bounded(() => context(input.companyId));
      sameContext(initial, current);
      return current;
    }
    const first = await archive(initial);
    const scope: ContractArchiveScope = { companyId: first.companyId, signingId: first.signingId, actorId: first.actorId, role: role as ContractArchiveScope['role'] };
    if (!first.archive) {
      const latest = await archive(await fresh());
      if (JSON.stringify(latest) !== JSON.stringify(first)) throw new NativeContractArchiveError('conflict');
      await fresh();
      return { ok: true, ...scope, archive: null, checkedAt: null };
    }
    async function source(current: Context) {
      const response = await bounded(async ({ signal }) => await (current.db as unknown as RpcClient).rpc('get_contract_signing', {
        p_signing_id: input.signingId, p_company_id: input.companyId ?? null,
      }).abortSignal(signal));
      if (response.error) throw response.error;
      try {
        const row = z.object({ companyId: uuid, actorUserId: uuid, actorRole: z.string(), recipientEmail: z.unknown(), signing: z.unknown() }).parse(response.data);
        if (row.actorUserId !== initial.userId || row.companyId !== scope.companyId || row.actorRole !== role
          || 'email' in current && row.recipientEmail !== current.email) throw new NativeContractArchiveError('access_denied');
        const signing = parseSigning(row.signing, current.userId, 'companyId' in current
          ? { companyId: scope.companyId, role: current.role } : { customerEmail: current.email });
        const completed = parseCompletedContract(signing);
        if (completed.id !== input.signingId || completed.companyId !== scope.companyId || completed.revision !== 3) throw new NativeContractArchiveError('source_invalid');
        return completed;
      } catch (error) {
        if (error instanceof NativeContractArchiveError) throw error;
        throw new NativeContractArchiveError('source_invalid');
      }
    }
    const completed = await source(initial), sourceSnapshot = JSON.stringify(completed), archiveSnapshot = JSON.stringify(first);
    assertContractArchiveSource(first.archive, completed);
    const reader = await fresh();
    async function download(path: string, expectedBytes: number, max: number) {
      return bounded(async ({ signal }) => {
        const result = await reader.db.storage.from(CONTRACT_ARCHIVE_BUCKET).download(path, {}, { signal, cache: 'no-store' });
        if (result.error || !result.data || !Number.isSafeInteger(result.data.size)
          || result.data.size !== expectedBytes || result.data.size < 2 || result.data.size > max) throw new NativeContractArchiveError('storage_unverified');
        return new Uint8Array(await result.data.arrayBuffer());
      });
    }
    const [pdf, evidence] = await Promise.all([
      download(first.archive.pdf.objectPath, first.archive.pdf.bytes, MAX_CONTRACT_PDF_BYTES),
      download(first.archive.evidence.objectPath, first.archive.evidence.bytes, MAX_CONTRACT_EVIDENCE_BYTES),
    ]);
    verifyContractArchiveFiles(first.archive, { pdf, evidence }, completed);
    const current = await fresh(), latestArchive = await archive(current), latestSource = await source(current);
    if (JSON.stringify(latestArchive) !== archiveSnapshot || JSON.stringify(latestSource) !== sourceSnapshot) throw new NativeContractArchiveError('conflict');
    if (!latestArchive.archive) throw new NativeContractArchiveError('conflict');
    assertContractArchiveSource(latestArchive.archive, latestSource);
    await fresh();
    return { ok: true, ...scope, archive: first.archive, checkedAt: new Date().toISOString() };
  } catch (error) { return failure(error); }
}
