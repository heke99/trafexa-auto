import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/platform-admin/membership-actions': resolve(repo, 'tests/helpers/platform-memberships-ui/membership-actions.js'), '@/lib/platform-admin/application-invitation-actions': resolve(helpers, 'application-invitation-actions.js'), '@/lib/platform-admin/application-invitation-send-actions': resolve(helpers, 'application-invitation-send-actions.js'), '@/lib/platform-admin/application-invitation-renew-actions': resolve(helpers, 'application-invitation-renew-actions.js'), '@/lib/advertising/payment-actions': resolve(repo,'tests/helpers/advertising-payment-ui/unavailable-actions.js'), '@/lib/advertising/invoice-email-actions': resolve(repo, 'tests/helpers/advertising-invoice-email-ui/actions.js'), '@/lib/advertising/invoice-email-send-actions': resolve(repo, 'tests/helpers/advertising-invoice-email-ui/send-actions.js'), '@/lib/blocket-provisioning/actions': resolve(repo, 'tests/helpers/blocket-provisioning-ui/actions.js'), '@/lib/advertising/credit-actions': resolve(repo, 'tests/helpers/advertising-credit-ui/actions.js'), '@/lib/advertising/issuance-actions': resolve(repo, 'tests/helpers/advertising-issuance-ui/actions.js'), '@/lib/advertising/financial-actions': resolve(repo, 'tests/helpers/advertising-financial-ui/actions.js'), '@/lib/advertising/invoice-actions': resolve(repo, 'tests/helpers/advertising-invoice-ui/actions.js'), '@/lib/advertising/correction-actions': resolve(repo, 'tests/helpers/advertising-corrections-ui/actions.js'), '@/lib/advertising/billing-actions': resolve(repo, 'tests/helpers/advertising-billing-ui/actions.js'), '@/lib/calculations/vehicle-calculation': resolve(repo, 'src/lib/calculations/vehicle-calculation.ts'), '@/lib/advertising/usage-actions': resolve(repo, 'tests/helpers/advertising-usage-ui/actions.js'), '@/lib/advertising/actions': resolve(repo, 'tests/helpers/advertising-ui/actions.js'), '@/lib/platform-admin/actions': resolve(helpers, 'actions.js'), 'next/navigation': resolve(helpers, 'navigation.js'), '@/lib/platform-admin/overview-actions': resolve(helpers, 'overview-actions.js'), '@/lib/platform-admin/account-actions': resolve(helpers, 'account-actions.js') } },
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

async function setup({ activation = false, initialCompanies = [makeCompany()], nextPageKey = null, statusResponses = [], listResponses = [], contactResponses = [], application = null, detailResponses = [], applicationStatusResponses = [], eraseResponses = [], overviewResponses = [], overviewTab = false, accountRows = [], accountResponses = [], accountStatusResponses = [], invitationResponses = [], invitationReadResponses = [] } = {}) {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
  await page.evaluate(({ companies, statusResponses, listResponses, contactResponses, application, detailResponses, applicationStatusResponses, eraseResponses, overviewResponses, accountRows, accountResponses, accountStatusResponses, invitationResponses, invitationReadResponses }) => {
    let ids = 0;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `20000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });
    window.fixture = { invitationReadResponses, invitationReadCalls: [], invitationResponses, invitationCalls: [], accounts: accountRows, accountResponses, accountStatusResponses, accountListCalls: [], accountStatusCalls: [], companies, statusResponses, listResponses, contactResponses, application, detailResponses, applicationStatusResponses, eraseResponses, overviewResponses, overviewCalls: [], eraseCalls: [], detailCalls: [], applicationStatusCalls: [], statusCalls: [], listCalls: [], contactCalls: [], activationCalls: [], refreshes: 0 };
  }, { companies: initialCompanies, statusResponses, listResponses, contactResponses, application, detailResponses, applicationStatusResponses, eraseResponses, overviewResponses, accountRows, accountResponses, accountStatusResponses, invitationResponses, invitationReadResponses });
  await page.addScriptTag({ path: bundle });
  await page.evaluate(props => window.mountAdminFixture(props), { actorUserId: '30000000-0000-4000-8000-000000000001', activation, initialPage: { companies: initialCompanies, nextPageKey }, initialError: null });
  if (!activation && !overviewTab) await page.getByRole('button', { name: 'Företag', exact: true }).click();
  return page;
}

test('actual account list identifies companies, requested companies and unlinked accounts on desktop and mobile',async()=>{
 const company={id:COMPANY,name:'Norrköpings Bilcenter AB',organisationNumber:'5561234567',status:'active',membershipStatus:'active'};
 const make=(n,patch={})=>({userId:`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`,name:'Anna Andersson',email:`anna${n}@fixture.invalid`,emailVerified:true,createdAt:'2026-10-16T00:00:00Z',status:'pending',version:0,isPlatformAdmin:false,...patch});
 const linked=make(1,{companies:[company,{...company,id:NEXT,name:'Södra Bil AB',membershipStatus:'suspended'}],companyCount:2,requestedCompany:null});
 const requested=make(2,{companies:[],companyCount:0,requestedCompany:{name:'Nyansökta Bil AB',organisationNumber:'5590001122'}});const unlinked=make(3,{companies:[],companyCount:0,requestedCompany:null});
 for(const width of[1440,390]){const page=await setup({accountRows:[linked,requested,unlinked]});try{
  await page.setViewportSize({width,height:1050});await page.getByRole('button',{name:'Konton',exact:true}).click();
  await expect(page.getByText(company.name,{exact:true})).toBeVisible();await expect(page.getByText('Org.nr 5561234567',{exact:true})).toBeVisible();await expect(page.getByText('Södra Bil AB · 5561234567 · Avstängd koppling',{exact:true})).toBeVisible();
  await expect(page.getByText('Inget företag ännu',{exact:true})).toHaveCount(2);await expect(page.getByText('Ansökt företag: Nyansökta Bil AB')).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mkdir('/workspace/trafexa-dealer-qa/admin-application-20261016',{recursive:true});await page.screenshot({path:`/workspace/trafexa-dealer-qa/admin-application-20261016/accounts-${width}.png`,fullPage:true});
  await page.evaluate(row=>window.fixture.accountResponses.push({ok:true,accounts:[row],nextPageKey:null}),linked);
  await page.getByLabel('Sök namn, organisationsnummer eller e-post').fill('  Norrköpings   Bilcenter  ');await page.getByRole('button',{name:'Uppdatera konton',exact:true}).click();await expect(page.getByText('Inget företag ännu',{exact:true})).toHaveCount(0);assert.equal((await page.evaluate(()=>window.fixture.accountListCalls)).at(-1).search,'norrköpings bilcenter');
  await page.evaluate(()=>window.fixture.accountResponses.push({ok:true,accounts:[],nextPageKey:null}));await page.getByLabel('Sök namn, organisationsnummer eller e-post').fill('556999-0000');await page.getByRole('button',{name:'Uppdatera konton',exact:true}).click();await expect(page.getByText(/Ingen träff. Sök på företagsnamn/)).toBeVisible();
 }finally{await page.close();}}
});

test('accounts distinguish pending account approval from incoming applications and approved accounts awaiting email activation',async()=>{
 const pending={userId:'50000000-0000-4000-8000-000000000101',name:'Väntande Kontakt',email:'pending@fixture.invalid',emailVerified:true,createdAt:'2026-10-16T00:00:00Z',status:'pending',version:0,isPlatformAdmin:false,companies:[],companyCount:0,requestedCompany:null};
 const approved={...pending,userId:'50000000-0000-4000-8000-000000000102',name:'Inbjuden Kontakt',email:'invited@fixture.invalid',emailVerified:false,status:'approved',version:1};
 const application={id:COMPANY,name:'Ansökande Kontakt',email:'application@fixture.invalid',company:'Ansökande Bil AB',organisationNumber:'5561234567',seeking:['system'],status:'new',version:1,createdAt:'2026-10-16T00:00:00Z'};
 const page=await setup({accountRows:[pending,approved],contactResponses:[{ok:true,requests:[application],nextPageKey:null}]});try{
  await page.setViewportSize({width:390,height:1000});await page.getByRole('button',{name:'Konton',exact:true}).click();
  await expect(page.getByText('Skapade användarkonton visas här',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Granska konto pending@fixture.invalid',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Granska konto invited@fixture.invalid',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Granska konto application@fixture.invalid',exact:true})).toHaveCount(0);
  await page.getByLabel('Sök namn, organisationsnummer eller e-post').fill('saknas');await page.getByRole('button',{name:'Uppdatera konton',exact:true}).click();await expect(page.getByText('Inga konton i denna vy',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Rensa sökning',exact:true}).click();await expect(page.getByLabel('Sök namn, organisationsnummer eller e-post')).toHaveValue('');await expect(page.getByRole('button',{name:'Granska konto pending@fixture.invalid',exact:true})).toBeVisible();assert.equal((await page.evaluate(()=>window.fixture.accountListCalls)).at(-1).search,'');
  await page.getByLabel('Visa konton').selectOption('approved');await expect(page.getByText('Inväntar aktivering via e-post',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Granska konto pending@fixture.invalid',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Granska konto invited@fixture.invalid',exact:true})).toBeVisible();assert.equal((await page.evaluate(()=>window.fixture.accountListCalls)).at(-1).filter,'approved');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/workspace/trafexa-dealer-qa/admin-application-20261016/accounts-lifecycle-390.png',fullPage:true});
  await page.getByRole('button',{name:'Visa inkomna ansökningar',exact:true}).click();await expect(page.getByRole('heading',{name:'Inkomna ansökningar',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Visa ansökan från Ansökande Kontakt',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>window.fixture.contactCalls.length),1);assert.equal(await page.evaluate(()=>window.fixture.accountStatusCalls.length),0);
  await page.getByRole('button',{name:'Konton',exact:true}).click();await expect(page.getByLabel('Visa konton')).toHaveValue('approved');await expect(page.getByText('Inväntar aktivering via e-post',{exact:true})).toBeVisible();
 }finally{await page.close();}
});

test('empty pending accounts points to the application queue instead of promising all new applications here',async()=>{const page=await setup();try{await page.getByRole('button',{name:'Konton',exact:true}).click();await expect(page.getByText('Inga skapade konton inväntar ett kontobeslut.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Visa inkomna ansökningar',exact:true})).toBeVisible();}finally{await page.close();}});
