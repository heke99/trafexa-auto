import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const Chromium = require('@sparticuz/chromium').default;
const { webpack } = require('next/dist/compiled/webpack/webpack');
const repo = fileURLToPath(new URL('../', import.meta.url));
const company = '10000000-0000-4000-8000-000000000001', stock = '20000000-0000-4000-8000-000000000001', otherStock = '20000000-0000-4000-8000-000000000002', cost = '30000000-0000-4000-8000-000000000001';
const source = { companyId: company, stockItemId: stock, version: '1', purchaseGrossOre: '10000000', saleGrossOre: '12500000', vatScheme: 'standard', purchaseVatOre: null, vatBasisConfirmed: false,
  costs: [{ id: cost, description: 'Reparation', grossOre: '1250000', deductibleVatOre: null }] };
const props = { item: { id: stock, purchase_price_ore: Number.MAX_SAFE_INTEGER + 10, asking_price_ore: Number.MAX_SAFE_INTEGER + 100, vat_scheme: 'standard' }, costs: [{ id: cost, amount_ore: Number.MAX_SAFE_INTEGER + 1, description: 'Untrusted snapshot' }], canEdit: true, demo: false };
let browser, directory, bundle;
before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-calculation-ui-'));
  const loader = resolve(directory, 'swc.cjs'), entry = resolve(directory, 'entry.js'), actions = resolve(directory, 'actions.js');
  await writeFile(loader, `const swc=require(${JSON.stringify(require.resolve('next/dist/build/swc'))}); module.exports=function(source){const done=this.async();swc.loadBindings().then(()=>done(null,swc.transformSync(source,{filename:this.resourcePath,jsc:{parser:{syntax:'typescript',tsx:this.resourcePath.endsWith('.tsx')},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'es6'}}).code),done);};`);
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {VehicleCalculation} from ${JSON.stringify(resolve(repo, 'src/components/vehicle-calculation.tsx'))};const root=createRoot(document.getElementById('root'));window.mount=props=>flushSync(()=>root.render(React.createElement(VehicleCalculation,props)));`);
  await writeFile(actions, `export async function getVehicleCalculationAction(input){window.fixture.reads.push(input);const source=structuredClone(window.fixture.source);if(window.fixture.deferRead){window.fixture.deferRead=false;return new Promise(resolve=>window.fixture.deferredReads.push(()=>resolve({ok:true,source})));}return {ok:true,source};}
  export async function saveVehicleCalculationMetadataAction(input){window.fixture.saves.push(input);if(window.fixture.conflict)return {ok:false,conflict:true,message:'Underlaget har ändrats. Läs in igen.'};const source={...window.fixture.source,purchaseVatOre:input.purchaseVatOre,vatBasisConfirmed:input.vatBasisConfirmed,version:(BigInt(input.expectedVersion)+1n).toString(),costs:window.fixture.source.costs.map(cost=>({...cost,deductibleVatOre:input.costVat.find(row=>row.costId===cost.id).deductibleVatOre}))};window.fixture.source=source;return {ok:true,source};}`);
  bundle = resolve(directory, 'fixture.js');
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, context: repo, entry, output: { path: directory, filename: 'fixture.js' },
      resolve: { modules: [resolve(repo, 'node_modules'), 'node_modules'], extensions: ['.ts', '.tsx', '.js'], alias: { '@/lib/data/calculation-actions': actions, '@': resolve(repo, 'src') } },
      module: { rules: [{ test: /\.tsx?$/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  browser = await chromium.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args.filter(arg => arg !== '--single-process'), headless: true });
});
after(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function pageFixture({ input = props, data = source, deferRead = false } = {}) {
  const page = await browser.newPage(); await page.route('**/*', route => route.abort()); await page.setContent('<div id="root"></div>');
  await page.evaluate(({ source, deferRead }) => { window.fixture = { source, deferRead, deferredReads: [], reads: [], saves: [], conflict: false }; }, { source: data, deferRead });
  await page.addScriptTag({ path: bundle }); await page.evaluate(input => window.mount(input), input);
  return page;
}
test('actual client shows no totals from unsafe snapshot numbers before an exact scoped read completes', async () => {
  const page = await pageFixture({ deferRead: true }); try {
    await expect(page.getByText('Hämtar exakt kalkylunderlag…')).toBeVisible();
    await expect(page.getByText('Skillnad före momshantering', { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.fixture.deferredReads.length)).toBe(1);
    await page.evaluate(() => window.fixture.deferredReads[0]());
    await expect(page.getByText('125 000,00 kr', { exact: true })).toBeVisible();
    await expect(page.getByText('Kalkylresultat efter moms', { exact: true })).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.fixture.reads), [{ stockItemId: stock }]);
  } finally { await page.close(); }
});
test('explicit receipt fields send exact ore and reveal a net result only after verified save', async () => {
  const page = await pageFixture(); try {
    await page.getByLabel('Avdragsgill inköpsmoms enligt underlag, kr').fill('20000,00');
    await page.getByLabel('Avdragsgill moms för Reparation, kr').fill('2500');
    await page.getByRole('button', { name: 'Spara momsunderlag' }).click();
    await expect(page.getByText('Kalkylresultat efter moms', { exact: true })).toBeVisible();
    await expect(page.getByText('10 000,00 kr', { exact: true })).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.fixture.saves), [{ stockItemId: stock, companyId: company, expectedVersion: '1', purchaseVatOre: '2000000', vatBasisConfirmed: false, costVat: [{ costId: cost, deductibleVatOre: '250000' }] }]);
  } finally { await page.close(); }
});
test('VMB output remains unconfirmed until explicit eligibility consent and never includes repair costs in its margin', async () => {
  const page = await pageFixture({ data: { ...source, vatScheme: 'vmb', costs: [{ ...source.costs[0], deductibleVatOre: '250000' }] } }); try {
    await expect(page.getByText('Beräknad moms på positiv VMB-marginal', { exact: true })).toHaveCount(0);
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Spara momsunderlag' }).click();
    await expect(page.getByText('5 000,00 kr', { exact: true })).toBeVisible();
    await expect(page.getByText('10 000,00 kr', { exact: true })).toBeVisible();
  } finally { await page.close(); }
});
test('CAS conflicts clear displayed old calculations and require a new exact read', async () => {
  const page = await pageFixture({ data: { ...source, purchaseVatOre: '2000000', costs: [{ ...source.costs[0], deductibleVatOre: '250000' }] } }); try {
    await expect(page.getByText('Kalkylresultat efter moms', { exact: true })).toBeVisible();
    await page.evaluate(() => { window.fixture.conflict = true; window.fixture.source = { ...window.fixture.source, version: '2', saleGrossOre: '13000000', purchaseVatOre: null }; });
    await page.getByRole('button', { name: 'Spara momsunderlag' }).click();
    await expect(page.getByRole('alert')).toContainText('Underlaget har ändrats');
    await expect(page.getByText('Kalkylresultat efter moms', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Läs in kalkylen igen' }).click();
    await expect(page.getByText('130 000,00 kr', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Avdragsgill inköpsmoms enligt underlag, kr')).toHaveValue('');
    await expect(page.getByText('Kalkylresultat efter moms', { exact: true })).toHaveCount(0);
  } finally { await page.close(); }
});
test('late old-vehicle reads are ignored after an in-place scope switch', async () => {
  const page = await pageFixture({ deferRead: true }); try {
    await expect.poll(() => page.evaluate(() => window.fixture.deferredReads.length)).toBe(1);
    await page.evaluate(({ input, id }) => { window.fixture.source = { ...window.fixture.source, stockItemId: id, saleGrossOre: '15000000' }; window.mount({ ...input, item: { ...input.item, id } }); }, { input: props, id: otherStock });
    await expect(page.getByText('150 000,00 kr', { exact: true })).toBeVisible();
    await page.evaluate(() => window.fixture.deferredReads[0]());
    await expect(page.getByText('125 000,00 kr', { exact: true })).toHaveCount(0);
    await expect(page.getByText('150 000,00 kr', { exact: true })).toBeVisible();
  } finally { await page.close(); }
});
test('a fresh snapshot revalidates source even if unsafe Number fields rounded away a price change', async () => {
  const page = await pageFixture({ data: { ...source, purchaseVatOre: '2000000', costs: [{ ...source.costs[0], deductibleVatOre: '250000' }] } }); try {
    await expect(page.getByText('Kalkylresultat efter moms', { exact: true })).toBeVisible();
    await page.evaluate(input => { window.fixture.source = { ...window.fixture.source, version: '2', purchaseVatOre: null }; window.mount({ ...input, item: { ...input.item } }); }, props);
    await expect.poll(() => page.evaluate(() => window.fixture.reads.length)).toBe(2);
    await expect(page.getByText('Kalkylresultat efter moms', { exact: true })).toHaveCount(0);
  } finally { await page.close(); }
});
test('read-only users have no metadata form and demo performs no actions', async () => {
  const page = await pageFixture({ input: { ...props, canEdit: false } }); try {
    await expect(page.getByText('125 000,00 kr', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spara momsunderlag' })).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.fixture.saves.length), 0);
  } finally { await page.close(); }
  const demo = await pageFixture({ input: { ...props, demo: true, item: { ...props.item, purchase_price_ore: 10000000, asking_price_ore: 12500000 }, costs: [{ ...props.costs[0], amount_ore: 1250000 }] } }); try {
    await expect(demo.getByText('125 000,00 kr', { exact: true })).toBeVisible();
    await expect(demo.getByRole('button', { name: 'Spara momsunderlag' })).toHaveCount(0);
    await expect(demo.getByText('Kalkylresultat efter moms', { exact: true })).toHaveCount(0);
    assert.equal(await demo.evaluate(() => window.fixture.reads.length + window.fixture.saves.length), 0);
  } finally { await demo.close(); }
});
