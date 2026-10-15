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
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/advertising/invoice-email-actions': resolve(repo, 'tests/helpers/advertising-invoice-email-ui/actions.js'), '@/lib/advertising/invoice-email-send-actions': resolve(repo, 'tests/helpers/advertising-invoice-email-ui/send-actions.js'), '@/lib/advertising/credit-actions': resolve(repo, 'tests/helpers/advertising-credit-ui/actions.js'), '@/lib/advertising/issuance-actions': resolve(repo, 'tests/helpers/advertising-issuance-ui/actions.js'), '@/lib/advertising/financial-actions': resolve(repo, 'tests/helpers/advertising-financial-ui/actions.js'), '@/lib/advertising/invoice-actions': resolve(repo, 'tests/helpers/advertising-invoice-ui/actions.js'), '@/lib/advertising/correction-actions': resolve(repo, 'tests/helpers/advertising-corrections-ui/actions.js'), '@/lib/advertising/billing-actions': resolve(repo, 'tests/helpers/advertising-billing-ui/actions.js'), '@/lib/calculations/vehicle-calculation': resolve(repo, 'src/lib/calculations/vehicle-calculation.ts'), '@/lib/advertising/usage-actions': resolve(repo, 'tests/helpers/advertising-usage-ui/actions.js'), '@/lib/advertising/actions': resolve(helpers, 'actions.js'), '@/components/vehicle-photo-gallery': resolve(repo, 'src/components/vehicle-photo-gallery.tsx'), '@/lib/vehicle-photos/actions': resolve(helpers, 'photos.js'), '@/lib/vehicle-photos/types': resolve(repo, 'src/lib/vehicle-photos/types.ts') } },
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
      listings: [], jobs: [], channels: [], photos: [], listCalls: [], stockCalls: [], detailCalls: [], photoCalls: [], createCalls: [], saveCalls: [], readyCalls: [], sendCalls: [], connectionCalls: [], quoteCalls: [],
      listResponses: [], detailResponses: [], createResponses: [], saveResponses: [], readyResponses: [], sendResponses: [], connectionResponses: [], quoteResponses: [], prices: { blocket: '14950', wayke: '9950' }, quoteToken: 'a'.repeat(64), alreadyPublished: [], ...overrides };
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
    assert.equal(calls.sendCalls[0].expectedQuoteToken, 'a'.repeat(64));
    assert.equal(calls.quoteCalls.length, 2, 'retry must preserve reviewed quote instead of silently refreshing it');
    assert.deepEqual(Object.keys(calls.sendCalls[0]).sort(), ['channels', 'companyId', 'expectedQuoteToken', 'expectedVersion', 'listingId', 'requestId']);
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


const readyChannels = ['blocket', 'wayke'].map(channel => ({ channel, status: 'verified', accountReference: `dealer-${channel}`, dispatcherAvailable: true }));
async function openSend(page) { await chooseStock(page); await page.getByRole('button', { name: 'Förbered kanalutskick', exact: true }).click(); await expect(page.getByText('Verifierar kanalpriser…', { exact: true })).toHaveCount(0); }

test('sales sees both per-channel prices, selected exact total and a fresh final price before explicit send', async () => {
  const page = await setup({ role: 'sales', listings: [listing()], photos: [photo()], channels: readyChannels });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSend(page);
    await expect(page.getByText('149,50 kr exkl. moms per unik publicering', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Blocket', { exact: true })).toHaveAccessibleDescription('149,50 kr exkl. moms per unik publicering');
    await expect(page.getByText('99,50 kr exkl. moms per unik publicering', { exact: true })).toBeVisible();
    await page.getByLabel('Blocket', { exact: true }).check();
    await page.getByLabel('Wayke', { exact: true }).check();
    await expect(page.getByText('Summa för valda kanaler: 249,00 kr exkl. moms', { exact: true })).toBeVisible();
    await page.evaluate(() => { window.fixture.prices = { blocket: '19950', wayke: '10000' }; window.fixture.quoteToken = 'b'.repeat(64); });
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true }).click();
    await expect(page.getByText('199,50 kr exkl. moms per unik publicering', { exact: true })).toBeVisible();
    await expect(page.getByText('Summa för valda kanaler: 299,50 kr exkl. moms', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.fixture.sendCalls.length), 0);
    await expect(page.getByRole('button', { name: 'Visa statistik och faktureringsunderlag' })).toHaveCount(0);
    await page.evaluate(() => { window.fixture.prices.blocket = '30000'; });
    await page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true }).click();
    const calls = await page.evaluate(() => window.fixture);
    assert.deepEqual(calls.quoteCalls.map(call => call.channels), [['blocket', 'wayke'], ['blocket', 'wayke']]);
    assert.equal(calls.sendCalls[0].expectedQuoteToken, 'b'.repeat(64));
    assert.deepEqual(calls.sendCalls[0].channels, ['blocket', 'wayke']);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
    await expect(page.getByRole('status')).toContainText('299,50 kr');
  } finally { await page.close(); }
});

test('missing price disables even an already registered channel while explicit zero remains selectable', async () => {
  const page = await setup({ listings: [listing()], photos: [photo()], channels: readyChannels, prices: { blocket: null, wayke: '0' }, alreadyPublished: ['blocket'] });
  try {
    await openSend(page);
    await expect(page.getByLabel('Blocket', { exact: true })).toBeDisabled();
    await expect(page.getByText('Pris saknas · kanalen kan inte väljas', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Wayke', { exact: true })).toBeEnabled();
    await expect(page.getByText('0,00 kr exkl. moms per unik publicering', { exact: true })).toBeVisible();
    await page.getByLabel('Wayke', { exact: true }).check();
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true }).click();
    await page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true }).click();
    const calls = await page.evaluate(() => window.fixture);
    assert.deepEqual(calls.quoteCalls[1].channels, ['wayke']);
    assert.deepEqual(calls.sendCalls[0].channels, ['wayke']);
  } finally { await page.close(); }
});

test('already registered publication with a valid price basis shows no new charge', async () => {
  const page = await setup({ listings: [listing()], photos: [photo()], channels: readyChannels, prices: { blocket: '14950', wayke: '9950' }, alreadyPublished: ['blocket'] });
  try {
    await openSend(page);
    await expect(page.getByText('Ingen ny avgift · publiceringen är redan registrerad', { exact: true })).toBeVisible();
    await page.getByLabel('Blocket', { exact: true }).check();
    await expect(page.getByText('Summa för valda kanaler: 0,00 kr exkl. moms', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true }).click();
    await page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixture.sendCalls.length), 1);
  } finally { await page.close(); }
});

test('a SQL price conflict discards confirmation and requires a new visible quote and nonce', async () => {
  const page = await setup({ listings: [listing()], photos: [photo()], channels: readyChannels, sendResponses: [{ ok: false, code: 'conflict', message: 'Conflict' }] });
  try {
    await openSend(page);
    await page.getByLabel('Blocket', { exact: true }).check();
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true }).click();
    await page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('granska priset igen');
    await expect(page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true })).toHaveCount(0);
    await page.evaluate(() => { window.fixture.prices.blocket = '25000'; window.fixture.quoteToken = 'c'.repeat(64); });
    await page.getByRole('button', { name: 'Förbered kanalutskick', exact: true }).click();
    await page.getByLabel('Blocket', { exact: true }).check();
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true }).click();
    await expect(page.getByText('250,00 kr exkl. moms per unik publicering', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true }).click();
    const sends = await page.evaluate(() => window.fixture.sendCalls);
    assert.notEqual(sends[0].requestId, sends[1].requestId);
    assert.equal(sends[1].expectedQuoteToken, 'c'.repeat(64));
  } finally { await page.close(); }
});

test('denied or cross-actor quotes clear private content and never enable confirmation', async () => {
  for (const response of [{ ok: false, code: 'access_denied', message: 'Åtkomst återkallad' }, { ok: true, companyId: COMPANY, actorUserId: id(99), actorRole: 'owner', quote: {} }]) {
    const page = await setup({ listings: [listing()], photos: [photo()], channels: readyChannels, quoteResponses: [response] });
    try {
      await openSend(page);
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByText(listing().snapshot.title, { exact: true })).toHaveCount(0);
      await expect(page.locator('img')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Fortsätt till bekräftelse', exact: true })).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.fixture.sendCalls.length), 0);
    } finally { await page.close(); }
  }
});

test('late quote after company change cannot restore previous tenant prices or confirmation', async () => {
  const page = await setup({ listings: [listing()], photos: [photo()], channels: readyChannels, quoteResponses: [{ delay: true, result: { ok: false, code: 'unavailable', message: 'OLD QUOTE' } }] });
  try {
    await chooseStock(page);
    await page.getByRole('button', { name: 'Förbered kanalutskick', exact: true }).click();
    await expect(page.getByText('Verifierar kanalpriser…', { exact: true })).toBeVisible();
    await page.evaluate(({ companyId, userId }) => { window.fixture.companyId = companyId; window.fixture.listings = []; window.fixture.stock = []; window.mountAdvertisingFixture({ companyId, userId, role: 'owner' }); window.resolveAdvertisingQuote(); }, { companyId: id(90), userId: USER });
    await expect(page.getByText('OLD QUOTE', { exact: true })).toHaveCount(0);
    await expect(page.getByText(listing().snapshot.title, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bekräfta kanalutskick', exact: true })).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.fixture.sendCalls.length), 0);
  } finally { await page.close(); }
});
