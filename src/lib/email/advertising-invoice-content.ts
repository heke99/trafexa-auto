import { createHash } from 'node:crypto';
import { generateAdvertisingIssuedInvoicePdf } from '../documents/advertising-issued-invoice-pdf.ts';
import { generateAdvertisingCreditInvoicePdf } from '../documents/advertising-credit-invoice-pdf.ts';
import { invoiceMoney } from '../documents/advertising-invoice-pdf.ts';
import type { AdvertisingIssuedInvoice } from '../advertising/issuance-types';
import type { AdvertisingCreditInvoice } from '../advertising/credit-types';
import type { AdvertisingInvoiceEmailJob } from '../advertising/invoice-email-types';

export const INVOICE_EMAIL_SENDER = 'Trafexa <kundtjanst@trafexa.com>';
export const INVOICE_EMAIL_REPLY_TO = 'info@trafexa.com';
export const MAX_INVOICE_PDF_BYTES = 10 * 1024 * 1024;
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
export const emailDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

/** Version 1. Keep the complete provider payload stable for every retry of this job. */
export async function prepareAdvertisingInvoiceEmail(job: AdvertisingInvoiceEmailJob) {
  const saved = job.snapshot;
  if (saved.templateVersion !== 1 || !['invoice', 'credit'].includes(saved.documentKind)) throw Error('Unsupported email version');
  const invoice = saved.documentKind === 'invoice' ? saved.document as AdvertisingIssuedInvoice : (saved.document as AdvertisingCreditInvoice).snapshot.originalInvoice;
  const credit = saved.documentKind === 'credit' ? saved.document as AdvertisingCreditInvoice : null;
  const original = invoice.snapshot.assessment.snapshot.draft.snapshot;
  if (saved.recipient !== original.buyerProfile.fields.invoiceEmail || saved.documentSourceHash !== saved.document.sourceHash) throw Error('Email source mismatch');
  const pdf = credit ? await generateAdvertisingCreditInvoicePdf(credit) : await generateAdvertisingIssuedInvoicePdf(invoice);
  if (!pdf.length || pdf.length > MAX_INVOICE_PDF_BYTES || !Buffer.from(pdf.subarray(0, 5)).equals(Buffer.from('%PDF-'))) throw Error('Invalid attachment');
  const title = `${credit ? 'Kreditfaktura' : 'Faktura'} ${saved.documentNumber}`;
  const lines = credit
    ? [`Bifogat finns kreditfaktura ${credit.creditNumber} från ${original.sellerProfile.fields.legalName} till ${original.buyerProfile.fields.legalName}.`,
      `Avser originalfaktura ${invoice.invoiceNumber}, daterad ${invoice.invoiceDate}.`,
      `Krediterat belopp inklusive moms: -${invoiceMoney(saved.grossTotalOre)}.`,
      'Kreditfakturan minskar originalfakturan i sin helhet. Mejlet bekräftar ingen betalning eller återbetalning.']
    : [`Bifogat finns faktura ${invoice.invoiceNumber} från ${original.sellerProfile.fields.legalName} till ${original.buyerProfile.fields.legalName}.`,
      `Att betala: ${invoiceMoney(saved.grossTotalOre)}. Förfallodatum: ${invoice.dueDate}.`,
      'Betalningsuppgifter och specifikation finns i den bifogade PDF-fakturan. Ange fakturanumret som betalningsreferens.',
      'Detta mejl är inget betalningskvitto.'];
  const text = `${title}\n\n${lines.join('\n\n')}\n\nDu kan även läsa dokumentet efter inloggning på https://app.trafexa.com/advertising\n\nFrågor? Kontakta info@trafexa.com\nTrafexa Nordic AB · 556855-4884`;
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;background:#f4f6f8;color:#17212b;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td style="padding:24px 16px"><table role="presentation" width="100%" style="max-width:600px;margin:auto;background:#fff"><tr><td style="padding:28px"><div style="font-size:24px;font-weight:700">TRAFEXA</div><h1 style="font-size:22px">${escape(title)}</h1>${lines.map(line => `<p style="line-height:1.6">${escape(line)}</p>`).join('')}<p><a href="https://app.trafexa.com/advertising">Visa dokument i Trafexa</a></p><p>Frågor? <a href="mailto:info@trafexa.com">info@trafexa.com</a></p><p style="font-size:12px">Trafexa Nordic AB · 556855-4884</p></td></tr></table></td></tr></table></body></html>`;
  const payload = {
    from: INVOICE_EMAIL_SENDER, to: [saved.recipient], reply_to: INVOICE_EMAIL_REPLY_TO,
    subject: title, text, html,
    attachments: [{ filename: `${credit ? 'kreditfaktura' : 'faktura'}-${saved.documentNumber}.pdf`, content: Buffer.from(pdf).toString('base64') }],
    tags: [{ name: 'trafexa_invoice_email_id', value: job.id }],
  };
  const body = JSON.stringify(payload);
  return { body, payloadHash: emailDigest(body), pdfSha256: emailDigest(pdf) };
}
