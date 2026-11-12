import type { ContractSigning } from '../contracts/signing-types';
import { renderContractPdf, type ContractPdfSignature } from './contract-pdf.ts';
import { assertContractPdfName, ContractPdfValidationError } from './contract-pdf-font.ts';

/** A preview is never stored or treated as a signed document. The mutation still
 * checks the immutable source/hash/revision inside its database transaction. */
export async function assertContractSigningRenderable(signing: ContractSigning, proposed: Pick<ContractPdfSignature, 'party' | 'fullName' | 'strokes' | 'authenticationMethod'>): Promise<void> {
  await assertContractPdfName(proposed.fullName);
  const signatures = [signing.customerSignature, signing.companySignature].filter(signature => signature !== null && signature.party !== proposed.party);
  for (const signature of signatures) {
    if (signature) await assertContractPdfName(signature.fullName);
  }
  const previewTime = new Date().toISOString();
  try {
    await renderContractPdf(signing.draft, {
      documentHash: signing.documentHash,
      completedAt: previewTime,
      signatures: [...signatures.filter(signature => signature !== null), { ...proposed, signedAt: previewTime }],
    });
  } catch (error) {
    if (error instanceof Error && /tecken.*inte stöder/.test(error.message)) {
      throw new ContractPdfValidationError('Avtalsunderlaget innehåller tecken som ännu inte kan återges i originalet. Ingen ny underskrift har sparats. Kontakta bilhandlaren för hjälp.');
    }
    throw error;
  }
}
