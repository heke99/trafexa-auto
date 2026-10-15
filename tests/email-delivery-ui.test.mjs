import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
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
async function setup({statusResponses=[],sendResponses=[],transport='configured'}={}) {
  const page=await browser.newPage({viewport:{width:320,height:800}});
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<style>${styles}</style><div id="root"></div>`);
  await page.evaluate(data=>{window.fixture={...data,reads:0,sends:[],status:{ok:true,transport:data.transport,counts:{pending:2,accepted:1,rejected:0,unknown:0}}};},{statusResponses,sendResponses,transport});
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
    await expect(page.getByText('Mejltransport aktiverad.',{exact:true})).toBeVisible();
    assert.deepEqual(await page.evaluate(()=>({reads:window.fixture.reads,sends:window.fixture.sends})),{reads:2,sends:[]});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=320),true);
  } finally {await page.close();}
});
for(const result of [{ok:false,message:'Åtkomst kunde inte verifieras.'},{throw:true}])test(`dispatch ${result.throw?'unknown transport':'denial'} clears confirmation and recovers through read-only status`,async()=>{
  const page=await setup({sendResponses:[result]});
  try {
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'Skicka nästa mejl',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText(result.message??'Utskicket kunde inte verifieras.');
    await expect(page.getByText('Hämtar mejlstatus…',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Uppdatera mejlstatus'}).click();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByRole('button',{name:'Skicka nästa mejl',exact:true})).toBeDisabled();
    assert.deepEqual(await page.evaluate(()=>window.fixture.sends),[{acknowledged:true}]);
    assert.equal(await page.evaluate(()=>window.fixture.reads),2);
  } finally {await page.close();}
});
test('unconfigured transport permits status refresh but prevents dispatch',async()=>{
  const page=await setup({transport:'unconfigured'});
  try {
    await expect(page.getByRole('checkbox')).toBeDisabled();
    await expect(page.getByRole('button',{name:'Skicka nästa mejl',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Uppdatera mejlstatus'}).click();
    await expect(page.getByRole('button',{name:'Uppdatera mejlstatus'})).toBeEnabled();
    assert.deepEqual(await page.evaluate(()=>window.fixture.sends),[]);
  } finally {await page.close();}
});
