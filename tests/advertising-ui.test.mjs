import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium: playwright, expect } = require('@playwright/test');
const Chromium = require('@sparticuz/chromium').default;
const { webpack } = require('next/dist/compiled/webpack/webpack');
const repo = fileURLToPath(new URL('../', import.meta.url));
const helpers = resolve(repo, 'tests/helpers/advertising-ui');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPANY = id(1), USER = id(2), STOCK = id(3), LISTING = id(4), PHOTO = id(5);
const photo = (n = 5, contentType = 'image/jpeg') => ({ id: id(n), contentType, sizeBytes: 1234, version: 1, status: 'active', createdAt: '2026-10-13T18:00:00Z' });
const listing = (status = 'ready', photos = [photo()]) => ({ id: LISTING, companyId: COMPANY, stockId: STOCK, version: 3, status, createdAt: '2026-10-13T18:00:00Z', updatedAt: '2026-10-13T18:00:00Z', snapshot: { title: 'Volvo V60 <script>alert(1)</script>', description: 'Välskött kombi', priceGrossOre: '28900000', make: 'Volvo', model: 'V60', year: 2022, mileageKm: 48200, fuel: 'petrol', transmission: 'automatic', photos, includeRegistrationNumber: false, registrationNumber: null } });
let browser, directory, bundle, styles;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-advertising-ui-'));
  bundle = resolve(directory, 'fixture.js');
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = { mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js', publicPath: '' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/advertising/financial-actions': resolve(repo, 'tests/helpers/advertising-financial-ui/actions.js'), '@/lib/advertising/invoice-actions': resolve(repo, 'tests/helpers/advertising-invoice-ui/actions.js'), '@/lib/advertising/correction-actions': resolve(repo, 'tests/helpers/advertising-corrections-ui/actions.js'), '@/lib/advertising/billing-actions': resolve(repo, 'tests/helpers/advertising-billing-ui/actions.js'), '@/lib/calculations/vehicle-calculation': resolve(repo, 'src/lib/calculations/vehicle-calculation.ts'), '@/lib/advertising/usage-actions': resolve(repo, 'tests/helpers/advertising-usage-ui/actions.js'), '@/lib/advertising/actions': resolve(helpers, 'actions.js'), '@/components/vehicle-photo-gallery': resolve(repo, 'src/components/vehicle-photo-gallery.tsx'), '@/lib/vehicle-photos/actions': resolve(helpers, 'photos.js'), '@/lib/vehicle-photos/types': resolve(repo, 'src/lib/vehicle-photos/types.ts') } },
    module: { rules: [{ test: /\.tsx?$/, use: resolve(helpers, 'swc-loader.cjs') }] } };
  await new Promise((resolveBuild, reject) => { const compiler = webpack(config); compiler.run((error, stats) => compiler.close(() => { if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolveBuild(); })); });
  browser = await playwright.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(argument => argument !== '--single-process'), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function setup({ strict = false, demo = false, role = 'owner', ...overrides } = {}) {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
  await page.evaluate(({ role, overrides }) => {
    let ids = 0;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `20000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });
    window.fixture = { companyId: '10000000-0000-4000-8000-000000000001', userId: '10000000-0000-4000-8000-000000000002', role,
      stock: [{ id: '10000000-0000-4000-8000-000000000003', make: 'Volvo', model: 'V60', year: 2022, priceGrossOre: '28900000', status: 'available' }],
      listings: [], jobs: [], channels: [], photos: [], listCalls: [], stockCalls: [], detailCalls: [], photoCalls: [], createCalls: [], saveCalls: [], readyCalls: [], sendCalls: [], connectionCalls: [],
      listResponses: [], detailResponses: [], createResponses: [], saveResponses: [], readyResponses: [], sendResponses: [], connectionResponses: [], ...overrides };
  }, { role, overrides });
  await page.addScriptTag({ path: bundle });
  await page.evaluate(props => window.mountAdvertisingFixture(props), { strict, demo, companyId: COMPANY, role, userId: USER });
  await expect(page.getByRole('status').filter({ hasText: 'Verifierar annonskontot' })).toHaveCount(0);
  return page;
}
async function chooseStock(page) { await page.getByLabel('Välj lagerbil').selectOption(STOCK); await expect(page.getByLabel('Annonstitel')).toBeVisible(); }

// These fixtures deliberately replace transport, never call providers or hosted Supabase, and block all page HTTP.
test('actual draft uses a real stock choice, server price and opt-in plate; saved version is previewed before ready confirmation', async () => {
  const page = await setup({ strict: true, photos: [photo()] });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await chooseStock(page);
    await expect(page.getByLabel('Ta med registreringsnummer i annonsen')).not.toBeChecked();
    await expect(page.locator('input[name="price"], input[type="number"]')).toHaveCount(0);
    await page.getByLabel('Annonstitel').fill('Volvo V60 med utrustning');
    await page.getByLabel('Annonsbeskrivning').fill('Välskött kombi\nServicebok finns');
    await page.getByLabel(/Bild 1 · JPEG/).check();
    await page.getByLabel('Ta med registreringsnummer i annonsen').check();
    await page.getByRole('button', { name: 'Skapa annonsutkast', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Granska annonsversion', exact: true })).toBeVisible();
    const payload = await page.evaluate(() => window.fixture.createCalls[0]);
    assert.deepEqual(Object.keys(payload).sort(), ['companyId', 'description', 'includeRegistrationNumber', 'photoIds', 'requestId', 'stockItemId', 'title']);
    assert.equal(payload.stockItemId, STOCK); assert.deepEqual(payload.photoIds, [PHOTO]); assert.equal(payload.includeRegistrationNumber, true);
    await page.getByRole('button', { name: 'Granska annonsversion', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Granska annonsversionen' })).toBeFocused();
    await expect(page.getByText('ABC123', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.fixture.readyCalls.length), 0);
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true }).click();
    const button = page.getByRole('button', { name: 'Markera annonsversion klar', exact: true });
    const box = await button.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
    await button.click();
    await expect(page.getByRole('cell', { name: 'Klar annonsversion', exact: true })).toBeVisible();
    const calls = await page.evaluate(() => window.fixture);
    assert.equal(calls.readyCalls.length, 1); assert.equal(calls.sendCalls.length, 0);
    assert.ok(calls.listCalls.length >= 3); assert.equal(calls.stockCalls.every(call => call.limit === 50), true);
  } finally { await page.close(); }
});

test('send freezes exact version and channels, keeps UUID after unknown response and renders fresh queued rather than published', async () => {
  const page = await setup({ listings: [listing()], photos: [photo()], channels: [{ channel: 'blocket', status: 'verified', accountReference: 'dealer-12', dispatcherAvailable: true }], sendResponses: [{ throw: true }] });
  try {
    await chooseStock(page);
    await page.getByRole('button', { name: 'Förbered kanalutskick', exact: true }).click();
    await expect(page.getByText('Delas inte', { exact: true })).toBeVisible();
    await expect(page.locator('section[aria-label="Låst annonsunderlag"] script')).toHaveCount(0);
    await page.getByLabel('Blocket', { exact: true }).check();
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixture.sendCalls.length), 0);
    await page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('samma annonsversion');
    await page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Köad för leverans', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Publicerad', exact: true })).toHaveCount(0);
    const calls = await page.evaluate(() => window.fixture);
    assert.deepEqual(calls.sendCalls[0], calls.sendCalls[1]);
    assert.deepEqual(Object.keys(calls.sendCalls[0]).sort(), ['channels', 'companyId', 'expectedVersion', 'listingId', 'requestId']);
    assert.equal(calls.sendCalls[0].expectedVersion, 3); assert.deepEqual(calls.sendCalls[0].channels, ['blocket']); assert.equal(calls.listCalls.length, 2);
    const imageSources = await page.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')));
    assert.equal(imageSources.every(source => source.startsWith('/api/vehicle-photos/')), true);
  } finally { await page.close(); }
});

test('disconnected channels offer a real connection request and never queue a delivery or declare activation', async () => {
  const page = await setup({ listings: [listing()], photos: [photo()] });
  try {
    await chooseStock(page);
    await page.getByRole('button', { name: 'Förbered kanalutskick', exact: true }).click();
    await expect(page.getByLabel('Blocket · anslutning krävs', { exact: true })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Anslut kanal', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true })).toBeDisabled();
    await page.getByLabel('Extern handlar- eller kontoreferens').fill('handlare-42');
    await page.getByRole('button', { name: 'Granska anslutningsförfrågan', exact: true }).click();
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true }).last().click();
    assert.equal(await page.evaluate(() => window.fixture.connectionCalls.length), 0);
    await page.getByRole('button', { name: 'Spara anslutningsförfrågan', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Anslutning begärd', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Verifierad anslutning', exact: true })).toHaveCount(0);
    const calls = await page.evaluate(() => window.fixture);
    assert.equal(calls.sendCalls.length, 0); assert.deepEqual(Object.keys(calls.connectionCalls[0]).sort(), ['accountReference', 'channel', 'companyId', 'requestId']);
    assert.equal(calls.connectionCalls[0].accountReference, 'handlare-42');
  } finally { await page.close(); }
});

test('WebP remains a private preview and disables a future Blocket send; read roles cannot edit or connect', async () => {
  const webp = photo(6, 'image/webp');
  const page = await setup({ listings: [listing('ready', [webp])], photos: [webp], channels: [{ channel: 'blocket', status: 'verified', accountReference: 'dealer-12', dispatcherAvailable: true }] });
  try {
    await chooseStock(page);
    await page.getByRole('button', { name: 'Förbered kanalutskick', exact: true }).click();
    await expect(page.getByLabel(/Blocket · vald WebP-bild stöds inte/)).toBeDisabled();
    await expect(page.getByText('Blocket kräver JPEG eller PNG.', { exact: false })).toBeVisible();
    assert.equal(await page.evaluate(() => window.fixture.sendCalls.length), 0);
  } finally { await page.close(); }
  const reader = await setup({ role: 'finance', listings: [listing()], photos: [photo()] });
  try {
    await chooseStock(reader);
    await expect(reader.getByLabel('Annonstitel')).toBeDisabled();
    await expect(reader.getByRole('button', { name: /Spara ny utkastversion|Förbered kanalutskick|Granska anslutningsförfrågan/ })).toHaveCount(0);
    await expect(reader.getByLabel('Extern handlar- eller kontoreferens')).toHaveCount(0);
  } finally { await reader.close(); }
});

test('fresh revoked access after historical send receipt clears listing, jobs, private previews and controls', async () => {
  const initial = { ok: true, companyId: COMPANY, actorUserId: USER, actorRole: 'owner', listings: [listing()], jobs: [], channels: [{ channel: 'blocket', status: 'verified', accountReference: 'dealer-12', dispatcherAvailable: true }], nextPageKey: null, nextJobsPageKey: null };
  const page = await setup({ listings: [listing()], photos: [photo()], channels: initial.channels, listResponses: [initial, { ok: false, code: 'access_denied', message: 'Åtkomsten till företaget har återkallats.' }] });
  try {
    await chooseStock(page);
    await page.getByRole('button', { name: 'Förbered kanalutskick', exact: true }).click();
    await page.getByLabel('Blocket', { exact: true }).check();
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true }).click();
    await page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('återkallats');
    await expect(page.getByText(listing().snapshot.title, { exact: true })).toHaveCount(0);
    await expect(page.locator('img')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Förbered kanalutskick|Bekräfta kanalutskick|Granska anslutningsförfrågan/ })).toHaveCount(0);
  } finally { await page.close(); }
});

test('demo performs no read or write and a stale heartbeat cannot be presented as ready for delivery', async () => {
  const demo = await setup({ demo: true, strict: true });
  try { assert.equal(await demo.evaluate(() => window.fixture.listCalls.length + window.fixture.stockCalls.length + window.fixture.sendCalls.length + window.fixture.connectionCalls.length), 0); } finally { await demo.close(); }
  const page = await setup({ listings: [listing()], photos: [photo()], channels: [{ channel: 'blocket', status: 'verified', accountReference: 'dealer-12', dispatcherAvailable: false }] });
  try {
    await chooseStock(page);
    await page.getByRole('button', { name: 'Förbered kanalutskick', exact: true }).click();
    await expect(page.getByLabel('Blocket · leverans ej aktiverad', { exact: true })).toBeDisabled();
    await expect(page.getByText('Kanalleverans ej aktiverad', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.fixture.sendCalls.length), 0);
  } finally { await page.close(); }
});
