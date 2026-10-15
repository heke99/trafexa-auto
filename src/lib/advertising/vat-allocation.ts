import { BILLING_UUID, ore } from './billing-validation.ts';

/** Version 2: one tax-base rounding, then largest remainder; canonical UUID breaks ties. */
export function allocateAdvertisingVatV2(rows: readonly { publicationId: string; netOre: string }[]): string[] {
  if (!Array.isArray(rows) || rows.length > 2000) throw Error('Invalid VAT allocation rows');
  const identities = new Set<string>();
  const entries = rows.map((row, index) => {
    if (!row || typeof row.publicationId !== 'string' || !BILLING_UUID.test(row.publicationId)) throw Error('Invalid publication identity');
    const publicationId = row.publicationId.toLowerCase();
    if (identities.has(publicationId)) throw Error('Duplicate publication identity');
    identities.add(publicationId);
    const net = BigInt(ore(row.netOre)), scaled = net * 25n;
    return { index, publicationId, net, tax: scaled / 100n, remainder: scaled % 100n };
  });
  const netTotal = BigInt(ore(entries.reduce((sum, row) => sum + row.net, 0n).toString()));
  const taxTotal = BigInt(ore(((netTotal * 25n + 50n) / 100n).toString()));
  ore((netTotal + taxTotal).toString());
  const extra = taxTotal - entries.reduce((sum, row) => sum + row.tax, 0n);
  const ranked = entries.filter(row => row.remainder > 0n).sort((left, right) =>
    left.remainder !== right.remainder ? (left.remainder > right.remainder ? -1 : 1) :
      left.publicationId < right.publicationId ? -1 : left.publicationId > right.publicationId ? 1 : 0);
  if (extra < 0n || extra > BigInt(ranked.length)) throw Error('Invalid VAT remainder');
  for (let index = 0; index < Number(extra); index++) ranked[index].tax += 1n;
  return entries.map(row => { ore((row.net + row.tax).toString()); return ore(row.tax.toString()); });
}
