import type { ContractDraft } from './types';
import type { SignatureStroke } from '@/lib/signing/docuseal-ported/signature-validation';
export const CONTRACT_SIGNING_CONSENT_VERSION = '2026-10-14' as const;
export type ContractSignature = {
  party: 'customer' | 'company'; fullName: string; signedAt: string;
  documentHash: string; consentVersion: string; strokes: SignatureStroke[];
};
export type ContractSigning = {
  id: string; companyId: string; dealId: string; draftId: string; draftVersion: number;
  documentHash: string; canonicalContent: string; renderedTerms: string; draft: ContractDraft;
  status: 'pending' | 'completed' | 'unavailable'; revision: number;
  customerEmail: string; createdAt: string; completedAt: string | null;
  customerSignature: ContractSignature | null; companySignature: ContractSignature | null;
  canSign: boolean; party: 'customer' | 'company' | null;
};
export type ContractSigningPage = { signings: ContractSigning[]; nextBeforeId: string | null };
export type SignContractInput = {
  signingId: string; companyId?: string; expectedRevision: number; documentHash: string;
  fullName: string; strokes: SignatureStroke[]; acknowledged: boolean;
  consentVersion: typeof CONTRACT_SIGNING_CONSENT_VERSION; requestId: string;
};
