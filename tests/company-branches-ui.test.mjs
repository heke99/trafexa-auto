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
const helpers = resolve(repo, 'tests/helpers/company-branches-ui');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COMPANY=id(1), ACTOR=id(2), BRANCH=id(3);
const fields=()=>({code:'centrum',name:'Centrum',addressLine1:'Storgatan 1',postalCode:'12345',city:'Stockholm',publicEmail:'butik@example.com',publicPhone:'+46 70 123 45 67'});
const branch=()=>({id:BRANCH,companyId:COMPANY,version:3,status:'active',fields:fields(),createdAt:'2026-10-15T12:00:00Z',updatedAt:'2026-10-15T12:00:00Z'});
const state=()=>({companyId:COMPANY,actorUserId:ACTOR,actorRole:'owner',status:'active',legalName:'Handlaren AB',organisationNumber:'5560160680',branches:[branch()],nextPageKey:null});
let browser, directory, bundle, styles;

before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-team-ui-'));
  bundle = resolve(directory, 'fixture.js');
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = {
    plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
    mode: 'development', target: 'web', devtool: false, context: repo,
    entry: resolve(helpers, 'entry.js'), output: { path: directory, filename: 'fixture.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/company-branches/actions': resolve(helpers, 'actions.js'), '@': resolve(repo, 'src') } },
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

async function setup(p=state(),overrides={},props={}) {
 const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.setContent(`<style>${styles}</style><div class="wrap" id="root"></div>`);
 await page.evaluate(({p,overrides})=>{let nonce=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`20000000-0000-4000-8000-${String(++nonce).padStart(12,'0')}`});window.fixture={page:p,listCalls:[],saveCalls:[],statusCalls:[],listResponses:[],saveResponses:[],statusResponses:[],...overrides};},{p,overrides});
 await page.addScriptTag({path:bundle});await page.evaluate(p=>window.mountBranches(p),{companyId:COMPANY,userId:ACTOR,role:'owner',...props});return page;
}
async function open(p){await p.getByRole('button',{name:'Öppna filialregister'}).click();await expect(p.getByText('Verifierar filialregistret…')).toHaveCount(0);}
async function edit(p){await p.getByRole('button',{name:/Redigera filial/}).click();await p.getByLabel('Filialnamn',{exact:true}).fill('Ny filial');await p.getByRole('button',{name:'Granska filialuppgifter'}).click();}
async function confirm(p){await p.getByRole('checkbox').check();await p.getByRole('button',{name:'Bekräfta filialändringen',exact:true}).click();}
test('closed panel performs zero calls; explicit open reads bounded active list and legal company',async()=>{const p=await setup();try{assert.equal(await p.evaluate(()=>window.fixture.listCalls.length),0);await open(p);await expect(p.getByText('Handlaren AB',{exact:true})).toBeVisible();const f=await p.evaluate(()=>window.fixture);assert.deepEqual(f.listCalls,[{companyId:COMPANY,status:'active',pageKey:null,limit:50}]);}finally{await p.close();}});
test('demo and unauthorized roles never invoke branch API',async()=>{for(const props of [{demo:true},{role:'sales'},{role:'finance'},{role:'viewer'}]){const p=await setup(state(),{},props);try{assert.equal(await p.evaluate(()=>window.fixture.listCalls.length),0);await expect(p.getByRole('button',{name:'Öppna filialregister'})).toHaveCount(0);}finally{await p.close();}}});
test('edit review freezes version and fields; unknown retry preserves nonce and refreshes current list',async()=>{const p=await setup(state(),{saveResponses:[{throw:true}]});try{await open(p);await edit(p);await expect(p.getByRole('heading',{name:'Bekräfta filialändring',exact:true})).toBeFocused();await expect(p.getByRole('button',{name:'Bekräfta filialändringen',exact:true})).toBeDisabled();assert.equal(await p.evaluate(()=>window.fixture.saveCalls.length),0);await confirm(p);await expect(p.getByRole('alert')).toContainText('okänt');await p.getByRole('button',{name:'Bekräfta filialändringen',exact:true}).click();await expect(p.getByRole('status')).toContainText('aktuella listan');const f=await p.evaluate(()=>window.fixture);assert.deepEqual(f.saveCalls[0],f.saveCalls[1]);assert.equal(f.saveCalls[0].expectedVersion,3);assert.equal(f.saveCalls[0].fields.name,'Ny filial');await expect(p.getByRole('heading',{name:'Centrum',exact:true})).toBeVisible();}finally{await p.close();}});
test('create generates stable branch UUID version zero and optional blank contacts stay null',async()=>{const p=await setup();try{await open(p);await p.getByRole('button',{name:'Ny filial',exact:true}).click();await p.getByLabel('Filialnamn',{exact:true}).fill('Söder');await p.getByLabel('Filialkod',{exact:true}).fill('soder');await p.getByLabel('Gatuadress',{exact:true}).fill('Gatan 3');await p.getByLabel('Postnummer (5 siffror)',{exact:true}).fill('11122');await p.getByLabel('Ort',{exact:true}).fill('Stockholm');await p.getByRole('button',{name:'Granska filialuppgifter'}).click();await confirm(p);const f=await p.evaluate(()=>window.fixture);assert.equal(f.saveCalls[0].expectedVersion,0);assert.equal(f.saveCalls[0].branchId,'20000000-0000-4000-8000-000000000001');assert.equal(f.saveCalls[0].fields.publicEmail,null);assert.equal(f.saveCalls[0].fields.publicPhone,null);}finally{await p.close();}});
test('invalid code, postal address, uppercase email and phone prevent review',async()=>{const p=await setup();try{await open(p);await p.getByRole('button',{name:/Redigera filial/}).click();for(const [label,bad,good] of [['Filialkod','Invalid CODE','centrum'],['Postnummer (5 siffror)','12 45','12345'],['Offentlig e-post (valfri)','Upper@example.com','butik@example.com'],['Offentligt telefonnummer (valfritt)','123','0701234567'],['Offentligt telefonnummer (valfritt)','070.1234567','0701234567'],['Offentligt telefonnummer (valfritt)','070+1234567','0701234567']]){await p.getByLabel(label,{exact:true}).fill(bad);await expect(p.getByRole('button',{name:'Granska filialuppgifter'})).toBeDisabled();await p.getByLabel(label,{exact:true}).fill(good);}assert.equal(await p.evaluate(()=>window.fixture.saveCalls.length),0);}finally{await p.close();}});
test('archive and reactivate require reason, explicit review and version CAS',async()=>{for(const status of ['active','archived']){const b={...branch(),status};const p=await setup({...state(),branches:[b]});try{await open(p);await p.getByRole('button',{name:status==='active'?/Arkivera filial/:/Återaktivera filial/}).click();await expect(p.getByRole('button',{name:'Granska statusändring'})).toBeDisabled();await p.getByLabel('Motivering',{exact:true}).fill('Ändrad verksamhet');await p.getByRole('button',{name:'Granska statusändring'}).click();await confirm(p);const f=await p.evaluate(()=>window.fixture);assert.equal(f.statusCalls[0].status,status==='active'?'archived':'active');assert.equal(f.statusCalls[0].expectedVersion,3);assert.equal(f.statusCalls[0].reason,'Ändrad verksamhet');}finally{await p.close();}}});
test('archived filter has no edit button and pagination uses original UUID cursor',async()=>{const a={...branch(),status:'archived'};const initial={...state(),status:'archived',branches:[a],nextPageKey:BRANCH};const next={...initial,branches:[{...a,id:id(5),fields:{...fields(),name:'Andra'}}],nextPageKey:null};const p=await setup(state(),{listResponses:[{ok:true,...state()},{ok:true,...initial},{ok:true,...next}]});try{await open(p);await p.getByLabel('Visa filialer').selectOption('archived');await expect(p.getByRole('button',{name:/Redigera filial/})).toHaveCount(0);await p.getByRole('button',{name:'Läs in fler filialer'}).click();await expect(p.getByRole('heading',{name:'Andra',exact:true})).toBeVisible();assert.equal(await p.evaluate(()=>window.fixture.listCalls[2].pageKey),BRANCH);}finally{await p.close();}});
test('conflict clears old review and requires fresh list before editing again',async()=>{const p=await setup(state(),{saveResponses:[{ok:false,code:'conflict',message:'Versionen har ändrats.'}]});try{await open(p);await edit(p);await confirm(p);await expect(p.getByRole('alert')).toContainText('ändrats');await expect(p.getByRole('checkbox')).toHaveCount(0);await expect(p.getByRole('button',{name:/Redigera filial/})).toHaveCount(0);await p.getByRole('button',{name:'Uppdatera filialer'}).click();await expect(p.getByRole('heading',{name:'Centrum',exact:true})).toBeVisible();}finally{await p.close();}});
test('fresh access denial after historical receipt removes legal and branch data',async()=>{const p=await setup(state(),{listResponses:[{ok:true,...state()},{ok:false,code:'access_denied',message:'Åtkomst återkallad.'}]});try{await open(p);await edit(p);await confirm(p);await expect(p.getByRole('alert')).toContainText('återkallad');await expect(p.getByText('Handlaren AB',{exact:true})).toHaveCount(0);await expect(p.getByText('butik@example.com',{exact:true})).toHaveCount(0);await expect(p.getByRole('checkbox')).toHaveCount(0);await expect(p.getByText('aktuella listan',{exact:false})).toHaveCount(0);}finally{await p.close();}});
test('late response from prior company, actor or role cannot populate new scope',async()=>{const p=await setup(state(),{listResponses:[{defer:true}]});try{await p.getByRole('button',{name:'Öppna filialregister'}).click();await p.evaluate(({companyId,userId})=>window.mountBranches({companyId,userId,role:'viewer'}),{companyId:id(99),userId:id(100)});await p.evaluate(s=>window.fixture.resolve({ok:true,...s}),state());await expect(p.getByRole('heading',{name:'Centrum',exact:true})).toHaveCount(0);assert.equal(await p.evaluate(()=>window.fixture.saveCalls.length),0);}finally{await p.close();}});
test('mobile review and controls fit viewport; text is never interpreted as HTML',async()=>{const b=branch();b.fields.name='<img src=x onerror=alert(1)>';const p=await setup({...state(),branches:[b]});try{await p.setViewportSize({width:390,height:844});await open(p);await expect(p.getByRole('heading',{name:b.fields.name,exact:true})).toBeVisible();assert.equal(await p.locator('img').count(),0);await edit(p);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=390));await expect(p.getByRole('checkbox')).not.toBeChecked();}finally{await p.close();}});
test('closing panel clears private view; reopening revalidates without mutations',async()=>{const p=await setup();try{await open(p);await p.getByRole('button',{name:'Stäng filialregister'}).click();await expect(p.getByText('Handlaren AB',{exact:true})).toHaveCount(0);await open(p);assert.equal(await p.evaluate(()=>window.fixture.listCalls.length),2);assert.equal(await p.evaluate(()=>window.fixture.saveCalls.length),0);}finally{await p.close();}});
