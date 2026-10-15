import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const Chromium = require('@sparticuz/chromium').default;
const { webpack } = require('next/dist/compiled/webpack/webpack');
const repo = fileURLToPath(new URL('../', import.meta.url)), helpers = resolve(repo, 'tests/helpers/crm-ui');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const props = { companyId:id(1),customerId:id(2),userId:id(3),canEdit:true };
const contact = { id:id(4),companyId:id(1),customerId:id(2),kind:'call',contactOn:'2026-10-13',summary:'Kunden önskar en kombi <script>alert(1)</script>',followUpOn:'2026-10-14',followUpStatus:'pending',version:3,createdAt:'2026-10-13T08:00:00Z',actorLabel:'Kollega',customerName:'Anna Exempel' };
let browser, directory, bundle, styles;
before(async()=>{directory=await mkdtemp(resolve(tmpdir(),'trafexa-crm-ui-'));bundle=resolve(directory,'fixture.js');styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8'); const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(helpers,'entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/data/customer-contact-actions':resolve(helpers,'actions.js')}},module:{rules:[{test:/\.tsx?$/,use:resolve(helpers,'swc-loader.cjs')}]}});await new Promise((done,reject)=>compiler.run((err,stats)=>compiler.close(()=>err||stats.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):done())));browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(x=>x!=='--single-process'),headless:true});});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function setup(overrides={},options={}){const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',r=>r.abort());await page.setContent(`<style>${styles}</style><div id="root" class="wrap"></div>`);await page.evaluate(({props,contact,overrides})=>{window.fixture={companyId:props.companyId,contacts:[contact],reads:[],writes:[],updates:[],selected:[],denied:0,readResponses:[],writeResponses:[],updateResponses:[],...overrides};let n=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`20000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});},{props,contact,overrides});await page.addScriptTag({path:bundle});await page.evaluate(p=>window.mountCrmFixture(p),{...props,...options});await expect(page.getByText('Hämtar kontaktloggen…')).toHaveCount(0);return page;}
test('contact creation keeps exact UUID and inputs after unknown outcome; review requires persisted reason and CAS version',async()=>{const page=await setup({writeResponses:[{throw:true}],updateResponses:[{throw:true}]});try{await page.getByLabel('Sammanfattning',{exact:true}).fill('Ringde kunden');await page.getByLabel('Uppföljningsdatum (valfritt)').fill('2026-10-15');await page.getByRole('button',{name:'Spara kontakt',exact:true}).click();await expect(page.getByRole('alert')).toContainText('kunde inte bekräftas');await page.getByRole('button',{name:'Spara kontakt',exact:true}).click();await expect(page.getByRole('status')).toContainText('Kontakten är sparad');const writes=await page.evaluate(()=>window.fixture.writes);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].kind,'call');await page.getByRole('button',{name:'Markera klar',exact:true}).click();await expect(page.getByRole('button',{name:'Bekräfta klar'})).toBeDisabled();await page.getByLabel('Anledning till ändringen').fill('Samtalet genomfört');await page.getByRole('button',{name:'Bekräfta klar'}).click();await expect(page.getByRole('alert')).toContainText('kunde inte bekräftas');await page.getByRole('button',{name:'Bekräfta klar'}).click();await expect(page.getByRole('region',{name:'Granska uppföljningen'})).toHaveCount(0);const updates=await page.evaluate(()=>window.fixture.updates);assert.deepEqual(updates[0],updates[1]);assert.equal(updates[0].expectedVersion,3);assert.equal(updates[0].reason,'Samtalet genomfört');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));}finally{await page.close();}});
test('access denial clears cached contacts, forms and pending review and notifies parent',async()=>{const page=await setup();try{await page.getByRole('button',{name:'Avbryt uppföljning',exact:true}).click();await page.evaluate(()=>window.fixture.readResponses.push({ok:false,code:'access_denied',message:'Åtkomsten har upphört.'}));await page.getByRole('button',{name:'Uppdatera kontaktloggen'}).click();await expect(page.getByText(contact.summary,{exact:true})).toHaveCount(0);await expect(page.getByLabel('Sammanfattning',{exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'Granska uppföljningen'})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.fixture.denied),1);}finally{await page.close();}});
test('read roles and demo perform no mutations; company/customer switch removes private timeline immediately',async()=>{const page=await setup({}, {canEdit:false});try{await expect(page.getByLabel('Sammanfattning',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Markera klar',exact:true})).toHaveCount(0);await page.evaluate(p=>{window.fixture.contacts=[];window.mountCrmFixture({...p,customerId:'10000000-0000-4000-8000-000000000009',demo:true});},props);await expect(page.getByText(contact.summary,{exact:true})).toHaveCount(0);const fixture=await page.evaluate(()=>window.fixture);assert.equal(fixture.writes.length,0);assert.equal(fixture.updates.length,0);}finally{await page.close();}});
test('company followups query all-company pages with Stockholm date and open real customer outside workspace sample',async()=>{const page=await setup({cursor:'opaque-page'},{followups:true});try{await expect(page.getByText(/Anna Exempel/)).toBeVisible();await page.getByRole('button',{name:'Öppna kund'}).click();assert.deepEqual(await page.evaluate(()=>window.fixture.selected),[{id:props.customerId,name:'Anna Exempel'}]);await page.evaluate(()=>{window.fixture.contacts=[];window.fixture.cursor=null;});await page.getByRole('button',{name:'Visa fler uppföljningar'}).click();const reads=await page.evaluate(()=>window.fixture.reads);assert.equal(reads.at(-1).pageKey,'opaque-page');assert.equal(reads.at(-1).filter,'due');await page.getByLabel('Visa uppföljningar').selectOption('upcoming');await expect(page.getByText('Inga uppföljningar att visa.')).toBeVisible();assert.equal((await page.evaluate(()=>window.fixture.reads)).at(-1).filter,'upcoming');await page.evaluate(()=>window.fixture.readResponses.push({ok:false,code:'access_denied',message:'Ingen åtkomst'}));await page.getByRole('button',{name:'Uppdatera uppföljningar'}).click();await expect(page.getByRole('button',{name:'Öppna kund'})).toHaveCount(0);}finally{await page.close();}});

const conflictMessage = 'Underlaget har ändrats. Uppdatera listan innan du försöker igen.';
test('follow-up conflict remains visible after fresh reload, clears previous success and requires a new version review', async () => {
  const page = await setup();
  try {
    await page.getByLabel('Sammanfattning', { exact: true }).fill('Tidigare sparad kontakt');
    await page.getByRole('button', { name: 'Spara kontakt', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Kontakten är sparad.');
    await page.getByRole('button', { name: 'Markera klar', exact: true }).click();
    await page.getByLabel('Anledning till ändringen').fill('Första granskningen');
    await page.evaluate(({ contact, conflictMessage }) => {
      window.fixture.contacts = [{ ...contact, version: 4, summary: 'Uppdaterad av kollega' }];
      window.fixture.updateResponses.push({ ok: false, code: 'conflict', message: conflictMessage });
    }, { contact, conflictMessage });
    await page.getByRole('button', { name: 'Bekräfta klar' }).click();
    await expect(page.getByText('Hämtar kontaktloggen…')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText(conflictMessage);
    await expect(page.getByRole('region', { name: 'Granska uppföljningen' })).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByText('Uppdaterad av kollega', { exact: true })).toBeVisible();
    await expect(page.getByText('Uppföljning: 2026-10-14 · Planerad')).toBeVisible();
    assert.equal(await page.evaluate(() => window.fixture.updates.length), 1);

    await page.getByRole('button', { name: 'Markera klar', exact: true }).click();
    await expect(page.getByLabel('Anledning till ändringen')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Bekräfta klar' })).toBeDisabled();
    await page.getByLabel('Anledning till ändringen').fill('Granskat aktuell uppföljning');
    await page.getByRole('button', { name: 'Bekräfta klar' }).click();
    await expect(page.getByRole('status')).toHaveText('Uppföljningen är uppdaterad.');
    const updates = await page.evaluate(() => window.fixture.updates);
    assert.deepEqual(updates.map(value => value.expectedVersion), [3, 4]);
    assert.notEqual(updates[0].requestId, updates[1].requestId);
    assert.equal(updates[1].reason, 'Granskat aktuell uppföljning');
  } finally { await page.close(); }
});

test('follow-up conflict reload failures preserve the newer error and never restore a stale review or success', async () => {
  for (const [reload, message, denied] of [
    [{ throw: true }, 'Kontaktloggen kunde inte hämtas. Försök igen.', false],
    [{ ok: false, code: 'unavailable', message: 'Kontaktloggen är tillfälligt otillgänglig.' }, 'Kontaktloggen är tillfälligt otillgänglig.', false],
    [{ ok: false, code: 'access_denied', message: 'Åtkomsten har upphört.' }, 'Åtkomsten har upphört.', true],
    [{ ok: false, code: 'unauthenticated', message: 'Logga in igen.' }, 'Logga in igen.', true],
  ]) {
    const page = await setup();
    try {
      await page.getByRole('button', { name: 'Markera klar', exact: true }).click();
      await page.getByLabel('Anledning till ändringen').fill('Genomförd kontakt');
      await page.evaluate(({ reload, conflictMessage }) => {
        window.fixture.updateResponses.push({ ok: false, code: 'conflict', message: conflictMessage });
        window.fixture.readResponses.push(reload);
      }, { reload, conflictMessage });
      await page.getByRole('button', { name: 'Bekräfta klar' }).click();
      await expect(page.getByRole('alert')).toHaveText(message);
      await expect(page.getByText('Hämtar kontaktloggen…')).toHaveCount(0);
      await expect(page.getByText(conflictMessage, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Granska uppföljningen' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Markera klar', exact: true })).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.fixture.denied), Number(denied));
      assert.equal(await page.evaluate(() => window.fixture.updates.length), 1);
    } finally { await page.close(); }
  }
});
