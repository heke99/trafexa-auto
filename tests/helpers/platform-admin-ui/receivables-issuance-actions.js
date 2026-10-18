import { getPlatformAdvertisingIssuedInvoiceAction as existingDetail } from '../advertising-issuance-ui/actions.js';
export * from '../advertising-issuance-ui/actions.js';
export async function getPlatformAdvertisingIssuedInvoiceAction(input) {
 if (window.fixture.receivablesInvoice) { window.fixture.receivablesInvoiceCalls ??= []; window.fixture.receivablesInvoiceCalls.push(input); return { ok: true, invoice: structuredClone(window.fixture.receivablesInvoice), isSourceOutdated: false }; }
 return existingDetail(input);
}
