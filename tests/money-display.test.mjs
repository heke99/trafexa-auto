import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSourceLoader } from './helpers/source-loader.mjs';

const prices = [19900029, 19900020, 19900000];
const organization = { id: 'demo-company', name: 'Fiktiv bilhandel', organisation_number: 'Fiktivt företag' };
const membership = { company_id: organization.id, role: 'owner', companies: organization };
const snapshot = {
  user: { id: 'demo-user', email: 'demo@example.invalid' }, organization, membership, memberships: [membership],
  inventory: prices.map((price, index) => ({
    id: `stock-${index}`, status: 'available', acquired_on: '2026-10-13', purchase_price_ore: 15000000,
    asking_price_ore: price, vat_scheme: 'standard',
    vehicles: { id: `vehicle-${index}`, registration_number: `TEST${index}`, make: 'Volvo', model: `V60 ${index}`, model_year: 2022, mileage_km: 48000, fuel: 'hybrid', gearbox: 'automatic' },
  })),
  customers: [{ id: 'customer', name: 'Fiktiv kund', email: null, phone: null, kind: 'person', address: null, notes: null, created_at: '2026-10-13' }],
  deals: prices.map((price, index) => ({ id: `deal-${index}`, customer_id: 'customer', stock_item_id: `stock-${index}`, sale_price_ore: price, status: 'draft', created_at: '2026-10-13' })),
  vehicle_costs: [], finance_applications: [], documents: [], activities: [], finance_partners: [], dealer_approvals: [], integrations: [],
};

async function render(section) {
  const loader = await createSourceLoader({
    '@/lib/data/actions': new Proxy({}, { get: () => () => { throw new Error('SSR must not invoke a server action.'); } }),
    './stock-import': { StockImport: () => null },
    './deal-offers': { DealOffers: () => null },
    './deal-cancellation': { DealCancellation: () => null },
    './deal-trade-ins': { DealTradeIns: () => null },
    'next/navigation': { useRouter: () => ({refresh(){}}) },
    './customer-leads': { CustomerLeads: () => null },
  });
  const { DealerWorkspace } = loader.load('src/components/dealer-workspace.tsx');
  return renderToStaticMarkup(createElement(DealerWorkspace, { snapshot, section, demo: true }));
}

function displayedPrices(html) {
  return [...html.matchAll(/<td class="numeric"[^>]*>([\s\S]*?)<\/td>/g)]
    .map((match) => match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
    .map((cell) => cell.match(/^(.+? kr)(?:\s|$)/)?.[1]);
}

test('actual inventory table preserves stored öre and keeps whole-krona prices without decimals', async () => {
  assert.deepEqual(displayedPrices(await render('inventory')), ['199 000,29 kr', '199 000,20 kr', '199 000 kr']);
});

test('actual deal table uses exact stored sale prices rather than rounding them to kronor', async () => {
  assert.deepEqual(displayedPrices(await render('deals')), ['199 000,29 kr', '199 000,20 kr', '199 000 kr']);
});
