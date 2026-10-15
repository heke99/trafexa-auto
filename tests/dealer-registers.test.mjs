import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSourceLoader } from './helpers/source-loader.mjs';

const companyId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const organization = { id: companyId, name: 'Fiktiv registertest', organisation_number: 'Fiktivt företag' };
const membership = { company_id: companyId, role: 'owner', companies: organization };
const inventory = Array.from({ length: 551 }, (_, index) => ({
  id: `fictional-stock-${index}`, status: index % 2 ? 'reserved' : 'available', acquired_on: '2026-10-15', purchase_price_ore: 15000000,
  asking_price_ore: 19900029 + index, vat_scheme: 'unknown',
  vehicles: { id: `fictional-vehicle-${index}`, registration_number: `FIKTIV${index}`, make: 'Fiktiv', model: `Modell ${index}`, model_year: 2022, mileage_km: 48000, fuel: 'hybrid', gearbox: 'automatic' },
}));
const customers = inventory.map((_, index) => ({ id: `fictional-customer-${index}`, name: `Fiktiv kund ${index}`, email: `kund${index}@example.invalid`, phone: null, kind: index % 2 ? 'business' : 'person', address: null, notes: null, created_at: '2026-10-15T12:00:00Z' }));
const snapshot = {
  user: { id: actorId, email: 'demo@example.invalid' }, organization, membership, memberships: [membership], inventory, customers,
  deals: inventory.map((stock, index) => ({ id: `fictional-deal-${index}`, customer_id: customers[index].id, stock_item_id: stock.id, sale_price_ore: stock.asking_price_ore, status: 'draft', created_at: '2026-10-15T12:00:00Z' })),
  vehicle_costs: [], finance_applications: [], documents: [], activities: [], finance_partners: [], dealer_approvals: [], integrations: [],
};

async function harness() {
  const reads = [], costReads = [];
  const loader = await createSourceLoader({
    '@/lib/data/register-actions': { loadDealerRegisterPage: async input => { reads.push(input); throw new Error('A server render must not invoke a browser read.'); } },
    '@/lib/data/vehicle-cost-actions': { loadVehicleCosts: async input => { costReads.push(input); throw new Error('Costs must be read only for an opened vehicle.'); } },
    '@/lib/data/actions': new Proxy({}, { get: () => () => { throw new Error('SSR must not mutate data.'); } }),
    'next/dynamic': () => () => null,
    'next/link': ({ children, ...props }) => createElement('a', props, children),
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    './stock-import': { StockImport: () => null },
    './deal-form': { DealForm: () => null },
    './deal-offers': { DealOffers: () => null },
    './deal-trade-ins': { DealTradeIns: () => null },
    './deal-cancellation': { DealCancellation: () => null },
    './customer-leads': { CustomerLeads: () => null },
  });
  return { reads, costReads, DealerWorkspace: loader.load('src/components/dealer-workspace.tsx').DealerWorkspace };
}

test('actual live register SSR never presents sampled rows or sample counts as a complete or empty register', async () => {
  const { DealerWorkspace, reads, costReads } = await harness();
  for (const section of ['inventory', 'customers', 'deals']) {
    const html = renderToStaticMarkup(createElement(DealerWorkspace, { snapshot, section }));
    assert.ok(html.includes('från hela registret…'));
    assert.ok(html.includes('Antalet visas när registret har verifierats.'));
    assert.equal(html.includes('Fiktiv kund 0'), false);
    assert.equal(html.includes('FIKTIV0'), false);
    assert.equal(html.includes('551 bilar totalt'), false);
    assert.equal(html.includes('har registrerats ännu'), false);
  }
  assert.deepEqual(reads, []); assert.deepEqual(costReads, []);
});

test('actual demo register tables page at 50 and count all 551 fictional rows without external reads', async () => {
  const { DealerWorkspace, reads, costReads } = await harness();
  for (const [section, noun] of [['inventory', 'bilar'], ['customers', 'kunder'], ['deals', 'affärer']]) {
    const html = renderToStaticMarkup(createElement(DealerWorkspace, { snapshot, section, demo: true }));
    assert.ok(html.includes(`Visar 50 av 551 träffar · 551 ${noun} totalt`));
    assert.equal((html.match(/<tbody>/g) ?? []).length, 1);
    const tableRows = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
    assert.equal((tableRows.match(/<tr>/g) ?? []).length, 50);
    assert.ok(html.includes('Sida 1'));
    assert.ok(html.includes('endast fiktiva exempeldata'));
    assert.equal(html.includes('FIKTIV550'), false);
  }
  assert.deepEqual(reads, []); assert.deepEqual(costReads, []);
});

test('demo inventory keeps exact öre, verified company-wide filter counts and all page controls', async () => {
  const { DealerWorkspace } = await harness();
  const html = renderToStaticMarkup(createElement(DealerWorkspace, { snapshot, section: 'inventory', demo: true }));
  assert.ok(html.includes('199 000,29 kr'));
  assert.ok(html.includes('Tillgängliga (276)')); assert.ok(html.includes('Reserverade (275)'));
  for (const label of ['Lagerstatus', 'Sortera bilar', 'Tidigare', 'Nästa', 'Uppdatera']) assert.ok(html.includes(label), label);
});
