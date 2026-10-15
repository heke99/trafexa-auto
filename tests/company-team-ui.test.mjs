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
const helpers = resolve(repo, 'tests/helpers/company-team-ui');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPANY = id(1), ACTOR = id(2), MEMBER = id(3), INVITATION = id(9);
const member = (n, role = 'sales', email = `colleague${n}@example.com`) => ({ id: id(n), userId: id(n + 100), email, role, status: 'active', version: 3, createdAt: '2026-10-13T18:00:00Z' });
const team = () => ({ companyId: COMPANY, actorUserId: ACTOR, actorRole: 'owner', teamVersion: 5, members: [member(3)], invitations: [], nextMembersPageKey: null, nextInvitationsPageKey: null });
const invitation = () => ({ id: INVITATION, companyId: COMPANY, companyName: 'Fixture AB <script>alert(1)</script>', email: 'colleague@example.com', role: 'sales', status: 'pending', version: 4, expiresAt: '2099-10-20T18:00:00Z', createdAt: '2099-10-13T18:00:00Z' });
let browser, directory, bundle, styles;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-team-ui-'));
  bundle = resolve(directory, 'fixture.js');
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = {
    mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js', publicPath: '' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/company-team/actions': resolve(helpers, 'actions.js'), '@/lib/company-ownership/actions': resolve(repo, 'tests/helpers/company-ownership-ui/actions.js'), 'next/navigation': resolve(repo, 'tests/helpers/company-ownership-ui/navigation.js'), '@': resolve(repo, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, use: resolve(helpers, 'swc-loader.cjs') }] },
  };
  await new Promise((resolveBuild, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true })));
      else resolveBuild();
    }));
  });
  browser = await playwright.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(argument => argument !== '--single-process'), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function setup({ invitations = false, strict = false, companyRole = 'owner', state = team(), ...overrides } = {}) {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
  await page.evaluate(({ state, overrides }) => {
    let ids = 0;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `20000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });
    window.fixture = { team: state, myInvitations: [], teamCalls: [], myCalls: [], updateCalls: [], inviteCalls: [], cancelCalls: [], acceptCalls: [],
      teamResponses: [], myResponses: [], updateResponses: [], inviteResponses: [], cancelResponses: [], acceptResponses: [], ...overrides };
  }, { state, overrides });
  await page.addScriptTag({ path: bundle });
  await page.evaluate(props => window.mountTeamFixture(props), { invitations, strict, companyId: COMPANY, companyRole, userId: ACTOR });
  await expect(page.getByRole('status').filter({ hasText: 'Verifierar' })).toHaveCount(0);
  return page;
}

test('actual member controls require review and reason, retain nonce after unknown write, then read current membership', async () => {
  const page = await setup({ updateResponses: [{ throw: true }] });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /Hantera medlem/ }).click();
    await page.getByLabel('Ny roll').selectOption('viewer');
    await page.getByLabel('Ny status').selectOption('suspended');
    await expect(page.getByRole('button', { name: 'Granska ändring', exact: true })).toBeDisabled();
    await page.getByLabel('Motivering (obligatorisk)').fill('Ogiltig\u007ftext');
    await expect(page.getByRole('button', { name: 'Granska ändring', exact: true })).toBeDisabled();
    await page.getByLabel('Motivering (obligatorisk)').fill('Byter arbetsuppgifter');
    await page.getByRole('button', { name: 'Granska ändring', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Bekräfta ändringen' })).toBeFocused();
    assert.equal(await page.evaluate(() => window.fixture.updateCalls.length), 0);
    const confirmBox = await page.getByRole('button', { name: 'Bekräfta behörighetsändring' }).boundingBox();
    assert.ok(confirmBox && confirmBox.x >= 0 && confirmBox.x + confirmBox.width <= 390);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
    await page.getByRole('button', { name: 'Bekräfta behörighetsändring' }).click();
    await expect(page.getByRole('alert')).toContainText('samma uppgifter');
    await page.getByRole('button', { name: 'Bekräfta behörighetsändring' }).click();
    await expect(page.getByRole('cell', { name: 'Avstängd', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Läsbehörighet', exact: true })).toBeVisible();
    const calls = await page.evaluate(() => window.fixture);
    assert.equal(calls.updateCalls.length, 2); assert.deepEqual(calls.updateCalls[0], calls.updateCalls[1]);
    assert.deepEqual(Object.keys(calls.updateCalls[0]).sort(), ['companyId', 'expectedVersion', 'membershipId', 'reason', 'requestId', 'role', 'status']);
    assert.equal(calls.updateCalls[0].membershipId, MEMBER); assert.equal(calls.updateCalls[0].expectedVersion, 3);
    assert.equal(calls.teamCalls.length, 2); assert.equal(calls.teamCalls[1].limit, 50);
  } finally { await page.close(); }
});

test('fresh revoked access after a historical receipt clears names, invitations and review controls', async () => {
  const initial = team(); initial.invitations = [invitation()];
  const page = await setup({ state: initial, teamResponses: [{ ok: true, ...initial }, { ok: false, code: 'access_denied', message: 'Behörigheten har återkallats.' }] });
  try {
    await page.getByRole('button', { name: /Hantera medlem/ }).click();
    await page.getByLabel('Ny status').selectOption('suspended');
    await page.getByLabel('Motivering (obligatorisk)').fill('Avslutar uppdrag');
    await page.getByRole('button', { name: 'Granska ändring', exact: true }).click();
    await page.getByRole('button', { name: 'Bekräfta behörighetsändring' }).click();
    await expect(page.getByRole('alert')).toContainText('återkallats');
    await expect(page.getByText('colleague3@example.com', { exact: true })).toHaveCount(0);
    await expect(page.getByText('colleague@example.com', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Hantera medlem|Spara inbjudan|Bekräfta behörighetsändring/ })).toHaveCount(0);
    await expect(page.getByText('Listan har lästs in på nytt', { exact: false })).toHaveCount(0);
  } finally { await page.close(); }
});

test('actual fresh actor gates owner, self and admin peers, and allows only lower invitation roles', async () => {
  const state = team(); state.actorRole = 'admin'; state.members = [member(4, 'owner'), { ...member(5, 'admin'), userId: ACTOR }, member(6, 'admin'), member(7)];
  const page = await setup({ companyRole: 'admin', state });
  try {
    await expect(page.getByRole('button', { name: /Hantera medlem/ })).toHaveCount(1);
    await expect(page.getByRole('cell', { name: 'Skyddad behörighet', exact: true })).toHaveCount(3);
    const choices = await page.getByLabel('Roll för kollegan').locator('option').allTextContents();
    assert.deepEqual(choices, ['Säljare', 'Finansansvarig', 'Läsbehörighet']);
    assert.equal(await page.evaluate(() => window.fixture.updateCalls.length), 0);
  } finally { await page.close(); }
});

test('invitation saves only reviewed address/role/team version and shows a generic link without tokens; cancel requires reason', async () => {
  const state = team(); state.invitations = [invitation()];
  const page = await setup({ state });
  try {
    await page.getByLabel('Kollegans e-postadress').fill('new@example.com');
    await page.getByLabel('Roll för kollegan').selectOption('finance');
    await page.getByRole('button', { name: 'Granska inbjudan', exact: true }).click();
    await page.getByRole('button', { name: 'Granska ändring', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixture.inviteCalls.length), 0);
    await page.getByRole('button', { name: 'Spara inbjudan' }).click();
    const link = page.getByRole('link', { name: 'https://app.trafexa.com/invitations', exact: true });
    await expect(link).toHaveAttribute('href', 'https://app.trafexa.com/invitations');
    await expect(page.getByText('Inbjudan gäller i sju dagar.', { exact: false })).toBeVisible();
    const input = await page.evaluate(() => window.fixture.inviteCalls[0]);
    assert.deepEqual(Object.keys(input).sort(), ['companyId', 'email', 'expectedTeamVersion', 'requestId', 'role']);
    assert.equal(input.email, 'new@example.com'); assert.equal(input.role, 'finance'); assert.equal(input.expectedTeamVersion, 5);
    await page.getByRole('button', { name: /Återkalla inbjudan/ }).click();
    await expect(page.getByRole('button', { name: 'Granska ändring', exact: true })).toBeDisabled();
    await page.getByLabel('Motivering (obligatorisk)').fill('Fel adress');
    await page.getByRole('button', { name: 'Granska ändring', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixture.cancelCalls.length), 0);
    await page.getByRole('button', { name: 'Bekräfta återkallande' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Listan har lästs in på nytt' })).toBeVisible();
    const cancelled = await page.evaluate(() => window.fixture.cancelCalls[0]);
    assert.equal(cancelled.invitationId, INVITATION); assert.equal(cancelled.expectedVersion, 4); assert.equal(cancelled.reason, 'Fel adress');
  } finally { await page.close(); }
});

test('own invitation mount reads only, names stay plain text, explicit accept keeps nonce and reloads before dashboard link', async () => {
  const page = await setup({ invitations: true, myInvitations: [invitation()], acceptResponses: [{ throw: true }] });
  try {
    await expect(page.getByRole('cell', { name: 'Fixture AB <script>alert(1)</script>', exact: true })).toBeVisible();
    assert.equal(await page.locator('table script').count(), 0);
    assert.equal(await page.evaluate(() => window.fixture.acceptCalls.length), 0);
    await page.getByRole('button', { name: /Granska inbjudan från/ }).click();
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse' }).click();
    assert.equal(await page.evaluate(() => window.fixture.acceptCalls.length), 0);
    await page.getByRole('button', { name: 'Acceptera inbjudan', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('samma begäran');
    await page.getByRole('button', { name: 'Acceptera inbjudan', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Öppna företaget', exact: true })).toHaveAttribute('href', '/dashboard');
    await expect(page.getByRole('heading', { name: 'Inga väntande inbjudningar' })).toBeVisible();
    const calls = await page.evaluate(() => window.fixture);
    assert.equal(calls.acceptCalls.length, 2); assert.deepEqual(calls.acceptCalls[0], calls.acceptCalls[1]);
    assert.deepEqual(Object.keys(calls.acceptCalls[0]).sort(), ['expectedVersion', 'invitationId', 'requestId']);
    assert.equal(calls.acceptCalls[0].expectedVersion, 4); assert.equal(calls.myCalls.length, 2);
    assert.equal(calls.teamCalls.length, 0); assert.equal(calls.updateCalls.length, 0);
  } finally { await page.close(); }
});


test('Strict Mode mount retains a usable fresh list and never performs a mutation', async () => {
  const page = await setup({ strict: true });
  try {
    await expect(page.getByRole('button', { name: /Hantera medlem/ })).toBeVisible();
    await page.getByRole('button', { name: 'Uppdatera teamet', exact: true }).click();
    await expect(page.getByRole('button', { name: /Hantera medlem/ })).toBeVisible();
    const calls = await page.evaluate(() => window.fixture);
    assert.ok(calls.teamCalls.length >= 2);
    assert.equal(calls.updateCalls.length + calls.inviteCalls.length + calls.cancelCalls.length + calls.acceptCalls.length, 0);
  } finally { await page.close(); }
});

test('page size stays bounded and finishing one cursor does not restart the exhausted list', async () => {
  const initial = team(); initial.nextInvitationsPageKey = 'page-2';
  const next = { ...team(), members: [member(30)], invitations: [invitation()], nextInvitationsPageKey: null };
  const page = await setup({ state: initial, teamResponses: [{ ok: true, ...initial }, { ok: true, ...next }] });
  try {
    await page.getByRole('button', { name: 'Läs in fler', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'colleague@example.com', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Läs in fler', exact: true })).toHaveCount(0);
    await expect(page.getByText('colleague30@example.com', { exact: true })).toHaveCount(0);
    const calls = await page.evaluate(() => window.fixture.teamCalls);
    assert.equal(calls[1].limit, 50); assert.equal(calls[1].membersPageKey, null); assert.equal(calls[1].invitationsPageKey, 'page-2');
  } finally { await page.close(); }
});

test('revoked acceptance cannot expose a dashboard success link or retain invitation company data', async () => {
  const page = await setup({ invitations: true, myInvitations: [invitation()], acceptResponses: [{ ok: false, code: 'access_denied', message: 'Inbjudan eller åtkomsten har återkallats.' }] });
  try {
    await page.getByRole('button', { name: /Granska inbjudan från/ }).click();
    await page.getByRole('button', { name: 'Fortsätt till bekräftelse' }).click();
    await page.getByRole('button', { name: 'Acceptera inbjudan', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('återkallats');
    await expect(page.getByRole('link', { name: 'Öppna företaget', exact: true })).toHaveCount(0);
    await expect(page.getByText('Fixture AB <script>alert(1)</script>', { exact: true })).toHaveCount(0);
  } finally { await page.close(); }
});
