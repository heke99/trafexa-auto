import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium,expect}=require('@playwright/test'),Chromium=require('@sparticuz/chromium').default,{webpack}=require('next/dist/compiled/webpack/webpack');
const repo=fileURLToPath(new URL('../',import.meta.url)),helpers=resolve(repo,'tests/helpers/vehicle-photo-ui');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const props={companyId:id(1),stockId:id(2),userId:id(3),canEdit:true};
const photo={id:id(4),companyId:id(1),stockId:id(2),contentType:'image/png',sizeBytes:3,version:1,status:'active',createdAt:'2026-11-15T10:00:00Z'};
let browser,directory,bundle,styles;
before(async()=>{
 directory=await mkdtemp(resolve(tmpdir(),'trafexa-photo-ui-'));bundle=resolve(directory,'fixture.js');styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');
 const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(helpers,'entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/vehicle-photos/actions':resolve(helpers,'actions.js'),'@':resolve(repo,'src')}},module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/purchase-condition-ui/swc-loader.cjs')}]}});
 await new Promise((done,reject)=>compiler.run((e,s)=>compiler.close(()=>e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):done())));
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(a=>a!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function setup(overrides={},options={},width=320){
 const page=await browser.newPage({viewport:{width,height:900}});await page.route('**/*',r=>r.abort());await page.setContent(`<style>${styles}</style><div id="root" style="padding:16px;box-sizing:border-box"></div>`);
 await page.evaluate(({photo,overrides})=>{window.fixture={base:photo,photos:[photo],reads:[],uploads:[],archives:[],busy:[],denials:[],changes:[],uploadResponses:[],archiveResponses:[],readResponses:[],...overrides};let n=10;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`10000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});},{photo,overrides});
 await page.addScriptTag({path:bundle});await page.evaluate(p=>window.mountPhotos(p),{...props,...options});if(!options.demo)await expect(page.getByRole('button',{name:'Läs in bilder'})).toBeEnabled();return page;
}
const file={name:'car.png',mimeType:'image/png',buffer:Buffer.from([1,2,3])};
async function select(page){await page.getByLabel('Välj fordonsbild').setInputFiles(file);}
test('pending and unknown upload freezes file and parent; exact File and IDs survive retry',async()=>{
 const page=await setup({uploadResponses:[{hold:true}]});try{
  await select(page);await page.getByRole('button',{name:'Spara bild privat'}).click();await page.waitForFunction(()=>typeof window.fixture.releaseUpload==='function');
  assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),true);await expect(page.getByLabel('Välj fordonsbild')).toBeDisabled();
  await page.evaluate(()=>window.fixture.releaseUpload({ok:false,code:'unavailable',message:'Okänt uppladdningsresultat'}));
  await expect(page.getByRole('button',{name:'Kontrollera samma bilduppladdning'})).toBeEnabled();await expect(page.getByRole('button',{name:'Läs in bilder'})).toBeDisabled();assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),true);
  await page.getByRole('button',{name:'Kontrollera samma bilduppladdning'}).click();await expect(page.getByRole('status')).toContainText('Bilden har sparats privat');
  const calls=await page.evaluate(()=>window.fixture.uploads);assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),false);
  await expect(page.getByLabel('Välj fordonsbild')).toHaveValue('');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }finally{await page.close();}
});
test('definite upload rejection releases parent and allows a deliberately new file',async()=>{
 const page=await setup({uploadResponses:[{ok:false,code:'invalid_input',message:'Ogiltig bild'}]});try{
  await select(page);await page.getByRole('button',{name:'Spara bild privat'}).click();await expect(page.getByRole('alert')).toContainText('Ogiltig bild');assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),false);await expect(page.getByLabel('Välj fordonsbild')).toBeEnabled();
  await select(page);await page.getByRole('button',{name:'Spara bild privat'}).click();await expect(page.getByRole('status')).toContainText('Bilden har sparats privat');const calls=await page.evaluate(()=>window.fixture.uploads);assert.notEqual(calls[0].photoId,calls[1].photoId);
 }finally{await page.close();}
});
test('unknown archive retains exact review and nonce, locks cancellation and cannot unlock on wrong proof',async()=>{
 const page=await setup({archiveResponses:[{throw:true},{ok:true,photo:{...photo,stockId:id(99),status:'archived',version:2}}]});try{
  await page.getByRole('button',{name:'Ta bort bild',exact:true}).click();await page.getByRole('button',{name:'Bekräfta borttagning'}).click();await expect(page.getByRole('alert')).toContainText('Ändringen kunde inte verifieras');await expect(page.getByRole('button',{name:'Avbryt',exact:true})).toBeDisabled();await expect(page.getByLabel('Välj fordonsbild')).toBeDisabled();assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),true);
  await page.getByRole('button',{name:'Bekräfta borttagning'}).click();await expect(page.getByRole('button',{name:'Bekräfta borttagning'})).toBeEnabled();assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),true);
  await page.evaluate(photo=>{window.fixture.photos=[];window.fixture.archiveResponses.push({ok:true,photo:{...photo,status:'archived',version:2}});},photo);
  await page.getByRole('button',{name:'Bekräfta borttagning'}).click();await expect(page.getByRole('heading',{name:'Ta bort bilden från nya annonser?'})).toHaveCount(0);const calls=await page.evaluate(()=>window.fixture.archives);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1],calls[2]);assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),false);
 }finally{await page.close();}
});
test('verified upload followed by failed readback does not become an ambiguous write or offer another send',async()=>{
 const page=await setup();try{
  await select(page);await page.evaluate(()=>window.fixture.readResponses=[{throw:true}]);await page.getByRole('button',{name:'Spara bild privat'}).click();await expect(page.getByRole('alert')).toContainText('Bilden är sparad');await expect(page.getByRole('button',{name:'Kontrollera samma bilduppladdning'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Läs in bilder'})).toBeEnabled();assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),false);
  await page.getByRole('button',{name:'Läs in bilder'}).click();await expect(page.getByRole('img')).toHaveCount(2);assert.equal(await page.evaluate(()=>window.fixture.uploads.length),1);
 }finally{await page.close();}
});
test('late old-scope upload cannot restore photo or success in another user scope',async()=>{
 const page=await setup({uploadResponses:[{hold:true}]});try{
  await select(page);await page.getByRole('button',{name:'Spara bild privat'}).click();await page.waitForFunction(()=>typeof window.fixture.releaseUpload==='function');const sent=await page.evaluate(()=>window.fixture.uploads[0]);
  await page.evaluate(p=>{window.fixture.photos=[];window.mountPhotos({...p,stockId:'10000000-0000-4000-8000-000000000099',userId:'10000000-0000-4000-8000-000000000098'});},props);
  await page.evaluate(({sent,photo})=>window.fixture.releaseUpload({ok:true,photo:{...photo,id:sent.photoId}}),{sent,photo});await expect(page.getByRole('img')).toHaveCount(0);await expect(page.getByRole('status')).toHaveCount(0);await expect(page.getByLabel('Välj fordonsbild')).toHaveValue('');
 }finally{await page.close();}
});
test('revoked photo access erases private state and notifies enclosing vehicle',async()=>{
 const page=await setup({archiveResponses:[{ok:false,code:'access_denied',message:'Bildbehörigheten upphörde'}]});try{
  await select(page);await page.getByRole('button',{name:'Ta bort bild',exact:true}).click();await page.getByRole('button',{name:'Bekräfta borttagning'}).click();await expect(page.getByRole('img')).toHaveCount(0);await expect(page.getByLabel('Välj fordonsbild')).toHaveCount(0);assert.deepEqual(await page.evaluate(()=>window.fixture.denials),['Bildbehörigheten upphörde']);assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),false);
 }finally{await page.close();}
});
test('demo and read-only gallery expose no write controls or network mutations',async()=>{
 for(const options of [{demo:true},{canEdit:false}]){const page=await setup({},options);try{await expect(page.getByLabel('Välj fordonsbild')).toHaveCount(0);await expect(page.getByRole('button',{name:'Ta bort bild',exact:true})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.fixture.uploads.length+window.fixture.archives.length),0);if(options.demo)assert.equal(await page.evaluate(()=>window.fixture.reads.length),0);}finally{await page.close();}}
});

test('late archived-photo receipt cannot restore success after switching stock and user',async()=>{
 const page=await setup({archiveResponses:[{hold:true}]});try{
  await page.getByRole('button',{name:'Ta bort bild',exact:true}).click();await page.getByRole('button',{name:'Bekräfta borttagning'}).click();await page.waitForFunction(()=>typeof window.fixture.releaseArchive==='function');assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),true);
  await page.evaluate(p=>{window.fixture.photos=[];window.mountPhotos({...p,stockId:'10000000-0000-4000-8000-000000000099',userId:'10000000-0000-4000-8000-000000000098'});},props);
  await page.evaluate(photo=>window.fixture.releaseArchive({ok:true,photo:{...photo,status:'archived',version:2}}),photo);
  await expect(page.getByRole('button',{name:'Läs in bilder'})).toBeEnabled();await expect(page.getByRole('heading',{name:'Ta bort bilden från nya annonser?'})).toHaveCount(0);await expect(page.getByText('Bilden har tagits bort från nya bildval.',{exact:false})).toHaveCount(0);assert.equal(await page.evaluate(()=>window.fixture.busy.at(-1)),false);
 }finally{await page.close();}
});
