import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium: playwright, expect} = require('@playwright/test');
const Chromium = require('@sparticuz/chromium').default;
const {webpack} = require('next/dist/compiled/webpack/webpack');
const repo = fileURLToPath(new URL('../', import.meta.url));
let browser, directory, styles;
before(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trafexa-email-ui-'));
  styles = await readFile(resolve(repo, 'src/app/globals.css'), 'utf8');
  const config = {mode:'development',target:'web',devtool:false,context:repo,
    entry:resolve(repo,'tests/helpers/email-delivery-ui/entry.js'),output:{path:directory,filename:'fixture.js'},
    resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/email/actions':resolve(repo,'tests/helpers/email-delivery-ui/actions.js')}},
    module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/platform-admin-ui/swc-loader.cjs')}]}};
  await new Promise((done,fail) => {const compiler=webpack(config);compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?fail(error??new Error(stats.toString({all:false,errors:true}))):done()));});
  browser = await playwright.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(arg=>arg!=='--single-process'),headless:true});
});
after(async () => {await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function setup({statusResponses=[],sendResponses=[],transport='configured',diagnostics,invitationTransport,counts={pending:2,accepted:1,rejected:0,unknown:0}}={}) {
  const page=await browser.newPage({viewport:{width:320,height:800}});
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<style>${styles}</style><div id="root"></div>`);
  await page.evaluate(data=>{window.fixture={...data,reads:0,sends:[],status:{ok:true,transport:data.transport,counts:data.counts,diagnostics:data.diagnostics,invitationTransport:data.invitationTransport}};},{statusResponses,sendResponses,transport,diagnostics,invitationTransport,counts});
  await page.addScriptTag({path:resolve(directory,'fixture.js')});
  await expect(page.getByRole('button',{name:'Uppdatera mejlstatus'})).toBeEnabled();
  return page;
}
test('failed status read is retryable without sending and fits narrow mobile viewport',async()=>{
  const page=await setup({statusResponses:[{throw:true}]});
  try {
    await expect(page.getByRole('alert')).toContainText('Mejlstatus kunde inte hämtas');
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.getByRole('button',{name:'Uppdatera mejlstatus'}).click();
    await expect(page.getByRole('heading',{name:'Automatiska händelsemejl är aktiverade',exact:true})).toBeVisible();
    assert.deepEqual(await page.evaluate(()=>({reads:window.fixture.reads,sends:window.fixture.sends})),{reads:2,sends:[]});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=320),true);
  } finally {await page.close();}
});
for(const result of [{ok:false,message:'Åtkomst kunde inte verifieras.'},{throw:true}])test(`dispatch ${result.throw?'unknown transport':'denial'} clears confirmation and recovers through read-only status`,async()=>{
  const page=await setup({sendResponses:[result]});
  try {
    await page.getByText('Manuellt utskick av väntande mejl',{exact:true}).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Skicka nästa mejl',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText(result.message??'Utskicket kunde inte verifieras.');
    await expect(page.getByText('Hämtar mejlstatus…',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Uppdatera mejlstatus'}).click();
    await page.getByText('Manuellt utskick av väntande mejl',{exact:true}).click();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByRole('button',{name:'Skicka nästa mejl',exact:true})).toBeDisabled();
    assert.deepEqual(await page.evaluate(()=>window.fixture.sends),[{acknowledged:true}]);
    assert.equal(await page.evaluate(()=>window.fixture.reads),2);
  } finally {await page.close();}
});
test('unconfigured transport permits status refresh but prevents dispatch',async()=>{
  const page=await setup({transport:'unconfigured'});
  try {
    await page.getByText('Manuellt utskick av väntande mejl',{exact:true}).click();
    await expect(page.getByRole('checkbox')).toBeDisabled();
    await expect(page.getByRole('button',{name:'Skicka nästa mejl',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Uppdatera mejlstatus'}).click();
    await expect(page.getByRole('button',{name:'Uppdatera mejlstatus'})).toBeEnabled();
    assert.deepEqual(await page.evaluate(()=>window.fixture.sends),[]);
  } finally {await page.close();}
});

for(const width of [390,1440])test(`transactional email presentation at ${width}px`,async()=>{
 const page=await setup({transport:'unconfigured',diagnostics:{enabled:false,domainVerified:true,credentialsPresent:true,projectConfigured:true},invitationTransport:'configured'});try{await page.setViewportSize({width,height:1000});await expect(page.getByRole('heading',{name:'Transaktionsmejl'})).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await expect(page.getByRole('checkbox')).toBeHidden();await expect(page.getByRole('heading',{name:'Automatiska händelsemejl är pausade'})).toBeVisible();if(process.env.TRAFEXA_EMAIL_SCREENSHOTS){await mkdir(process.env.TRAFEXA_EMAIL_SCREENSHOTS,{recursive:true});await page.screenshot({path:resolve(process.env.TRAFEXA_EMAIL_SCREENSHOTS,`email-${width}.png`),fullPage:true});await page.getByText('Manuellt utskick av väntande mejl',{exact:true}).click();await page.screenshot({path:resolve(process.env.TRAFEXA_EMAIL_SCREENSHOTS,`email-manual-${width}.png`),fullPage:true});}assert.deepEqual(await page.evaluate(()=>window.fixture.sends),[]);}finally{await page.close();}
});

test('paused automation preserves the separately configured welcome flow without a false domain warning',async()=>{
 const page=await setup({transport:'unconfigured',diagnostics:{enabled:false,domainVerified:true,credentialsPresent:true,projectConfigured:true},invitationTransport:'configured'});try{
  await expect(page.getByRole('heading',{name:'Automatiska händelsemejl är pausade'})).toBeVisible();
  await expect(page.getByText(/Välkomstmejl efter godkänd ansökan hanteras separat och är konfigurerade/)).toBeVisible();
  await expect(page.getByText(/Avsändardomänen är inte/)).toHaveCount(0);
  await page.getByText('Manuellt utskick av väntande mejl',{exact:true}).click();await expect(page.getByRole('checkbox')).toBeDisabled();assert.deepEqual(await page.evaluate(()=>window.fixture.sends),[]);
 }finally{await page.close();}
});
test('incomplete configuration identifies actual missing settings without claiming a paused automation flag',async()=>{
 const page=await setup({transport:'unconfigured',diagnostics:{enabled:true,domainVerified:false,credentialsPresent:false,projectConfigured:true}});try{
  await expect(page.getByRole('heading',{name:'Utskicksinställningarna behöver kontrolleras'})).toBeVisible();
  await expect(page.getByText('Avsändardomänen är inte markerad som verifierad i inställningarna.')).toBeVisible();
  await expect(page.getByText('Uppgifter för mejltjänsten saknas.')).toBeVisible();
  await expect(page.getByText('Projektets mejlkoppling saknas.')).toHaveCount(0);
  assert.deepEqual(await page.evaluate(()=>window.fixture.sends),[]);
 }finally{await page.close();}
});
test('an empty queue cannot dispatch even with configured transport',async()=>{
 const page=await setup({counts:{pending:0,accepted:1,rejected:0,unknown:0}});try{
  await page.getByText('Manuellt utskick av väntande mejl',{exact:true}).click();await expect(page.getByRole('checkbox')).toBeDisabled();await expect(page.getByRole('button',{name:'Skicka nästa mejl',exact:true})).toBeDisabled();assert.deepEqual(await page.evaluate(()=>window.fixture.sends),[]);
 }finally{await page.close();}
});
