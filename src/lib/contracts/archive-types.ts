/** Browser-safe DTOs. Stored paths are references, never public download URLs. */
export const CONTRACT_ARCHIVE_RENDERER_VERSION = 'trafexa-native-v1' as const;
export const CONTRACT_ARCHIVE_BUCKET = 'native-contract-originals' as const;
export type ContractArchiveFile = { objectPath: string; sha256: string; bytes: number; mimeType: 'application/pdf' | 'application/json' };
export type ContractArchive = {
  id: string; signingId: string; companyId: string; dealId: string; draftId: string; draftVersion: number;
  documentContentSha256: string; signingRevision: number;
  rendererVersion: typeof CONTRACT_ARCHIVE_RENDERER_VERSION; evidenceSchemaVersion: 1;
  pdf: ContractArchiveFile & { mimeType: 'application/pdf' };
  evidence: ContractArchiveFile & { mimeType: 'application/json' };
  archivedAt: string;
};
export type ContractArchiveInput = { companyId: string; signingId: string; requestId: string };
export type ContractArchiveReadInput = { signingId: string; companyId?: string };
export type ContractArchiveScope = { companyId: string; signingId: string; actorId: string; role: 'owner' | 'admin' | 'finance' | 'customer' };
export type ContractArchiveCode = 'configuration_missing' | 'invalid_input' | 'unauthenticated' | 'access_denied' | 'source_invalid' | 'storage_unverified' | 'conflict' | 'persistence_unknown' | 'unavailable';
export type ContractArchiveFailure = { ok: false; code: ContractArchiveCode; error: string };
export type ContractArchiveResult = ({ ok: true; archive: ContractArchive | null } & ContractArchiveScope) | ContractArchiveFailure;
export type ContractArchiveMutationResult = ({ ok: true; archive: ContractArchive } & ContractArchiveScope) | ContractArchiveFailure;
