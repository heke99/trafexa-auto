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
      '@/lib/data/trade-in-actions':actions,'@/lib/data/offer-actions': actions, '@/lib/data/offer-archive-actions': actions, '@/lib/data/actions': actions,
      '@/lib/data/register-actions': actions, '@/lib/data/vehicle-cost-actions': actions,
      '@/lib/calculations/vehicle-calculation': resolve(repo, 'src/lib/calculations/vehicle-calculation.ts'),
      'next/link': unrelated, 'next/navigation': unrelated,
      [resolve(repo, 'src/components/deal-cancellation')]: unrelated,
      [resolve(repo, 'src/components/deal-trade-ins')]: unrelated,
      [resolve(repo, 'src/components/deal-trade-in-purchase')]: unrelated,
      [resolve(repo, 'src/components/stock-import')]: unrelated,
      [resolve(repo, 'src/components/customer-leads')]: unrelated,
      [resolve(repo, 'src/components/customer-contact-log')]: unrelated,
      [resolve(repo, 'src/components/dealer-offer-reviews')]: unrelated,
      [resolve(repo, 'src/components/company-team')]: unrelated,
      [resolve(repo, 'src/components/vehicle-calculation')]: unrelated,
      [resolve(repo, 'src/components/purchase-condition')]: unrelated,
      [resolve(repo, 'src/components/contract-template-workspace')]: unrelated,
      [resolve(repo, 'src/components/deal-contracts')]: unrelated,
      [resolve(repo, 'src/components/vehicle-photo-gallery')]: unrelated,
      [resolve(repo, 'src/components/advertising-workspace')]: unrelated,
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
    membership, memberships: [membership],
    inventory: [{id:'fixture-stock',status:'available',acquired_on:'2026-10-13',purchase_price_ore:20000000,asking_price_ore:25000000,vat_scheme:'standard',vehicles:{id:'fixture-vehicle',registration_number:'FIX123',make:'Fixture',model:'Vehicle',model_year:2022,mileage_km:50000,fuel:'petrol',gearbox:'automatic'}}],
    vehicle_costs: [], customers: [{id:'fixture-customer',name:'Fixturekund',email:'fixture@example.invalid',phone:null,kind:'person',address:null,notes:null,created_at:'2026-10-13T12:00:00Z'}],
    deals: [{ id: deal, status: 'draft', sale_price_ore: 25000000, customer_id: 'fixture-customer', stock_item_id: 'fixture-stock', created_at: '2026-10-13T12:00:00Z' }],
    finance_applications: [], documents: [], activities: [], finance_partners: [], dealer_approvals: [], integrations: [] };
}
test('actual contract panels bind company user role deal and demo independently of dealer write permissions', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/*',route=>route.abort());
    await page.setContent('<div id="root"></div>');
    await page.evaluate(()=>{window.fixture={offers:[],listCalls:[],archiveCalls:[]};});
    await page.addScriptTag({path:bundle});
    for (const role of ['owner','admin','finance','sales','viewer']) {
      const snapshot=workspace(role);snapshot.user.id=`contract-user-${role}`;
      await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot,section:'settings'}),snapshot);
      await expect(page.locator('[data-contract-templates]')).toHaveAttribute('data-contract-templates',company);
      await expect(page.locator('[data-contract-templates]')).toHaveAttribute('data-user',snapshot.user.id);
      await expect(page.locator('[data-contract-templates]')).toHaveAttribute('data-role',role);
      await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot,section:'deals'}),snapshot);
      await expect(page.locator('[data-contract-deal]')).toHaveAttribute('data-contract-deal',deal);
      await expect(page.locator('[data-contract-deal]')).toHaveAttribute('data-company',company);
      await expect(page.locator('[data-contract-deal]')).toHaveAttribute('data-user',snapshot.user.id);
      await expect(page.locator('[data-contract-deal]')).toHaveAttribute('data-role',role);
    }
    await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot,section:'deals',demo:true}),workspace('owner',otherCompany));
    await expect(page.locator('[data-contract-deal]')).toHaveAttribute('data-company',otherCompany);
    await expect(page.locator('[data-contract-deal]')).toHaveAttribute('data-demo','true');
  } finally { await page.close(); }
});
test('actual vehicle panel binds purchase underlay to current company user role stock and demo', async () => {
  const page = await browser.newPage();
  const stock = { id: '71000000-0000-4000-8000-000000000001', status: 'available', acquired_on: '2026-10-14', purchase_price_ore: 10001, asking_price_ore: 20001, vat_scheme: 'standard', vehicles: {id:'72000000-0000-4000-8000-000000000001',registration_number:'PUR123',make:'Volvo',model:'V60',model_year:2020,mileage_km:50000,fuel:'petrol',gearbox:'automatic'} };
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => { window.fixture = {offers:[],listCalls:[],archiveCalls:[]}; });
    await page.addScriptTag({path:bundle});
    for (const role of ['owner','admin','finance','sales','viewer']) {
      const snapshot = workspace(role); snapshot.inventory = [stock]; snapshot.user.id = `user-${role}`;
      await page.evaluate(snapshot => window.mountArchiveFixture({workspace:true,snapshot,section:'inventory'}), snapshot);
      await expect(page.locator('[data-purchase-stock]')).toHaveCount(0);
      await page.getByRole('button', {name:'Volvo V60',exact:true}).click();
      const panel = page.locator('[data-purchase-stock]');
      await expect(panel).toHaveAttribute('data-purchase-stock', stock.id);
      await expect(panel).toHaveAttribute('data-company', company);
      await expect(panel).toHaveAttribute('data-user', `user-${role}`);
      await expect(panel).toHaveAttribute('data-role', role);
      await page.getByRole('button', {name:'Stäng',exact:true}).click();
    }
    const snapshot = workspace('owner',otherCompany); snapshot.inventory = [{...stock,id:'71000000-0000-4000-8000-000000000002'}];
    await page.evaluate(snapshot => window.mountArchiveFixture({workspace:true,snapshot,section:'inventory',demo:true}), snapshot);
    await page.getByRole('button', {name:'Volvo V60',exact:true}).click();
    await expect(page.locator('[data-purchase-stock]')).toHaveAttribute('data-company',otherCompany);
    await expect(page.locator('[data-purchase-stock]')).toHaveAttribute('data-demo','true');
  } finally { await page.close(); }
});
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
  await expect(page.getByRole('region',{name:'Offertversioner',exact:true})).toHaveCount(0);
  await page.locator('summary').first().click();
  await expect(page.getByRole('region',{name:'Offertversioner',exact:true})).toBeVisible();
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

test('actual dealer trade-in panels load only when opened and scope company roles and demo',async()=>{
 const page=await browser.newPage();
 try {
  await page.route('**/*',route=>route.abort());await page.setContent('<div id="root"></div>');await page.evaluate(()=>{window.fixture={offers:[],listCalls:[],archiveCalls:[]};});await page.addScriptTag({path:bundle});
  for(const role of ['owner','admin','sales','finance','viewer']){
   const snapshot=workspace(role);snapshot.user.id=`user-${role}`;
   await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot}),snapshot);
   await expect(page.locator('[data-trade-in]')).toHaveCount(0);
   await page.getByText('Inbytesunderlag',{exact:true}).click();
   await expect(page.locator('[data-trade-in]')).toHaveAttribute('data-edit',String(['owner','admin','sales'].includes(role)));
  }
  await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot,demo:true}),workspace('owner',otherCompany));
  await expect(page.locator('[data-trade-in]')).toHaveCount(0);await page.getByText('Inbytesunderlag',{exact:true}).click();
  await expect(page.locator('[data-trade-in]')).toHaveAttribute('data-company',otherCompany);await expect(page.locator('[data-trade-in]')).toHaveAttribute('data-edit','false');await expect(page.locator('[data-trade-in]')).toHaveAttribute('data-demo','true');
 }finally{await page.close();}
});

test('actual dealer cancellation scopes roles, company and supported deal statuses',async()=>{
 const page=await browser.newPage();
 try {
  await page.route('**/*',route=>route.abort());await page.setContent('<div id="root"></div>');await page.evaluate(()=>{window.fixture={offers:[],listCalls:[],archiveCalls:[]};});await page.addScriptTag({path:bundle});
  for(const role of ['owner','admin','sales','finance','viewer']){
   await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot}),workspace(role));
   await expect(page.locator('[data-cancellation]')).toHaveAttribute('data-edit',String(['owner','admin','sales'].includes(role)));
  }
  await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot,demo:true}),workspace('owner',otherCompany));
  await expect(page.locator('[data-cancellation]')).toHaveAttribute('data-company',otherCompany);await expect(page.locator('[data-cancellation]')).toHaveAttribute('data-edit','false');
  for(const status of ['offered','contracted','sold','delivered','closed']){
   const snapshot=workspace('owner');snapshot.deals[0].status=status;await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot}),snapshot);await expect(page.locator('[data-cancellation]')).toHaveCount(0);
  }
 }finally{await page.close();}
});

test('actual dealer followups open a customer outside the table sample, clear on denial and cannot carry a modal across companies',async()=>{
 const page=await browser.newPage();
 try {
  await page.route('**/*',route=>route.abort());await page.setContent('<div id="root"></div>');
  const outside={id:'70000000-0000-4000-8000-000000000001',name:'Kund utanför urvalet'};
  await page.evaluate(outside=>{window.fixture={crmOutside:outside};},outside);await page.addScriptTag({path:bundle});
  await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot,section:'customers'}),workspace('owner'));
  await page.getByRole('button',{name:'Öppna kund utanför tabellurvalet'}).click();
  const log=page.getByRole('region',{name:'Kontaktfixture'});await expect(log).toHaveAttribute('data-customer',outside.id);await expect(log).toHaveAttribute('data-company',company);await expect(log).toHaveAttribute('data-can-edit','true');
  await page.getByRole('button',{name:'Neka kontaktåtkomst'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Öppna kund utanför tabellurvalet'}).click();
  await page.evaluate(snapshot=>window.mountArchiveFixture({workspace:true,snapshot,section:'customers'}),workspace('viewer',otherCompany));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Öppna kund utanför tabellurvalet'}).click();await expect(log).toHaveAttribute('data-company',otherCompany);await expect(log).toHaveAttribute('data-can-edit','false');
 }finally{await page.close();}
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
    // A real scope change closes and clears the whole offer panel immediately.
    await expect(page.getByRole('region',{name:'Offertversioner',exact:true})).toHaveCount(0);
    await page.evaluate((outcome) => {
      if (outcome === 'resolve') window.fixture.deferred[0].resolve(window.fixture.proof(window.fixture.archiveCalls[0]));
      else window.fixture.deferred[0].reject(new Error('Old-company transport failure'));
    }, outcome);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.locator('summary').first().click();
    await expect.poll(() => page.evaluate(() => window.fixture.listCalls.at(-1)?.companyId)).toBe(otherCompany);
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
const tradeRow={id:'70000000-0000-4000-8000-000000000001',companyId:company,dealId:deal,customerId:'80000000-0000-4000-8000-000000000001',version:2,registration:'INB123',make:'Saab',model:'93',modelYear:2010,mileageKm:120000,conditionNotes:'HEMLIG INTERN ANTECKNING',equipmentNotes:'HEMLIG UTRUSTNING',lenderName:'HEMLIG KREDITGIVARE',valueOre:'25000001',debtKnown:true,debtOre:'0',salePriceOre:'25000000',netTradeInOre:'25000001',amountToPayOre:'-1',actorLabel:'Du',createdAt:'2026-10-14T10:00:00Z'};
async function enableTrade(page,rows=[tradeRow]){await page.evaluate(rows=>{window.fixture.tradeRows=rows;window.fixture.createEnabled=true;window.fixture.createCalls=[];window.fixture.createResponses=[];},rows);await page.getByRole('button',{name:'Uppdatera versioner',exact:true}).click();await expect(page.getByRole('option',{name:/INB123/})).toHaveCount(1);}
test('new offer attachment shows public immutable fields only, explicit review, penny payout and stable nonce/CAS retries',async()=>{const page=await setup({canCreate:true});try{await enableTrade(page);await page.getByLabel('Inbyte i den nya offerten').selectOption(tradeRow.id);await expect(page.getByText('0,01 kr',{exact:false})).toBeVisible();await expect(page.getByText(/HEMLIG/)).toHaveCount(0);await page.getByLabel('Jag bekräftar att affärspriset').check();await expect(page.getByRole('button',{name:'Skapa ny offertversion'})).toBeDisabled();await page.getByLabel('Jag har granskat inbytet').check();await page.evaluate(()=>window.fixture.createResponses.push({throw:true}));await page.getByRole('button',{name:'Skapa ny offertversion'}).click();await expect(page.getByRole('alert')).toContainText('kunde inte bekräftas');await page.getByRole('button',{name:'Skapa ny offertversion'}).click();await expect(page.getByText('Offertversionen har sparats.',{exact:true})).toBeVisible();const writes=await page.evaluate(()=>window.fixture.createCalls);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].trade_in_id,tradeRow.id);assert.equal(writes[0].expected_trade_in_version,'2');assert.equal(writes[0].expected_offer_version,'1');assert.equal(writes[0].expected_sale_price_ore,'25000000');assert.equal(writes[0].trade_in_confirmed,'true');assert.equal(writes[0].conditionNotes,undefined);}finally{await page.close();}});
test('unknown and older trade-ins cannot attach, plain offers remain possible, accepted state and denied scope suppress creation',async()=>{const page=await setup({canCreate:true});try{await enableTrade(page,[{...tradeRow,debtKnown:false,debtOre:null,netTradeInOre:null,amountToPayOre:null}]);await expect(page.getByRole('option',{name:/Skulden behöver kontrolleras/})).toHaveAttribute('disabled','');await page.getByLabel('Jag bekräftar att affärspriset').check();await page.getByRole('button',{name:'Skapa ny offertversion'}).click();await expect(page.getByText('Offertversionen har sparats.',{exact:true})).toBeVisible();assert.equal((await page.evaluate(()=>window.fixture.createCalls))[0].trade_in_id,'');await page.evaluate(()=>window.fixture.tradeCanCreate=false);await page.getByRole('button',{name:'Uppdatera versioner',exact:true}).click();await expect(page.getByRole('button',{name:'Skapa ny offertversion'})).toBeDisabled();await page.evaluate(()=>window.fixture.tradeResponses=[{ok:false,code:'access_denied',message:'Ingen åtkomst.'}]);await page.getByRole('button',{name:'Uppdatera versioner',exact:true}).click();await expect(page.getByLabel('Inbyte i den nya offerten')).toHaveCount(0);}finally{await page.close();}});
test('offer trade-in conflict refreshes current scope and requires unchecked review of updated immutable version',async()=>{const page=await setup({canCreate:true});try{await enableTrade(page);await page.getByLabel('Inbyte i den nya offerten').selectOption(tradeRow.id);await page.getByLabel('Jag har granskat inbytet').check();await page.getByLabel('Jag bekräftar att affärspriset').check();await page.evaluate(()=>{window.fixture.createResponses.push({ok:false,code:'conflict',message:'Underlaget ändrades.'});window.fixture.tradeRows=[{...window.fixture.tradeRows[0],version:3}];});await page.getByRole('button',{name:'Skapa ny offertversion'}).click();await expect(page.getByLabel('Inbyte i den nya offerten')).toHaveValue('');await expect(page.getByLabel('Jag bekräftar att affärspriset')).not.toBeChecked();await expect(page.getByRole('button',{name:'Skapa ny offertversion'})).toBeDisabled();}finally{await page.close();}});
test('offer attachment review remains usable on mobile and desktop and ignores previous company state',async()=>{const styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');for(const width of [320,375,1280]){const page=await setup({canCreate:true});try{await page.setViewportSize({width,height:900});await page.addStyleTag({content:styles});await enableTrade(page);await page.getByLabel('Inbyte i den nya offerten').selectOption(tradeRow.id);await expect(page.getByRole('region',{name:'Inbyte som kunden får se'})).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`attachmentoverflow${width}`);await page.evaluate(p=>window.mountArchiveFixture(p),{dealId:deal,companyId:otherCompany,canCreate:true,canArchive:false});await expect(page.getByRole('region',{name:'Inbyte som kunden får se'})).toHaveCount(0);await page.locator('summary').first().click();await expect(page.getByLabel('Inbyte i den nya offerten')).toHaveValue('');await expect(page.getByLabel('Jag har granskat inbytet')).toHaveCount(0);}finally{await page.close();}}});
test('revoked trade-in access during offer refresh clears previously readable offers; late old-scope trade page cannot restore them',async()=>{const page=await setup({canCreate:true});try{await enableTrade(page);await page.evaluate(()=>window.fixture.tradeResponses=[{ok:false,code:'access_denied',message:'Åtkomsten har upphört.'}]);await page.getByRole('button',{name:'Uppdatera versioner',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Åtkomsten har upphört');await expect(page.getByText('Version 1',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Inbyte i den nya offerten')).toHaveCount(0);await page.evaluate(()=>window.fixture.tradeResponses=[{defer:true,result:{ok:true,companyId:'10000000-0000-4000-8000-000000000001',dealId:'20000000-0000-4000-8000-000000000001',salePriceOre:'25000000',customerName:'Tidigare kund',latestVersion:2,canCreate:true,versions:[],nextBeforeVersion:null}}]);await page.getByRole('button',{name:'Uppdatera versioner',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof window.fixture.resolveTrade)).toBe('function');await page.evaluate(p=>window.mountArchiveFixture(p),{dealId:deal,companyId:otherCompany,canCreate:false,canArchive:false});await page.evaluate(()=>window.fixture.resolveTrade());await expect(page.getByRole('region',{name:'Offertversioner',exact:true})).toHaveCount(0);await page.locator('summary').first().click();await expect(page.getByLabel('Inbyte i den nya offerten')).toHaveCount(0);await expect(page.getByText('Tidigare kund',{exact:false})).toHaveCount(0);}finally{await page.close();}});
