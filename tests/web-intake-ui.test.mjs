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
const { webpack } = require('next/dist/compiled/webpack/webpack');
const repo = fileURLToPath(new URL('../', import.meta.url));
const helpers = resolve(repo, 'tests/helpers/web-intake-ui');
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
    mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
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


async function setup(responses=[]) {
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());
 await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
 await page.evaluate(responses=>{let ids=0;Object.defineProperty(crypto,'randomUUID',{value:()=>`20000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`});window.calls=[];window.responses=responses;window.fetch=async(_url,input)=>{const payload=JSON.parse(input.body);window.calls.push(payload);const response=window.responses.shift();if(response?.throw)throw new Error('Unknown transport');return {ok:true,json:async()=>response??{success:true,receipt:{requestId:payload.requestId,accepted:true}}};};},responses);
 await page.addScriptTag({path:bundle});return page;
}
async function fill(page) {
 await page.getByLabel('Företag',{exact:true}).fill('Bilhandlaren AB');await page.getByLabel('Ditt namn').fill('Anna Andersson');await page.getByLabel('Mejladress').fill('anna@example.test');await page.getByLabel('Telefon',{exact:true}).fill('0701234567');await page.getByLabel('Organisationsnummer').fill('556123-4567');await page.getByLabel('Trafexa-systemet',{exact:true}).check();await page.getByLabel('Beskriv vad ni söker').fill('Vi söker ett system för vårt lager.');await page.getByLabel(/Jag har tagit del/).check();
}
test('actual public form requires phone, org number, purpose, message and unchecked privacy acknowledgement at mobile width',async()=>{
 const page=await setup();try{await page.setViewportSize({width:390,height:844});await expect(page.getByLabel(/Jag har tagit del/)).not.toBeChecked();await page.getByRole('button',{name:'Skicka ansökan'}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);await fill(page);for(const [label,value] of [['Telefon','0701234567'],['Organisationsnummer','556123-4567'],['Beskriv vad ni söker','Vi söker ett system för vårt lager.']]){await page.getByLabel(label,{exact:true}).fill('');await page.getByRole('button',{name:'Skicka ansökan'}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);await page.getByLabel(label,{exact:true}).fill(value);}await page.getByLabel(/Jag har tagit del/).uncheck();await page.getByRole('button',{name:'Skicka ansökan'}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);await page.getByLabel(/Jag har tagit del/).check();await page.getByLabel('Trafexa-systemet',{exact:true}).uncheck();await page.getByRole('button',{name:'Skicka ansökan'}).click();await expect(page.getByRole('alert')).toContainText('Välj minst ett område');assert.equal(await page.evaluate(()=>window.calls.length),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true);}finally{await page.close();}
});
test('public success requires matching saved receipt and unknown outcomes reuse the same nonce',async()=>{
 const page=await setup([{throw:true},{success:true,receipt:{requestId:'wrong',accepted:true}}]);try{await fill(page);await page.getByRole('button',{name:'Skicka ansökan'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Skicka ansökan'}).click();await expect(page.getByRole('alert')).toContainText('Ansökan kunde inte sparas');await expect(page.getByRole('heading',{name:'Tack. Vi hörs snart.'})).toHaveCount(0);await page.getByRole('button',{name:'Skicka ansökan'}).click();await expect(page.getByRole('heading',{name:'Tack. Vi hörs snart.'})).toBeVisible();const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1],calls[2]);assert.equal(calls[0].privacyAcknowledged,true);assert.equal(calls[0].privacyVersion,'2026-10-14');assert.deepEqual(calls[0].seeking,['system']);}finally{await page.close();}
});
