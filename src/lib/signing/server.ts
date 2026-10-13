import 'server-only';
import { createDocuSealClient, type DocuSealConfig } from './docuseal.ts';
import { createSigningWorker, type SigningWorkerConfig } from './signing-worker.ts';

export { DocuSealError, parseVerifiedDocuSealWebhook, verifyDocuSealWebhook } from './docuseal.ts';
export type {
  DocuSealCreateInput, DocuSealErrorCode, DocuSealSignerInput,
  DocuSealSubmission, DocuSealSubmitter, DocuSealWebhookEvent,
} from './docuseal.ts';
export * from './signing-state.ts';
export { createSigningStore } from './signing-store.ts';
export { createSigningUserBoundary } from './signing-user.ts';
export { createPrivateSigningStorage } from './signing-storage.ts';

/** Provider creation stays disabled while contract rendering and provider setup are pending. */
export function createTrafexaDocuSealClient(config: Omit<DocuSealConfig, 'enabled'>) {
  // Override even an untyped enabled:true argument until activation is implemented.
  return createDocuSealClient({ ...config, enabled: false });
}

export function createTrafexaSigningWorker(config: Omit<SigningWorkerConfig, 'enabled'>) {
  return createSigningWorker({ ...config, enabled: false });
}
