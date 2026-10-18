'use server';

import { readVerifiedContractArchive, contractArchiveIntegrityFailure } from '../documents/verified-contract-archive';
import type { ContractArchiveReadInput, ContractArchiveIntegrityResult } from '../contracts/archive-types';

/** Verify registered originals only; bytes and server revalidation never cross the action boundary. */
export async function verifyContractArchiveAction(value: ContractArchiveReadInput): Promise<ContractArchiveIntegrityResult> {
  try {
    const result = await readVerifiedContractArchive(value);
    const { companyId, signingId, actorId, role } = result;
    if (!result.archive) return { ok: true, companyId, signingId, actorId, role, archive: null, checkedAt: null };
    return { ok: true, companyId, signingId, actorId, role, archive: result.archive, checkedAt: result.checkedAt };
  } catch (error) { return contractArchiveIntegrityFailure(error); }
}
