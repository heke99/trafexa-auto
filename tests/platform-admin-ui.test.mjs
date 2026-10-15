import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createSourceLoader } from './helpers/source-loader.mjs';

const require = createRequire(import.meta.url);
const { chromium: playwright, expect } = require('@playwright/test');
const Chromium = require('@sparticuz/chromium').default;
const { webpack, LimitChunkCountPlugin } = require('next/dist/compiled/webpack/webpack');
const repo = fileURLToPath(new URL('../', import.meta.url));
const helpers = resolve(repo, 'tests/helpers/platform-admin-ui');
const COMPANY = '10000000-0000-4000-8000-000000000001';
const NEXT = '10000000-0000-4000-8000-000000000002';
const FILTERED = '10000000-0000-4000-8000-000000000003';
const makeCompany = (id = COMPANY, name = 'Fixture AB') => ({ id, name, organisationNumber: '5561234567', status: 'active', createdAt: '2026-10-13T18:00:00Z', membershipCount: 2, stockCount: 7 });
let browser, directory, bundle, styles;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-admin-ui-'));
  bundle = resolve(directory, 'fixture.js');
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = {
    plugins: [new LimitChunkCountPlugin({maxChunks:1})], mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js', publicPath: '' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/advertising/invoice-email-actions': resolve(repo, 'tests/helpers/advertising-invoice-email-ui/actions.js'), '@/lib/advertising/invoice-email-send-actions': resolve(repo, 'tests/helpers/advertising-invoice-email-ui/send-actions.js'), '@/lib/advertising/credit-actions': resolve(repo, 'tests/helpers/advertising-credit-ui/actions.js'), '@/lib/advertising/issuance-actions': resolve(repo, 'tests/helpers/advertising-issuance-ui/actions.js'), '@/lib/advertising/financial-actions': resolve(repo, 'tests/helpers/advertising-financial-ui/actions.js'), '@/lib/advertising/invoice-actions': resolve(repo, 'tests/helpers/advertising-invoice-ui/actions.js'), '@/lib/advertising/correction-actions': resolve(repo, 'tests/helpers/advertising-corrections-ui/actions.js'), '@/lib/advertising/billing-actions': resolve(repo, 'tests/helpers/advertising-billing-ui/actions.js'), '@/lib/calculations/vehicle-calculation': resolve(repo, 'src/lib/calculations/vehicle-calculation.ts'), '@/lib/advertising/usage-actions': resolve(repo, 'tests/helpers/advertising-usage-ui/actions.js'), '@/lib/advertising/actions': resolve(repo, 'tests/helpers/advertising-ui/actions.js'), '@/lib/platform-admin/actions': resolve(helpers, 'actions.js'), 'next/navigation': resolve(helpers, 'navigation.js'), '@/lib/platform-admin/overview-actions': resolve(helpers, 'overview-actions.js'), '@/lib/platform-admin/account-actions': resolve(helpers, 'account-actions.js') } },
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

async function setup({ activation = false, initialCompanies = [makeCompany()], nextPageKey = null, statusResponses = [], listResponses = [], contactResponses = [], application = null, detailResponses = [], applicationStatusResponses = [], eraseResponses = [], overviewResponses = [], overviewTab = false, accountRows = [], accountResponses = [], accountStatusResponses = [] } = {}) {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
  await page.evaluate(({ companies, statusResponses, listResponses, contactResponses, application, detailResponses, applicationStatusResponses, eraseResponses, overviewResponses, accountRows, accountResponses, accountStatusResponses }) => {
    let ids = 0;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `20000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });
    window.fixture = { accounts: accountRows, accountResponses, accountStatusResponses, accountListCalls: [], accountStatusCalls: [], companies, statusResponses, listResponses, contactResponses, application, detailResponses, applicationStatusResponses, eraseResponses, overviewResponses, overviewCalls: [], eraseCalls: [], detailCalls: [], applicationStatusCalls: [], statusCalls: [], listCalls: [], contactCalls: [], activationCalls: [], refreshes: 0 };
  }, { companies: initialCompanies, statusResponses, listResponses, contactResponses, application, detailResponses, applicationStatusResponses, eraseResponses, overviewResponses, accountRows, accountResponses, accountStatusResponses });
  await page.addScriptTag({ path: bundle });
  await page.evaluate(props => window.mountAdminFixture(props), { actorUserId: '30000000-0000-4000-8000-000000000001', activation, initialPage: { companies: initialCompanies, nextPageKey }, initialError: null });
  if (!activation && !overviewTab) await page.getByRole('button', { name: 'Företag', exact: true }).click();
  return page;
}

test('actual workspace requires review then confirmation, keeps nonce after unknown transport and reloads actual status', async () => {
  const page = await setup({ statusResponses: [{ throw: true }] });
  try {
    await page.getByRole('button', { name: /Hantera status/ }).click();
    await expect(page.getByRole('heading', { name: 'Ändra företagsstatus' })).toBeFocused();
    await page.getByLabel('Motivering (obligatorisk)').fill('Kontot granskas');
    await page.getByRole('button', { name: 'Granska ändring' }).click();
    await expect(page.getByRole('heading', { name: 'Bekräfta statusändring' })).toBeVisible();
    await expect(page.getByText('Kontot granskas', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.fixture.statusCalls.length), 0);
    await page.getByRole('button', { name: 'Bekräfta avstängning' }).click();
    await expect(page.getByRole('alert')).toContainText('Försök igen med samma uppgifter');
    await page.getByRole('button', { name: 'Bekräfta avstängning' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Statusändringen har registrerats' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Avstängt', exact: true })).toBeVisible();
    const { statusCalls, listCalls } = await page.evaluate(() => window.fixture);
    assert.equal(statusCalls.length, 2); assert.deepEqual(statusCalls[0], statusCalls[1]);
    assert.deepEqual(Object.keys(statusCalls[0]).sort(), ['companyId', 'expectedStatus', 'reason', 'requestId', 'status']);
    assert.match(statusCalls[0].requestId, /^20000000-0000-4000-8000-/);
    assert.equal(statusCalls[0].expectedStatus, 'active'); assert.equal(statusCalls[0].status, 'suspended');
    assert.deepEqual(listCalls, [{ search: '', limit: 50 }]);
  } finally { await page.close(); }
});

test('ordinary verified dealer is denied by actual server page and browser activation exposes no global data', async () => {
  const userId = '30000000-0000-4000-8000-000000000001';
  const serverCalls = [];
  function PlatformAdminActivation() {}
  const loader = await createSourceLoader({
    '@/lib/supabase/server': { async createServerSupabaseClient() { return {
      auth: { async getUser() { serverCalls.push('auth'); return { data: { user: { id: userId, email: 'info@trafexa.com', email_confirmed_at: '2026-10-13T18:00:00Z', is_anonymous: false, user_metadata: { role: 'owner' } } }, error: null }; } },
      async rpc(name) { serverCalls.push(name); assert.equal(name, 'get_platform_admin_session'); return { data: { is_platform_admin: false, user_id: userId }, error: null }; },
    }; } },
    '@/components/platform-admin-workspace': { PlatformAdminActivation, PlatformAdminWorkspace() { throw new Error('Dealer cannot receive admin data'); } },
    '@/lib/account-access/context': { async getAccountAccessContext() { return {emailVerified:true,status:'approved'}; } },
    'next/cache': { revalidatePath() { throw new Error('GET cannot write'); } },
    'next/navigation': { notFound() { throw new Error('Unexpected notFound'); }, redirect() { throw new Error('Unexpected redirect'); } },
  });
  const deniedPage = await loader.load('./src/app/admin/page.tsx').default();
  assert.equal(deniedPage.type, PlatformAdminActivation);
  assert.equal(serverCalls.includes('list_platform_companies'), false);
  const page = await setup({ activation: true });
  try {
    await expect(page.getByRole('heading', { name: 'Administratörsåtkomst krävs' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText('Fixture AB')).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => [window.fixture.listCalls.length, window.fixture.contactCalls.length, window.fixture.statusCalls.length, window.fixture.activationCalls.length]), [0, 0, 0, 0]);
    await page.getByRole('button', { name: 'Aktivera administratörsåtkomst' }).click();
    await expect(page.getByRole('alert')).toHaveText('Ingen administratörsåtkomst.');
    await expect(page.getByRole('table')).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.fixture.activationCalls), [{}]);
    assert.equal(await page.evaluate(() => window.fixture.refreshes), 0);
  } finally { await page.close(); }
});

test('search resets keyset pagination, load-more retains current query and contact denial clears cached company data', async () => {
  const page = await setup({ nextPageKey: COMPANY, listResponses: [
    { ok: true, companies: [makeCompany(NEXT, 'Andra AB')], nextPageKey: null },
    { ok: true, companies: [makeCompany(FILTERED, 'Sökträff AB')], nextPageKey: FILTERED },
    { ok: true, companies: [], nextPageKey: null },
  ] });
  try {
    await page.getByRole('button', { name: 'Läs in fler' }).click();
    await expect(page.getByText('Andra AB', { exact: true })).toBeVisible();
    await page.getByLabel('Sök företag eller organisationsnummer').fill('  Sökträff  ');
    await page.getByRole('button', { name: 'Sök', exact: true }).click();
    await expect(page.getByText('Sökträff AB', { exact: true })).toBeVisible();
    await expect(page.getByText('Fixture AB')).toHaveCount(0);
    await expect(page.getByText('Andra AB')).toHaveCount(0);
    await page.getByRole('button', { name: 'Läs in fler' }).click();
    await expect(page.getByRole('button', { name: 'Läs in fler' })).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.fixture.listCalls), [
      { search: '', pageKey: COMPANY, limit: 50 }, { search: 'Sökträff', pageKey: null, limit: 50 }, { search: 'Sökträff', pageKey: FILTERED, limit: 50 },
    ]);
    await page.getByRole('button', { name: 'Inkomna ansökningar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Ingen administratörsåtkomst.');
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText('Sökträff AB')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Företag', exact: true })).toBeDisabled();
  } finally { await page.close(); }
});

test('application details expose actual fields, review status with stable unknown nonce and clear revoked details', async () => {
 const application={id:COMPANY,name:'Test Person',email:'person@example.test',phone:'+46701234567',company:'Ansökan AB',organisationNumber:'5561234567',seeking:['system','advertising'],message:'Vi söker ett system.',status:'new',version:1,privacyVersion:'2026-10-14',privacyAcknowledgedAt:'2026-10-14T08:00:00Z',createdAt:'2026-10-14T08:00:00Z'};
 const page=await setup({application,contactResponses:[{ok:true,requests:[application],nextPageKey:null},{ok:false,code:'access_denied',message:'Ingen administratörsåtkomst.'}],applicationStatusResponses:[{throw:true}]});
 try {
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Inkomna ansökningar',exact:true}).click();
  await page.getByRole('button',{name:/Visa ansökan/}).click();
  await expect(page.getByRole('heading',{name:'Ansökan från Test Person'})).toBeVisible();
  await expect(page.locator('dd').filter({hasText:'5561234567'})).toBeVisible();
  await expect(page.locator('dd').filter({hasText:'Version 2026-10-14'})).toBeVisible();
  await page.getByLabel('Ny handläggningsstatus').selectOption('contacted');
  await page.getByLabel('Motivering för handläggning').fill('Vi har ringt kontaktpersonen.');
  await page.getByRole('button',{name:'Granska handläggningsstatus',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.applicationStatusCalls.length),0);
  await page.getByRole('button',{name:'Bekräfta handläggningsstatus'}).click();
  await expect(page.getByRole('alert')).toContainText('Försök igen med samma uppgifter');
  await page.getByRole('button',{name:'Bekräfta handläggningsstatus'}).click();
  await expect(page.getByRole('status').filter({hasText:'Ansökans status har registrerats.'})).toBeVisible();
  const calls=await page.evaluate(()=>window.fixture.applicationStatusCalls);
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].expectedVersion,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true);
  await page.getByRole('button',{name:'Uppdatera',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Ingen administratörsåtkomst.');
  await expect(page.getByText('person@example.test',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Ansökan från Test Person'})).toHaveCount(0);
 } finally {await page.close();}
});


test('permanent erasure needs separate review and confirmation, reuses unknown nonce and clears all displayed personal data',async()=>{
 const application={id:COMPANY,name:'Delete Person',email:'erase@example.test',phone:'+46709999999',company:'Delete AB',organisationNumber:'5561234567',seeking:['system'],message:'Personligt meddelande.',status:'new',version:7,privacyVersion:'2026-10-14',privacyAcknowledgedAt:'2026-10-14T08:00:00Z',createdAt:'2026-10-14T08:00:00Z'};
 const page=await setup({application,contactResponses:[{ok:true,requests:[application],nextPageKey:null},{ok:true,requests:[],nextPageKey:null}],eraseResponses:[{throw:true}]});
 try{
 await page.getByRole('button',{name:'Inkomna ansökningar',exact:true}).click();await page.getByRole('button',{name:/Visa ansökan/}).click();await page.getByRole('button',{name:'Radera personuppgifter',exact:true}).click();await page.getByLabel('Skäl för radering').selectOption('no_longer_needed');await page.getByRole('button',{name:'Granska radering',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixture.eraseCalls.length),0);await expect(page.getByRole('status').filter({hasText:'version 7'})).toBeVisible();await page.getByRole('button',{name:'Bekräfta permanent radering'}).click();await expect(page.getByRole('alert')).toContainText('Försök igen med samma uppgifter');await page.getByRole('button',{name:'Bekräfta permanent radering'}).click();await expect(page.getByRole('status').filter({hasText:'Personuppgifterna har raderats.'})).toBeVisible();const calls=await page.evaluate(()=>window.fixture.eraseCalls);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].expectedVersion,7);assert.equal(calls[0].reason,'no_longer_needed');await expect(page.getByText('erase@example.test',{exact:true})).toHaveCount(0);await expect(page.getByText('Personligt meddelande.',{exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Ansökan från Delete Person'})).toHaveCount(0);
 }finally{await page.close();}
});

test('erasure CAS conflict removes stale personal data and refetches before another decision',async()=>{
 const application={id:COMPANY,name:'Old Person',email:'old@example.test',phone:'+46709999999',company:'Old AB',organisationNumber:'5561234567',seeking:['system'],message:'Gammalt meddelande.',status:'new',version:1,privacyVersion:'2026-10-14',privacyAcknowledgedAt:'2026-10-14T08:00:00Z',createdAt:'2026-10-14T08:00:00Z'};
 const current={...application,name:'Current Person',email:'current@example.test',version:2};
 const page=await setup({application,contactResponses:[{ok:true,requests:[application],nextPageKey:null}],detailResponses:[{ok:true,application,audit:[]},{ok:true,application:current,audit:[]}],eraseResponses:[{ok:false,code:'conflict',message:'Ansökan har ändrats. Granska aktuell version.'}]});
 try{
 await page.getByRole('button',{name:'Inkomna ansökningar',exact:true}).click();await page.getByRole('button',{name:/Visa ansökan/}).click();await page.getByRole('button',{name:'Radera personuppgifter',exact:true}).click();await page.getByRole('button',{name:'Granska radering',exact:true}).click();await page.getByRole('button',{name:'Bekräfta permanent radering'}).click();await expect(page.getByRole('alert')).toHaveText('Ansökan har ändrats. Granska aktuell version.');await expect(page.getByRole('heading',{name:'Ansökan från Current Person'})).toBeVisible();await expect(page.getByText('old@example.test',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Bekräfta permanent radering'})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.fixture.detailCalls.length),2);assert.equal(await page.evaluate(()=>window.fixture.eraseCalls.length),1);
 }finally{await page.close();}
});


test('overview displays actual aggregate metrics, exact large money, seven-day activity and actionable navigation across mobile widths', async () => {
 const page = await setup({ overviewTab: true });
 try {
  await expect(page.getByRole('heading', {name:'Översikt över Trafexa'})).toBeVisible();
  await expect(page.getByText('90 071 992 547 409,93 kr')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(7);
  for (const width of [320,375,768,1440]) {
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await expect(page.getByRole('button',{name:'Uppdatera statistik',exact:true})).toBeVisible();
  }
  await page.screenshot({path:'/tmp/trafexa-admin-overview-desktop.png',fullPage:true});
  await page.setViewportSize({width:375,height:900});
  await page.screenshot({path:'/tmp/trafexa-admin-overview-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Hantera företag →'}).click();
  await expect(page.getByText('Fixture AB',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Översikt',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Översikt över Trafexa'})).toBeVisible();
 }finally{await page.close();}
});

test('overview refresh clears stale metrics on errors, retries and revocation clears all cached admin data',async()=>{
 const page=await setup({overviewTab:true,overviewResponses:[null,{throw:true},null,{ok:false,code:'access_denied',message:'Ingen administratörsåtkomst.'}]});
 try{
  await expect(page.getByText('90 071 992 547 409,93 kr')).toBeVisible();
  await page.getByRole('button',{name:'Uppdatera statistik',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Statistiken kunde inte läsas in');
  await expect(page.getByText('90 071 992 547 409,93 kr')).toHaveCount(0);
  await page.getByRole('button',{name:'Uppdatera statistik',exact:true}).click();
  await expect(page.getByText('90 071 992 547 409,93 kr')).toBeVisible();
  await page.getByRole('button',{name:'Uppdatera statistik',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Ingen administratörsåtkomst.');
  await expect(page.getByText('90 071 992 547 409,93 kr')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Företag',exact:true})).toBeDisabled();
  await expect(page.getByText('Fixture AB')).toHaveCount(0);
 }finally{await page.close();}
});

const makeAccount=(options={})=>({userId:'40000000-0000-4000-8000-000000000001',name:null,email:'new@example.invalid',emailVerified:true,createdAt:'2026-10-14T08:00:00Z',status:'pending',version:1,isPlatformAdmin:false,...options});
test('account approval requires review, keeps nonce for unknown outcome and refreshes the actual list after receipt',async()=>{
 const page=await setup({accountRows:[makeAccount()],accountStatusResponses:[{throw:true}]});
 try{
  await page.getByRole('button',{name:'Konton',exact:true}).click();
  await page.getByRole('button',{name:/Granska konto new/}).click();
  await page.getByLabel('Motivering för kontobeslut').fill('Identiteten och ansökan är granskade');
  await page.getByRole('button',{name:'Granska beslut',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.accountStatusCalls.length),0);
  await expect(page.getByRole('heading',{name:'Bekräfta kontobeslut'})).toBeFocused();
  await page.getByRole('button',{name:'Bekräfta kontobeslut',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('samma uppgifter');
  await page.getByRole('button',{name:'Bekräfta kontobeslut',exact:true}).click();
  await expect(page.getByText('Kontobeslutet har registrerats. Listan visar aktuell åtkomst.')).toBeVisible();
  const calls=await page.evaluate(()=>window.fixture.accountStatusCalls);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].expectedVersion,1);assert.equal(calls[0].status,'approved');assert.equal(calls[0].reason,'Identiteten och ansökan är granskade');
  await expect(page.getByRole('cell',{name:'new@example.invalid',exact:true})).toHaveCount(0);
  await page.getByLabel('Visa konton').selectOption('approved');await expect(page.getByRole('cell',{name:'Godkänt',exact:true})).toBeVisible();
 }finally{await page.close();}
});
test('unverified accounts cannot be approved and active platform administrators have protected access',async()=>{
 const page=await setup({accountRows:[makeAccount({emailVerified:false}),makeAccount({userId:'40000000-0000-4000-8000-000000000002',email:'admin@example.invalid',isPlatformAdmin:true})]});
 try{
  await page.getByRole('button',{name:'Konton',exact:true}).click();await page.getByRole('button',{name:/Granska konto new/}).click();await page.getByLabel('Motivering för kontobeslut').fill('Verifiering saknas');await expect(page.getByRole('button',{name:'Granska beslut',exact:true})).toBeDisabled();
  await page.getByLabel('Beslut',{exact:true}).selectOption('rejected');await expect(page.getByRole('button',{name:'Granska beslut',exact:true})).toBeEnabled();
  await expect(page.getByText('Skyddad administratörsåtkomst')).toBeVisible();await expect(page.getByRole('button',{name:/Granska konto admin/})).toHaveCount(0);
 }finally{await page.close();}
});
test('account access denial purges personal data and ignores a late account list after leaving the tab',async()=>{
 const page=await setup({accountRows:[makeAccount()],accountResponses:[{wait:true,result:{ok:true,accounts:[makeAccount()],nextPageKey:null}}]});
 try{
  await page.getByRole('button',{name:'Konton',exact:true}).click();await page.getByRole('button',{name:'Företag',exact:true}).click();await page.evaluate(()=>window.resolveAccountList());await expect(page.getByText('new@example.invalid',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.fixture.accountResponses.push({ok:false,code:'access_denied',message:'Åtkomsten har dragits tillbaka'}));
  await page.getByRole('button',{name:'Konton',exact:true}).click();await expect(page.getByRole('alert')).toContainText('inte längre');await expect(page.getByRole('button',{name:'Konton',exact:true})).toBeDisabled();await expect(page.getByRole('table')).toHaveCount(0);
 }finally{await page.close();}
});
test('account navigation is accessible from overview and fits a narrow mobile viewport',async()=>{
 const page=await setup({overviewTab:true,accountRows:[makeAccount()]});
 try{
  await page.setViewportSize({width:320,height:850});await page.getByRole('button',{name:'Konton',exact:true}).click();await expect(page.getByRole('heading',{name:'Konton och åtkomst'})).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await page.close();}
});


test('superadmin opens selected company advertising basis lazily and revoked access clears the parent company list',async()=>{
 const page=await setup();try{
  await page.evaluate(()=>{
   window.calls=[];window.responses=[];
   const counts={queued:1,dispatching:0,outcomeUnknown:0,submitted:1,published:2,rejected:0,retryable:0,newPublications:1};
   window.usage={ok:true,companyId:'10000000-0000-4000-8000-000000000001',actorUserId:'30000000-0000-4000-8000-000000000001',actorRole:'platform_admin',timeZone:'Europe/Stockholm',trackingStartedAt:'2026-10-14T00:00:00Z',legacyPublishedJobs:0,totals:{drafts:1,ready:1,...counts},channels:[{channel:'blocket',...counts}],billing:{status:'quantity_only',unitPriceOre:null,totalOre:null,unpricedPublications:1}};
  });
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await page.getByRole('button',{name:'Annonsunderlag för Fixture AB'}).click();
  await expect(page.getByRole('heading',{name:'Annonsunderlag för Fixture AB'})).toBeVisible();
  await expect(page.getByText('Unika publiceringar under vald månad')).toBeVisible();
  assert.equal((await page.evaluate(()=>window.calls[0])).companyId,COMPANY);
  await page.evaluate(()=>window.responses.push({ok:false,code:'access_denied',message:'Åtkomst återkallad'}));
  await page.getByRole('button',{name:'Uppdatera statistik'}).click();
  await expect(page.getByRole('alert')).toContainText('Åtkomst återkallad');
  await expect(page.getByRole('cell',{name:'Fixture AB'})).toHaveCount(0);
  await expect(page.getByText('Unika publiceringar under vald månad')).toHaveCount(0);
 }finally{await page.close();}
});
