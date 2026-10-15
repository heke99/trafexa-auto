import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium,expect}=require('@playwright/test');
const Chromium=require('@sparticuz/chromium').default;
const {webpack}=require('next/dist/compiled/webpack/webpack');
const helpers=dirname(fileURLToPath(import.meta.url));
const repo=resolve(helpers,'../../..');
export {expect};
export async function startHarness(){
 const directory=await mkdtemp(resolve(tmpdir(),'trafexa-register-ui-'));
 const bundle=resolve(directory,'fixture.js');
 const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(helpers,'entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.mjs','.js'],alias:{'@/lib/data/create-record-actions$':resolve(helpers,'../finance-request-ui/create-actions.js'),'@/lib/data/register-actions$':resolve(helpers,'actions.js'),'@/lib/data/actions$':resolve(helpers,'actions.js'),'@/lib/data/vehicle-cost-actions$':resolve(helpers,'actions.js'),'next/link$':resolve(helpers,'next-link.js'),'next/navigation$':resolve(helpers,'navigation.js'),'next/dynamic$':resolve(helpers,'dynamic.js'),'@':resolve(repo,'src')}},module:{rules:[{test:/\.tsx?$/,use:resolve(helpers,'swc-loader.cjs')}]},plugins:[new webpack.NormalModuleReplacementPlugin(/^server-only$/,()=>{throw Error('Actual backend code must never enter the register UI harness.');}),new webpack.NormalModuleReplacementPlugin(/^\.\/(dealer-document-hub|dealer-network|deal-fulfilment|company-team|company-store-profile|company-branches|company-public-store|vehicle-calculation|purchase-condition|contract-template-workspace|deal-contracts|vehicle-photo-gallery|advertising-workspace|customer-contact-log|deal-cancellation|deal-trade-ins|deal-trade-in-purchase|stock-import|deal-offers|customer-leads)$/,resource=>{resource.request=resolve(helpers,'unrelated.js');})]});
 await new Promise((done,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done())));
 const styles=await readFile(resolve(repo,'src/app/globals.css'),'utf8');
 const browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(arg=>arg!=='--single-process'),headless:true});
 const audit={posts:[],errors:[]};
 async function page(width=1280){
  const tab=await browser.newPage({viewport:{width,height:900}});
  tab.setDefaultTimeout(7000);
  tab.on('request',request=>{if(request.method()==='POST')audit.posts.push(request.url());});
  tab.on('pageerror',error=>audit.errors.push(String(error)));
  await tab.route('**/*',route=>route.abort('blockedbyclient'));
  await tab.setContent(`<html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${styles}</style><main class="workspace-main" style="width:100%;padding:16px;box-sizing:border-box"><div id="root"></div></main></html>`);
  await tab.evaluate(()=>{
   let serial=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`30000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`});
   window.fixture={reads:[],writes:[],requests:[],responses:{},defaults:{},handlers:{},manual:false,scope:{},criteriaChanges:0,pages:[],
    read(kind,input){const id=this.requests.length,scope=structuredClone(this.scope),next=this.responses[kind]?.shift();this.reads.push({id,kind,input:structuredClone(input)});if(next?.throw)return Promise.reject(Error(next.throw));if(this.manual||next?.wait)return new Promise((resolve,reject)=>this.requests.push({id,kind,input:structuredClone(input),scope,resolve,reject,settled:false}));this.requests.push({id,kind,input:structuredClone(input),scope,settled:true});return Promise.resolve(next??(this.handlers[kind]?this.handlers[kind](input,scope):this.defaults[kind])??{ok:false,error:'QA response not configured'});},
    respond(id,result){const call=this.requests.find(call=>call.id===id);if(!call||call.settled)throw Error('Missing/already settled fixture request '+id);call.settled=true;call.resolve(result);},
    mutate(kind,input){this.writes.push({kind,input:structuredClone(input)});return Promise.resolve(this.responses[kind]?.shift());}
   };
  });
  await tab.addScriptTag({path:bundle});return tab;
 }
 return {audit,page,async close(){await browser.close();await rm(directory,{recursive:true,force:true});},async writeReport(results){const output=process.env.TRAFEXA_REGISTER_QA_DIR;if(!output)return;await mkdir(output,{recursive:true});await writeFile(resolve(output,'node-ui-results.json'),JSON.stringify({date:'2026-10-15',scope:'New register/remote selector actual-source Chromium suite',passed:results.filter(result=>result.ok).length,failed:results.filter(result=>!result.ok).length,results,audit},null,2));}};
}
export const readCount=(page,count)=>page.waitForFunction(count=>window.fixture.reads.length>=count,count);
export const idleRegister=page=>expect(page.locator('section[aria-busy="false"]').first()).toBeVisible();
export const rowIds=page=>page.locator('[data-row-id]').evaluateAll(rows=>rows.map(row=>row.dataset.rowId));
export const normalize=text=>text.replace(/\s+/g,' ').trim();
export const respond=(page,id,result)=>page.evaluate(data=>window.fixture.respond(data.id,data.result),{id,result});
export const queueRegister=(page,result)=>page.evaluate(result=>window.fixture.responses.register=[result],result);
export async function searchRegister(page,query){await page.getByRole('searchbox').fill(query);await page.getByRole('button',{name:'Sök',exact:true}).click();}
export async function installOptionBackend(page,data){await page.evaluate(data=>{
 window.fixture.optionData=data;
 window.fixture.handlers.options=(input,identity)=>{
  const all=window.fixture.optionData[input.kind].filter(row=>input.kind!=='inventory'||row.status==='available');
  const query=(input.query??'').trim().toLowerCase();
  const label=row=>'name'in row?[row.name,row.email,row.phone].filter(Boolean).join(' '):[row.vehicles.make,row.vehicles.model,row.vehicles.registration_number].join(' ');
  const matches=all.filter(row=>label(row).toLowerCase().includes(query));
  const offset=input.cursor?Number(input.cursor.slice('qa:'.length)):0;
  return {ok:true,page:{...identity,kind:input.kind,rows:matches.slice(offset,offset+50),selected:all.find(row=>row.id===input.selectedId)??null,totalCount:all.length,filteredCount:matches.length,nextCursor:offset+50<matches.length?`qa:${offset+50}`:null}};
 };
},data);}
