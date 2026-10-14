import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isValidSignatureCanvas } from '../signing/docuseal-ported/signature-validation.ts';
import { parseContractDraft, renderContractPdf } from './contract-pdf.ts';

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const point = z.object({ x: z.number().finite().min(-1000000).max(1000000), y: z.number().finite().min(-1000000).max(1000000) });
const signature = z.object({
  party: z.enum(['customer', 'company']), fullName: z.string().min(2).max(160).refine(v => v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v)),
  signedAt: timestamp, documentHash: hash, consentVersion: z.literal('2026-10-14'),
  strokes: z.array(z.object({ points: z.array(point).max(4096) })).min(1).max(256).refine(isValidSignatureCanvas),
});
const completion = z.object({
  id: uuid, companyId: uuid, dealId: uuid, draftId: uuid, draftVersion: z.number().int().positive(),
  documentHash: hash, canonicalContent: z.string().min(2).max(100000), draft: z.unknown().transform(parseContractDraft),
  status: z.literal('completed'), revision: z.number().int().positive(), createdAt: timestamp, completedAt: timestamp,
  customerSignature: signature, companySignature: signature,
});
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

/** Checks immutable SQL content and both receipts, never accepts a preview as a completed contract. */
export function parseCompletedContract(value: unknown) {
  const s = completion.parse(value), d = s.draft;
  if (sha256(s.canonicalContent) !== s.documentHash || s.companyId !== d.companyId || s.dealId !== d.dealId || s.draftId !== d.id || s.draftVersion !== d.version) throw Error('Signed contract binding mismatch');
  const canonical = JSON.parse(s.canonicalContent);
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const left = Object.keys(a), right = Object.keys(b);
    return left.length === right.length && left.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  };
  if (!equal(canonical, { draftId:d.id, companyId:d.companyId, dealId:d.dealId, draftVersion:d.version, content:{ offerVersion:d.offerVersion, template:d.template, sourceOffer:d.sourceOffer } })) throw Error('Signed contract content mismatch');
  if (s.customerSignature.party !== 'customer' || s.companySignature.party !== 'company') throw Error('Invalid signing parties');
  for (const receipt of [s.customerSignature, s.companySignature]) {
    if (receipt.documentHash !== s.documentHash || Date.parse(receipt.signedAt) < Date.parse(s.createdAt) || Date.parse(receipt.signedAt) > Date.parse(s.completedAt)) throw Error('Invalid signing receipt');
  }
  if (Date.parse(s.completedAt) !== Math.max(Date.parse(s.customerSignature.signedAt), Date.parse(s.companySignature.signedAt))) throw Error('Invalid completion time');
  return s;
}
export async function generateSignedContractPdf(value: unknown) {
  const s = parseCompletedContract(value);
  return renderContractPdf(s.draft, { documentHash:s.documentHash, completedAt:s.completedAt, signatures:[s.customerSignature,s.companySignature] });
}
export async function generateSigningEvidence(value: unknown) {
  const s = parseCompletedContract(value), pdf = await generateSignedContractPdf(s);
  return {
    schemaVersion:1, method:'trafexa-simple-electronic-signature', signingId:s.id,
    draftId:s.draftId, draftVersion:s.draftVersion, documentContentSha256:s.documentHash,
    signedPdfSha256:sha256(pdf), completedAt:s.completedAt,
    receipts:[s.customerSignature,s.companySignature].map(({party,fullName,signedAt,documentHash,consentVersion}) => ({party,fullName,signedAt,documentHash,consentVersion})),
    assurance:'Verified email and approved authenticated account; no BankID identification or certificate-based PDF signature.',
  };
}
