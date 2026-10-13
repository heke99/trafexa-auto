import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium: playwright, expect } = require('@playwright/test');
const Chromium = require('@sparticuz/chromium').default;
const { webpack } = require('next/dist/compiled/webpack/webpack');
const repo = fileURLToPath(new URL('../', import.meta.url));
const helpers = resolve(repo, 'tests/helpers/offer-archive-ui');
const company = '10000000-0000-4000-8000-000000000001';
const otherCompany = '10000000-0000-4000-8000-000000000002';
const deal = '20000000-0000-4000-8000-000000000001';
const offer = '30000000-0000-4000-8000-000000000001';
const otherOffer = '30000000-0000-4000-8000-000000000002';
const document = '40000000-0000-4000-8000-000000000001';
const offers = [offer, otherOffer].map((id, index) => ({ id, version: index + 1, createdAt: '2026-10-13T12:00:00Z', validUntil: '2026-11-12', salePriceOre: '25000000', vatScheme: 'standard' }));
const archiveLabel = 'Spara i dokumentarkivet';
let browser, directory, bundle;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-offer-ui-'));
  bundle = resolve(directory, 'fixture.js');
  const actions = resolve(helpers, 'actions.js');
  const unrelated = resolve(helpers, 'unrelated.js');
  const config = {
    mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
      '@/lib/data/offer-actions': actions, '@/lib/data/offer-archive-actions': actions, '@/lib/data/actions': actions,
      'next/link': unrelated,
      [resolve(repo, 'src/components/stock-import')]: unrelated,
      [resolve(repo, 'src/components/customer-leads')]: unrelated,
      [resolve(repo, 'src/components/company-team')]: unrelated,
    } },
    module: { rules: [{ test: /\.tsx?$/, use: resolve(helpers, 'swc-loader.cjs') }] },
  };
  await new Promise((resolveBuild, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true })));
      else resolveBuild();
    }));
  });
  browser = await playwright.launch({
    executablePath: await Chromium.executablePath(),
    // Separate Playwright contexts must survive closing earlier fixture pages.
    args: Chromium.args.filter((argument) => argument !== '--single-process'), headless: true,
  });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

function workspace(role, companyId = company) {
  const organization = { id: companyId, name: 'Fixture dealer', organisation_number: '1234567890' };
  const membership = { company_id: companyId, role, companies: organization };
  return { user: { id: '50000000-0000-4000-8000-000000000001', email: 'fixture@example.test' }, organization,
    membership, memberships: [membership], inventory: [], vehicle_costs: [], customers: [],
    deals: [{ id: deal, status: 'draft', sale_price_ore: 25000000, customer_id: 'fixture-customer', stock_item_id: 'fixture-stock', created_at: '2026-10-13T12:00:00Z' }],
    finance_applications: [], documents: [], activities: [], finance_partners: [], dealer_approvals: [], integrations: [] };
}
async function setup(props = {}, responses = []) {
  const page = await browser.newPage();
  // Any accidental HTTP request fails; all actions are deliberately local fixtures.
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(({ offers, responses, document }) => {
    let ids = 0;
    // about:blank has no secure-origin randomUUID. Use deterministic UUIDs only in this fixture.
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `60000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });
    window.fixture = { offers, responses, listCalls: [], archiveCalls: [], deferred: [],
      proof: (input) => ({ ok: true, message: 'Privat arkiverad. Offerten är inte signerad.', offerId: input.offerId, companyId: input.companyId, documentId: document, status: 'archived' }) };
  }, { offers, responses, document });
  await page.addScriptTag({ path: bundle });
  await page.evaluate((props) => window.mountArchiveFixture(props), { dealId: deal, companyId: company, canCreate: false, canArchive: true, ...props });
  await expect(page.getByRole('region')).toHaveCount(0);
  await page.locator('summary').click();
  await expect(page.getByRole('region')).toBeVisible();
  if (!props.demo) await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
  return page;
}

test('actual DealerWorkspace maps owner/admin/finance archive rights and hides archive for sales/viewer/demo', async () => {
  for (const role of ['owner', 'admin', 'finance', 'sales', 'viewer']) {
    const page = await setup({ workspace: true, snapshot: workspace(role) });
    try {
      await expect(page.getByRole('button', { name: archiveLabel })).toHaveCount(['owner', 'admin', 'finance'].includes(role) ? 2 : 0);
      assert.equal(await page.evaluate(() => window.fixture.archiveCalls.length), 0);
    } finally { await page.close(); }
  }
  const page = await setup({ workspace: true, snapshot: workspace('owner'), demo: true });
  try {
    await expect(page.getByRole('button', { name: archiveLabel })).toHaveCount(0);
    await expect(page.getByText(/Demoläge · läsvisning/)).toBeVisible();
    assert.equal(await page.evaluate(() => window.fixture.listCalls.length + window.fixture.archiveCalls.length), 0);
  } finally { await page.close(); }
});

test('failed archive retry keeps the same UUID for the same offer and renders only a verified document link', async () => {
  const page = await setup({}, [{ throw: true }]);
  try {
    await page.getByRole('button', { name: archiveLabel }).first().click();
    await expect(page.getByRole('alert')).toContainText('Arkiveringen kunde inte bekräftas');
    await expect(page.getByRole('link', { name: 'Hämta arkiverad PDF' })).toHaveCount(0);
    await page.getByRole('button', { name: archiveLabel }).first().click();
    await expect(page.getByRole('link', { name: 'Hämta arkiverad PDF' })).toHaveAttribute('href', `/api/documents/${document}/pdf`);
    await expect(page.getByRole('status')).toContainText('inte signerad');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: archiveLabel }).click();
    await expect(page.getByRole('link', { name: 'Hämta arkiverad PDF' })).toHaveCount(2);
    const calls = await page.evaluate(() => window.fixture.archiveCalls);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].offerId, offer);
    assert.equal(calls[0].companyId, company);
    assert.match(calls[0].submissionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(calls[2].offerId, otherOffer);
    assert.notEqual(calls[2].submissionId, calls[0].submissionId);
  } finally { await page.close(); }
});

test('DealOffers in demo mode stays read-only even with archive permission and seeded offers', async () => {
  const page = await setup({ demo: true, canArchive: true, canCreate: true, demoOffers: offers });
  try {
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: archiveLabel })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Skapa ny offertversion' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /PDF/ })).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.fixture.listCalls.length + window.fixture.archiveCalls.length), 0);
  } finally { await page.close(); }
});

test('incomplete, wrong-company, wrong-offer and wrong-status archive proofs never become download links', async () => {
  for (const overrides of [{ companyId: otherCompany }, { offerId: otherOffer }, { status: 'signed' }, { documentId: null }, { ok: false }]) {
    const response = { ok: true, message: 'Unverified fixture response', companyId: company, offerId: offer, status: 'archived', documentId: document, ...overrides };
    const page = await setup({}, [response]);
    try {
      await page.getByRole('button', { name: archiveLabel }).first().click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Hämta arkiverad PDF' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: archiveLabel }).first()).toBeEnabled();
    } finally { await page.close(); }
  }
});

for (const outcome of ['resolve', 'reject']) test(`late archive ${outcome} from the old company is ignored after an in-place workspace company switch`, async () => {
  const page = await setup({ workspace: true, snapshot: workspace('owner') }, [{ defer: true }]);
  try {
    await page.getByRole('button', { name: archiveLabel }).first().click();
    await expect.poll(() => page.evaluate(() => window.fixture.deferred.length)).toBe(1);
    await expect(page.getByRole('button', { name: archiveLabel }).first()).toBeDisabled();
    await page.evaluate((snapshot) => window.mountArchiveFixture({ workspace: true, snapshot }), workspace('owner', otherCompany));
    await expect.poll(() => page.evaluate(() => window.fixture.listCalls.at(-1)?.companyId)).toBe(otherCompany);
    await page.evaluate((outcome) => {
      if (outcome === 'resolve') window.fixture.deferred[0].resolve(window.fixture.proof(window.fixture.archiveCalls[0]));
      else window.fixture.deferred[0].reject(new Error('Old-company transport failure'));
    }, outcome);
    await expect(page.getByRole('button', { name: archiveLabel }).first()).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Hämta arkiverad PDF' })).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: archiveLabel }).first().click();
    await expect(page.getByRole('link', { name: 'Hämta arkiverad PDF' })).toBeVisible();
    const calls = await page.evaluate(() => window.fixture.archiveCalls);
    assert.equal(calls[1].companyId, otherCompany);
    assert.notEqual(calls[0].submissionId, calls[1].submissionId);
  } finally { await page.close(); }
});
