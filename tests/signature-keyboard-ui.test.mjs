import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium,expect}=require('@playwright/test'),Chromium=require('@sparticuz/chromium').default,{webpack}=require('next/dist/compiled/webpack/webpack');
const repo=fileURLToPath(new URL('../',import.meta.url));let browser,directory,bundle,styles;
const row={id:'signing-1',companyId:'company-1',dealId:'deal-1',draftId:'draft-1',draftVersion:2,documentHash:'a'.repeat(64),renderedTerms:'Kund Anna · Volvo V60 · Pris 125 000,01 kr',canonicalContent:'internal canonical json',status:'pending',revision:1,customerEmail:'anna@example.com',customerSignature:null,companySignature:null,canSign:true,party:'customer',draft:{offerVersion:3,template:{title:'Köpeavtal',version:1},sourceOffer:{company:{name:'Bilbolaget AB',organisation_number:'5568554884'},customer:{name:'Anna',email:'anna@example.com'},vehicle:{registration_number:'ABC123',make:'Volvo',model:'V60',model_year:2022,mileage_km:35000,vin:null},sale_price_ore:'12500001',stock:{vat_scheme:'standard'},vat:{net_price_ore:'10000001',amount_ore:'2500000'},terms:'Ursprungliga offertvillkor'}}};
before(async()=>{styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');directory=await mkdtemp(resolve(tmpdir(),'trafexa-sign-ui-'));bundle=resolve(directory,'fixture.js');const compiler=webpack({mode:'development',target:'web',plugins:[new webpack.optimize.LimitChunkCountPlugin({maxChunks:1})],devtool:false,context:repo,entry:resolve(repo,'tests/helpers/signing-ui/entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/data/customer-document-renewal-actions':resolve(repo,'tests/helpers/customer-document-renewal-ui/unavailable-actions.js'),'@/lib/data/customer-email-actions':resolve(repo,'tests/helpers/customer-email-ui/actions.js'),'@/lib/data/contract-signing-actions':resolve(repo,'tests/helpers/signing-ui/actions.js'),'@/lib/data/contract-archive-integrity-actions':resolve(repo,'tests/helpers/signing-ui/actions.js'),'@/lib/data/contract-archive-actions':resolve(repo,'tests/helpers/signing-ui/actions.js'),'@':resolve(repo,'src')}},module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/contract-ui/swc-loader.cjs')}]}});await new Promise((done,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done())));browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(x=>x!=='--single-process'),headless:true});});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function setup(props={},fixture={}){const page=await browser.newPage({viewport:{width:375,height:900}});await page.route('**/*',r=>r.abort());await page.setContent(`<style>${styles}</style><div id="root"></div>`);await page.evaluate(({row,fixture})=>{window.fixture={templateSigning:row,rows:[row],calls:[],signatures:[],...fixture};let n=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`20000000-0000-4000-8000-${String(++n).padStart(12,'0')}`});if(fixture.blocked)HTMLCanvasElement.prototype.getContext=()=>null;},{row,fixture});await page.addScriptTag({path:bundle});await page.evaluate(p=>window.mountSigning(p),{userId:'user-1',...props});return page;}
async function draw(page){const canvas=page.getByRole('img',{name:'Rita din namnteckning'});await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();await page.mouse.move(box.x+10,box.y+80);await page.mouse.down();for(let i=1;i<=60;i++)await page.mouse.move(box.x+10+i*3,box.y+80+Math.sin(i/5)*25);await page.mouse.up();}

async function keyboardTrace(page,end='Space'){
 const canvas=page.getByRole('img',{name:'Rita din namnteckning'});await canvas.focus();await page.keyboard.press('Space');
 for(const [key,count]of[['ArrowRight',12],['ArrowDown',5],['ArrowLeft',9],['ArrowUp',3],['ArrowRight',12]])for(let n=0;n<count;n++)await page.keyboard.press(key);
 await page.keyboard.press(end);
}
test('keyboard-only deliberate tracing enables native signing review without generating a signature from a name or focus',async()=>{
 const page=await setup();try{
  await page.setViewportSize({width:320,height:1000});
  await page.getByLabel('Ditt fullständiga namn').focus();await page.keyboard.type('Keyboard User');
  const canvas=page.getByRole('img',{name:'Rita din namnteckning'});await canvas.focus();
  await expect(canvas).toBeFocused();await expect(canvas).toHaveAttribute('aria-describedby',/.+/);
  await expect(page.getByRole('button',{name:'Granska min underskrift'})).toBeDisabled();
  assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.kind==='sign').length),0);
  await keyboardTrace(page);await expect(page.getByRole('status')).toContainText('klar att granskas');
  await mkdir('/workspace/scratch/review8-ui',{recursive:true});await page.screenshot({path:'/workspace/scratch/review8-ui/signature-320.png',fullPage:true});
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Rensa namnteckning'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('checkbox')).toBeFocused();await page.keyboard.press('Space');
  await expect(page.getByRole('button',{name:'Granska min underskrift'})).toBeEnabled();
  await page.keyboard.press('Tab');await page.keyboard.press('Enter');
  await expect(page.getByRole('region',{name:'Bekräfta underskrift'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Bekräfta och skriv under'})).toBeEnabled();
  assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.kind==='sign').length),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }finally{await page.close();}
});
test('cursor movement and empty or straight keyboard strokes cannot invent a valid signature; disabled field ignores keys',async()=>{
 const page=await setup({signature:true});try{
  const canvas=page.getByRole('img',{name:'Rita din namnteckning'});await canvas.focus();
  for(let n=0;n<10;n++)await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.evaluate(()=>window.fixture.signatures),[]);
  await page.keyboard.press('Space');await page.keyboard.press('Space');
  assert.equal((await page.evaluate(()=>window.fixture.signatures)).at(-1),null);
  await page.keyboard.press('Enter');for(let n=0;n<8;n++)await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
  assert.equal((await page.evaluate(()=>window.fixture.signatures)).at(-1),null);
  await page.getByRole('button',{name:'Rensa namnteckning'}).click();
  await page.evaluate(()=>window.mountSigning({signature:true,disabled:true}));await expect(canvas).toHaveAttribute('tabindex','-1');
  const before=await page.evaluate(()=>window.fixture.signatures.length);await canvas.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>window.fixture.signatures.length),before);
  await expect(page.getByRole('button',{name:'Rensa namnteckning'})).toBeDisabled();
 }finally{await page.close();}
});
test('Escape and moving focus lift the keyboard pen, leave Tab free and preserve a copied validated drawing',async()=>{
 const page=await setup({signature:true});try{
  await keyboardTrace(page,'Escape');await expect(page.getByRole('status')).toContainText('klar att granskas');
  const first=await page.evaluate(()=>window.fixture.signatures.at(-1));assert.ok(first?.[0].points.length>20);
  for(const stroke of first)for(const point of stroke.points)assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=0&&point.x<=600&&point.y>=0&&point.y<=160);
  await page.getByRole('button',{name:'Rensa namnteckning'}).click();
  await keyboardTrace(page,'Tab');await expect(page.getByRole('button',{name:'Rensa namnteckning'})).toBeFocused();
  await expect(page.getByRole('status')).toContainText('klar att granskas');
  const saved=await page.evaluate(()=>window.fixture.signatures.at(-1));assert.ok(saved?.[0].points.length>20);
  await page.getByRole('button',{name:'Rensa namnteckning'}).click();assert.equal((await page.evaluate(()=>window.fixture.signatures)).at(-1),null);
 }finally{await page.close();}
});
