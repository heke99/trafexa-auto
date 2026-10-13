import 'server-only';
import { createDocuSealClient, type DocuSealConfig } from './docuseal';

export { DocuSealError, parseVerifiedDocuSealWebhook, verifyDocuSealWebhook } from './docuseal';
export type {
  DocuSealCreateInput, DocuSealErrorCode, DocuSealSignerInput,
  DocuSealSubmission, DocuSealSubmitter, DocuSealWebhookEvent,
} from './docuseal';
export * from './signing-state';

/** No application route, provider dispatch or credential lookup is wired yet. */
export function createTrafexaDocuSealClient(config: Omit<DocuSealConfig, 'enabled'>) {
  // Override even an untyped enabled:true argument until activation is implemented.
  return createDocuSealClient({ ...config, enabled: false });
}
