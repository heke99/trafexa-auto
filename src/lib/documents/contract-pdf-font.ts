import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTRACT_PDF_FONT_RANGES, CONTRACT_PDF_FONT_SHA256 } from '../contracts/pdf-font-coverage.ts';

export class ContractPdfValidationError extends Error {
  readonly code = 'invalid_input';
}

let fontBytes: Promise<Buffer> | undefined;
/** Signing validation and rendering must refer to exactly the same font version. */
export function getContractPdfFontBytes(): Promise<Buffer> {
  fontBytes ??= readFile(join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf')).then(bytes => {
    if (createHash('sha256').update(bytes).digest('hex') !== CONTRACT_PDF_FONT_SHA256) {
      throw new Error('Contract PDF font does not match its verified coverage version.');
    }
    return bytes;
  }).catch(error => { fontBytes = undefined; throw error; });
  return fontBytes;
}

export function contractPdfTextSupported(value: string): boolean {
  return Array.from(value).every(character => {
    const code = character.codePointAt(0)!;
    return CONTRACT_PDF_FONT_RANGES.some(([first, last]) => code >= first && code <= last);
  });
}

export async function assertContractPdfName(fullName: string): Promise<void> {
  await getContractPdfFontBytes();
  if (!contractPdfTextSupported(fullName)) {
    throw new ContractPdfValidationError('Namnet innehåller tecken som ännu inte kan återges i avtalsoriginalet. Ingen ny underskrift har sparats. Kontakta bilhandlaren för hjälp.');
  }
}
