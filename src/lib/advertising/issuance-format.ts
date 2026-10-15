/** Stable invoice renderer v1 conventions; calendar arithmetic never uses server timezone. */
export function formatIssuedInvoiceNumber(prefix: string, year: number, sequence: number): string {
  if (!/^[A-Z0-9]{2,12}$/.test(prefix) || !Number.isSafeInteger(year) || year < 2000 || year > 2100 ||
      !Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999999999) throw Error('Invalid invoice number');
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

export function invoiceDateInStockholm(instant: string): string {
  if (typeof instant !== 'string' || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(instant) || !Number.isFinite(Date.parse(instant))) throw Error('Invalid invoice instant');
  const calendar = new Date(`${instant.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== instant.slice(0, 10)) throw Error('Invalid invoice calendar date');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function invoiceDueDate(invoiceDate: string, paymentDays: number): string {
  if (typeof invoiceDate !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(invoiceDate) || !Number.isSafeInteger(paymentDays) || paymentDays < 1 || paymentDays > 90) throw Error('Invalid invoice terms');
  const day = new Date(`${invoiceDate}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== invoiceDate) throw Error('Invalid invoice calendar date');
  day.setUTCDate(day.getUTCDate() + paymentDays);
  return day.toISOString().slice(0, 10);
}
