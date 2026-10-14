import 'server-only';
import { createHash } from 'node:crypto';
import { draft, id, integer, record, input, text } from './validation';
import { renderContractTemplate } from '@/lib/documents/contract-pdf';
import { isValidSignatureCanvas, type SignatureStroke } from '@/lib/signing/docuseal-ported/signature-validation';
import { CONTRACT_SIGNING_CONSENT_VERSION, type ContractSigning, type ContractSignature } from './signing-types';
export function hash(v: unknown): string { if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) throw Error('Invalid hash'); return v; }
export function email(v: unknown): string { const s = text(v, 3, 254).toLowerCase(); if (s !== v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw Error('Invalid email'); return s; }
function timestamp(v: unknown): string { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v))) throw Error('Invalid date'); return v; }
export function signatureStrokes(v: unknown): SignatureStroke[] {
  if (!isValidSignatureCanvas(v)) throw Error('Invalid signature');
  return (v as SignatureStroke[]).map(stroke => ({ points: stroke.points.map(point => ({ x: point.x, y: point.y })) }));
}
function signature(v: unknown, party: 'company' | 'customer', documentHash: string): ContractSignature | null {
  if (v === null) return null;
  const r = record(v);
  if (r.party !== party || hash(r.documentHash) !== documentHash || r.consentVersion !== CONTRACT_SIGNING_CONSENT_VERSION) throw Error('Invalid signature receipt');
  return { party, fullName: text(r.fullName, 2, 160), signedAt: timestamp(r.signedAt), documentHash, consentVersion: CONTRACT_SIGNING_CONSENT_VERSION, strokes: signatureStrokes(r.strokes) };
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v);
}
export function signing(v: unknown, userId: string, scope: { companyId?: string; dealId?: string; customerEmail?: string; role?: string }): ContractSigning {
  const r = record(v), companyId = id(r.companyId), dealId = id(r.dealId), documentHash = hash(r.documentHash);
  if (scope.companyId && scope.companyId !== companyId || scope.dealId && scope.dealId !== dealId) throw Error('Invalid signing scope');
  const d = draft(r.draft, companyId, userId, dealId), customerEmail = email(r.customerEmail);
  if (scope.customerEmail && customerEmail !== scope.customerEmail || d.sourceOffer.customer.email?.trim().toLowerCase() !== customerEmail) throw Error('Invalid recipient');
  const canonicalContent = r.canonicalContent;
  if (typeof canonicalContent !== 'string' || canonicalContent.length > 100000 || createHash('sha256').update(canonicalContent, 'utf8').digest('hex') !== documentHash) throw Error('Invalid canonical hash');
  const canonical = input(JSON.parse(canonicalContent), ['draftId', 'companyId', 'dealId', 'draftVersion', 'content']);
  const expected = { draftId: d.id, companyId, dealId, draftVersion: d.version, content: { offerVersion: d.offerVersion, template: d.template, sourceOffer: d.sourceOffer } };
  if (stable(canonical) !== stable(expected) || id(r.draftId) !== d.id || integer(r.draftVersion) !== d.version) throw Error('Invalid canonical source');
  const customerSignature = signature(r.customerSignature, 'customer', documentHash), companySignature = signature(r.companySignature, 'company', documentHash), n = Number(customerSignature !== null) + Number(companySignature !== null);
  const completedAt = r.completedAt === null ? null : timestamp(r.completedAt), revision = integer(r.revision, 1, 3), status = r.status as ContractSigning['status'];
  if (!['pending', 'completed', 'unavailable'].includes(status) || revision !== n + 1 || (status === 'completed') !== (n === 2) || (completedAt !== null) !== (n === 2) || completedAt && Date.parse(completedAt) !== Math.max(Date.parse(customerSignature!.signedAt), Date.parse(companySignature!.signedAt))) throw Error('Invalid completion');
  const party = r.party as ContractSigning['party'];
  const expectedParty = scope.customerEmail ? 'customer' : ['owner', 'admin'].includes(scope.role ?? '') ? 'company' : null;
  if (party !== expectedParty || typeof r.canSign !== 'boolean' || r.canSign && (party === null || status !== 'pending' || party === 'customer' && customerSignature !== null || party === 'company' && companySignature !== null)) throw Error('Invalid signing permissions');
  return { id: id(r.id), companyId, dealId, draftId: d.id, draftVersion: d.version, documentHash, canonicalContent, renderedTerms: renderContractTemplate(d.template.body, d.sourceOffer), draft: d, status, revision, customerEmail, createdAt: timestamp(r.createdAt), completedAt, customerSignature, companySignature, canSign: r.canSign, party };
}
