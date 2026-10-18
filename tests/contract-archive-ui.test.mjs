import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),{chromium,expect}=require('@playwright/test'),Chromium=require('@sparticuz/chromium').default,{webpack}=require('next/dist/compiled/webpack/webpack');
const repo=fileURLToPath(new URL('../',import.meta.url));
const COMPANY='10000000-0000-4000-8000-000000000001',ACTOR='10000000-0000-4000-8000-000000000002',SIGNING='10000000-0000-4000-8000-000000000003',DEAL='10000000-0000-4000-8000-000000000004',DRAFT='10000000-0000-4000-8000-000000000005';
const row={id:SIGNING,companyId:COMPANY,dealId:DEAL,draftId:DRAFT,draftVersion:2,documentHash:'a'.repeat(64),renderedTerms:'Fiktivt köpeavtal',canonicalContent:'private canonical json',status:'completed',revision:3,completedAt:'2026-10-15T10:00:00.000Z',createdAt:'2026-10-15T09:00:00.000Z',customerEmail:'anna@example.invalid',customerSignature:{fullName:'Anna Exempel'},companySignature:{fullName:'Bo Handlare'},canSign:false,party:null,draft:{offerVersion:3,template:{title:'Köpeavtal',version:1},sourceOffer:{company:{name:'Fiktiva Bilar AB',organisation_number:'Fiktivt företag'},customer:{name:'Anna Exempel',email:'anna@example.invalid'},vehicle:{registration_number:'ABC123',make:'Volvo',model:'V60',model_year:2022,mileage_km:35000,vin:null},sale_price_ore:'12500001',stock:{vat_scheme:'standard'},vat:{net_price_ore:'10000001',amount_ore:'2500000'},terms:'Fiktiva offertvillkor'}}};
const stored={id:'10000000-0000-4000-8000-000000000006',signingId:SIGNING,companyId:COMPANY,dealId:DEAL,draftId:DRAFT,draftVersion:2,documentContentSha256:row.documentHash,signingRevision:3,rendererVersion:'trafexa-native-v1',evidenceSchemaVersion:1,archivedAt:'2026-10-15T11:00:00.000Z',pdf:{objectPath:`${COMPANY}/${SIGNING}/private-original.pdf`,sha256:'b'.repeat(64),bytes:2048,mimeType:'application/pdf'},evidence:{objectPath:`${COMPANY}/${SIGNING}/private-evidence.json`,sha256:'c'.repeat(64),bytes:1024,mimeType:'application/json'}};
const success=(archive=null,override={})=>({ok:true,archive,companyId:COMPANY,signingId:SIGNING,actorId:ACTOR,role:'owner',...override});
let browser,directory,bundle,css;
const audit={httpPosts:0,uncaught:[]};

before(async()=>{
 directory=await mkdtemp(resolve(tmpdir(),'trafexa-contract-archive-ui-'));bundle=resolve(directory,'fixture.js');css=await readFile(resolve(repo,'src/app/globals.css'),'utf8');
 const compiler=webpack({mode:'development',target:'web',devtool:false,context:repo,entry:resolve(repo,'tests/helpers/contract-archive-ui/entry.js'),output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/lib/data/customer-document-renewal-actions':resolve(repo,'tests/helpers/customer-document-renewal-ui/unavailable-actions.js'),'@/lib/data/customer-email-actions':resolve(repo,'tests/helpers/customer-email-ui/actions.js'),'@/lib/data/contract-signing-actions':resolve(repo,'tests/helpers/contract-archive-ui/actions.js'),'@/lib/data/contract-archive-integrity-actions':resolve(repo,'tests/helpers/contract-archive-ui/actions.js'),'@/lib/data/contract-archive-actions':resolve(repo,'tests/helpers/contract-archive-ui/actions.js'),'@':resolve(repo,'src')}},module:{rules:[{test:/\.tsx?$/,use:resolve(repo,'tests/helpers/contract-ui/swc-loader.cjs')}]},plugins:[new webpack.optimize.LimitChunkCountPlugin({maxChunks:1}),new webpack.NormalModuleReplacementPlugin(/^server-only$/,()=>{throw Error('Backend implementations must not enter this UI harness.');})]});
 await new Promise((done,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done())));
 browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args.filter(value=>value!=='--single-process'),headless:true});
});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});assert.equal(audit.httpPosts,0);assert.deepEqual(audit.uncaught,[]);});

async function setup({props={},fixture={},width=375,integrated=false}={}){
 const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',error=>audit.uncaught.push(error.message));page.on('request',request=>{if(request.method()==='POST')audit.httpPosts++;});await page.route('**/*',route=>route.abort());await page.setContent('<main style="padding:12px;min-width:0"><div id="root"></div></main>');await page.addStyleTag({content:css});
 await page.evaluate(({fixture,defaultRead,defaultWrite,defaultVerify,row})=>{
  window.fixture={calls:[],signingCalls:[],signings:[row],responses:{read:[],archive:[],verify:[]},pending:{},defaultRead,defaultWrite,defaultVerify,manual:false,...fixture};
  window.fixture.call=async(kind,input)=>{const current=window.fixture,id=current.calls.length;current.calls.push({id,kind,input});if(current.manual)return new Promise((resolve,reject)=>{current.pending[id]={resolve,reject};});const answer=current.responses[kind]?.shift()??(kind==='read'?current.defaultRead:kind==='verify'?current.defaultVerify:current.defaultWrite);if(answer?.throw)throw Error('Mocked response lost after a possible commit.');return answer;};
  let nonce=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>`20000000-0000-4000-8000-${String(++nonce).padStart(12,'0')}`});
 },{fixture,defaultRead:success(),defaultWrite:success(stored),defaultVerify:{...success(stored),checkedAt:'2026-10-18T10:12:00.000Z'},row});
 await page.addScriptTag({path:bundle});const finalProps={signing:row,companyId:COMPANY,userId:ACTOR,role:'owner',...props};await page.evaluate(({props,integrated})=>integrated?window.mountArchiveSignings(props):window.mountArchive(props),{props:finalProps,integrated});return page;
}
const panel=page=>page.getByRole('region',{name:'Avtalets originalarkiv',exact:true});
const checkbox=page=>page.getByRole('checkbox',{name:'Jag vill arkivera det färdigsignerade avtalet och signeringsbeviset som original.',exact:true});
const initialButton=page=>page.getByRole('button',{name:'Arkivera avtalets original',exact:true});
const retryButton=page=>page.getByRole('button',{name:'Försök arkivera original igen',exact:true});
const open=page=>page.getByText('Originalarkiv för färdigsignerat avtal',{exact:true}).click();
const verifyNull=async page=>{await open(page);await expect(panel(page).getByText('Originalet har inte arkiverats.',{exact:false})).toBeVisible();};
const calls=page=>page.evaluate(()=>window.fixture.calls);
const respond=(page,id,result,reject=false)=>page.evaluate(({id,result,reject})=>{const pending=window.fixture.pending[id];delete window.fixture.pending[id];reject?pending.reject(Error('Mocked acknowledgement lost.')):pending.resolve(result);},{id,result,reject});

test('completed signing archive is lazy under StrictMode and labels generated copies only after verified null',async()=>{
 const page=await setup({integrated:true,props:{dealId:DEAL,draftId:DRAFT}});
 try{
  await expect(page.getByText('Färdigsignerat',{exact:true})).toBeVisible();assert.deepEqual(await calls(page),[]);await expect(page.getByRole('link')).toHaveCount(0);
  await verifyNull(page);assert.deepEqual((await calls(page)).map(call=>call.kind),['read']);await expect(page.getByRole('link',{name:'Hämta genererad PDF-kopia av signerat avtal',exact:true})).toHaveAttribute('href',`/api/contract-signings/${SIGNING}/pdf?companyId=${COMPANY}`);
  await expect(initialButton(page)).toBeDisabled();await checkbox(page).check();assert.equal((await calls(page)).length,1);await initialButton(page).click();await expect(panel(page).getByRole('status')).toContainText('Originalet är arkiverat.');
  const archiveCalls=(await calls(page)).filter(call=>call.kind==='archive');assert.equal(archiveCalls.length,1);assert.deepEqual(archiveCalls[0].input,{companyId:COMPANY,signingId:SIGNING,requestId:'20000000-0000-4000-8000-000000000001'});
  await expect(page.getByRole('link',{name:'Hämta arkiverat avtalsoriginal (PDF)',exact:true})).toHaveAttribute('href',`/api/contract-signings/${SIGNING}/pdf?companyId=${COMPANY}`);await expect(checkbox(page)).toHaveCount(0);await expect(initialButton(page)).toHaveCount(0);
 }finally{await page.close();}
});

test('pending and unavailable signings never render or read an original archive',async()=>{
 for(const status of ['pending','unavailable']){const page=await setup({integrated:true,props:{dealId:DEAL,draftId:DRAFT},fixture:{signings:[{...row,status,canSign:false}]}});try{await expect(page.getByText('Köpeavtal · Avtalsversion 2',{exact:true})).toBeVisible();await expect(page.getByText('Originalarkiv för färdigsignerat avtal',{exact:true})).toHaveCount(0);assert.deepEqual(await calls(page),[]);}finally{await page.close();}}
});

for(const role of ['admin','finance','customer']){
 test(`${role} reads exact stored original links with its own scope and no duplicate archive control`,async()=>{
  const customer=role==='customer',page=await setup({props:{companyId:customer?undefined:COMPANY,role:customer?undefined:role},fixture:{defaultRead:success(stored,{role})}});
  try{await open(page);await expect(page.getByRole('link',{name:'Hämta arkiverat signeringsbevis',exact:true})).toHaveAttribute('href',`/api/contract-signings/${SIGNING}/evidence${customer?'':`?companyId=${COMPANY}`}`);await expect(page.getByText('Originalet är arkiverat.',{exact:true})).toBeVisible();assert.equal((await calls(page))[0].input.companyId,customer?undefined:COMPANY);await expect(page.getByRole('checkbox')).toHaveCount(0);assert.equal((await calls(page)).filter(call=>call.kind==='archive').length,0);assert.equal(await page.locator('body').innerText().then(text=>text.includes(stored.pdf.objectPath)),false);}finally{await page.close();}
 });
}

test('admin can archive only after a verified absent archive and explicit confirmation',async()=>{
 const page=await setup({props:{role:'admin'},fixture:{defaultRead:success(null,{role:'admin'}),defaultWrite:success(stored,{role:'admin'})}});
 try{await verifyNull(page);await expect(initialButton(page)).toBeDisabled();await checkbox(page).check();await initialButton(page).click();await expect(page.getByText('Originalet är arkiverat.',{exact:true})).toBeVisible();assert.equal((await calls(page)).filter(call=>call.kind==='archive').length,1);}finally{await page.close();}
});

for(const role of ['finance','customer']){
 test(`${role} can read verified generated copies but never receives an archive write control`,async()=>{
  const page=await setup({props:{companyId:role==='customer'?undefined:COMPANY,role:role==='customer'?undefined:role},fixture:{defaultRead:success(null,{role})}});
  try{await verifyNull(page);await expect(page.getByRole('link')).toHaveCount(2);await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(initialButton(page)).toHaveCount(0);assert.equal((await calls(page)).filter(call=>call.kind==='archive').length,0);}finally{await page.close();}
 });
}

test('unknown acknowledgement hides stale null/original claims and preserves exact UUID and consent over close/reopen retry',async()=>{
 const page=await setup({fixture:{responses:{read:[],archive:[{throw:true},success(stored)]}}});
 try{await verifyNull(page);await checkbox(page).check();await initialButton(page).click();await expect(page.getByRole('alert')).toContainText('kunde inte bekräftas');await expect(page.getByRole('link')).toHaveCount(0);await expect(panel(page).getByText('Originalet har inte arkiverats.',{exact:false})).toHaveCount(0);await expect(panel(page).getByText('Originalet är arkiverat.',{exact:true})).toHaveCount(0);await expect(checkbox(page)).toBeChecked();await open(page);await open(page);await expect(checkbox(page)).toBeChecked();await retryButton(page).click();await expect(page.getByText('Originalet är arkiverat.',{exact:true})).toBeVisible();const writes=(await calls(page)).filter(call=>call.kind==='archive');assert.equal(writes.length,2);assert.deepEqual(writes[0].input,writes[1].input);}finally{await page.close();}
});

test('configuration failure is visible and never claims a completed archive; status refresh retains action failure and retry UUID',async()=>{
 const page=await setup({fixture:{responses:{read:[],archive:[{ok:false,code:'configuration_missing',error:'Serverns arkivlagring saknar konfiguration.'},success(stored)]}}});
 try{await verifyNull(page);await checkbox(page).check();await initialButton(page).click();await expect(page.getByRole('alert')).toContainText('inte konfigurerad');await expect(page.getByRole('link')).toHaveCount(0);await expect(page.getByText('Originalet är arkiverat.',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Kontrollera arkivstatus',exact:true}).click();await expect(page.getByRole('link',{name:'Hämta genererad PDF-kopia av signerat avtal',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toContainText('inte konfigurerad');await expect(checkbox(page)).toBeChecked();await retryButton(page).click();await expect(page.getByText('Originalet är arkiverat.',{exact:true})).toBeVisible();const writes=(await calls(page)).filter(call=>call.kind==='archive');assert.deepEqual(writes[0].input,writes[1].input);}finally{await page.close();}
});

test('read failure is distinct from a verified absent archive and retry makes no write',async()=>{
 const page=await setup({fixture:{responses:{read:[{ok:false,code:'unavailable',error:'Arkivstatus är tillfälligt otillgänglig.'},success()],archive:[]}}});
 try{await open(page);await expect(page.getByRole('alert')).toContainText('tillfälligt otillgänglig');await expect(page.getByRole('link')).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);await page.getByRole('button',{name:'Kontrollera arkivstatus',exact:true}).click();await expect(page.getByRole('link')).toHaveCount(2);assert.deepEqual((await calls(page)).map(call=>call.kind),['read','read']);}finally{await page.close();}
});

test('pending archive locks duplicate clicks and a late success after close is retained without another mutation',async()=>{
 const page=await setup();
 try{await verifyNull(page);await page.evaluate(()=>window.fixture.manual=true);await checkbox(page).check();await initialButton(page).evaluate(button=>{button.click();button.click();});await page.waitForFunction(()=>window.fixture.calls.length===2);await expect(page.getByRole('button',{name:'Kontrollera arkivstatus',exact:true})).toBeDisabled();await expect(page.getByRole('link')).toHaveCount(0);await open(page);await respond(page,1,success(stored));await open(page);await expect(page.getByText('Originalet är arkiverat.',{exact:true})).toBeVisible();assert.equal((await calls(page)).filter(call=>call.kind==='archive').length,1);}finally{await page.close();}
});

for(const [field,value] of [['companyId','20000000-0000-4000-8000-000000000001'],['signingId','20000000-0000-4000-8000-000000000003'],['actorId','20000000-0000-4000-8000-000000000002'],['role','finance']]){
 test(`read rejects mismatched ${field} without original or generated claims`,async()=>{
  const page=await setup({fixture:{defaultRead:success(stored,{[field]:value})}});try{await open(page);await expect(page.getByRole('alert')).toContainText('kunde inte verifieras');await expect(page.getByRole('link')).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);}finally{await page.close();}
 });
}

for(const archiveOverride of [{documentContentSha256:'d'.repeat(64)},{signingRevision:2},{draftVersion:3}]){
 test(`read rejects stored original from a different exact document ${Object.keys(archiveOverride)[0]}`,async()=>{
  const page=await setup({fixture:{defaultRead:success({...stored,...archiveOverride})}});try{await open(page);await expect(page.getByRole('alert')).toContainText('kunde inte verifieras');await expect(page.getByRole('link')).toHaveCount(0);}finally{await page.close();}
 });
}

test('mismatched write result clears consent and retry rather than claiming an original',async()=>{
 const page=await setup({fixture:{defaultWrite:success(stored,{actorId:'20000000-0000-4000-8000-000000000002'})}});
 try{await verifyNull(page);await checkbox(page).check();await initialButton(page).click();await expect(page.getByRole('alert')).toContainText('kunde inte verifieras');await expect(page.getByRole('link')).toHaveCount(0);await expect(checkbox(page)).toHaveCount(0);await expect(retryButton(page)).toHaveCount(0);}finally{await page.close();}
});

test('actor scope switch drops confirmation, nonce and late success from the previous actor',async()=>{
 const page=await setup();const nextActor='20000000-0000-4000-8000-000000000002';
 try{await verifyNull(page);await page.evaluate(()=>window.fixture.manual=true);await checkbox(page).check();await initialButton(page).click();await page.waitForFunction(()=>window.fixture.calls.length===2);await page.evaluate(({row,companyId,nextActor})=>window.mountArchive({signing:row,companyId,userId:nextActor,role:'owner'}),{row,companyId:COMPANY,nextActor});await expect(page.getByRole('link')).toHaveCount(0);await respond(page,1,success(stored));await open(page);await page.waitForFunction(()=>window.fixture.calls.length===3);await respond(page,2,success(null,{actorId:nextActor}));await expect(checkbox(page)).not.toBeChecked();await checkbox(page).check();await initialButton(page).click();await page.waitForFunction(()=>window.fixture.calls.length===4);const writes=(await calls(page)).filter(call=>call.kind==='archive');assert.notEqual(writes[0].input.requestId,writes[1].input.requestId);await respond(page,3,success(stored,{actorId:nextActor}));await expect(page.getByText('Originalet är arkiverat.',{exact:true})).toBeVisible();}finally{await page.close();}
});

test('role loss removes confirmation and ignores the old owner mutation while finance can read current status',async()=>{
 const page=await setup();
 try{await verifyNull(page);await page.evaluate(()=>window.fixture.manual=true);await checkbox(page).check();await initialButton(page).click();await page.waitForFunction(()=>window.fixture.calls.length===2);await page.evaluate(({row,companyId,userId})=>window.mountArchive({signing:row,companyId,userId,role:'finance'}),{row,companyId:COMPANY,userId:ACTOR});await respond(page,1,success(stored));await open(page);await page.waitForFunction(()=>window.fixture.calls.length===3);await respond(page,2,success(null,{role:'finance'}));await expect(page.getByRole('link')).toHaveCount(2);await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(retryButton(page)).toHaveCount(0);assert.equal((await calls(page)).filter(call=>call.kind==='archive').length,1);}finally{await page.close();}
});

for(const width of [320,1280]){
 test(`original archive remains readable without horizontal overflow at ${width}px`,async()=>{
  const page=await setup({width,integrated:true,props:{dealId:DEAL,draftId:DRAFT},fixture:{defaultRead:success(stored)}});try{await open(page);await expect(page.getByRole('link',{name:'Hämta arkiverat avtalsoriginal (PDF)',exact:true})).toBeVisible();const dimensions=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(dimensions.document<=width&&dimensions.body<=width,JSON.stringify(dimensions));}finally{await page.close();}
 });
}

const checkFiles=page=>page.getByRole('button',{name:'Kontrollera originalfilerna',exact:true});
const verified=page=>page.getByText('Originalfilernas integritet är kontrollerad.',{exact:true});
const checked=(archive=stored,override={})=>({...success(archive),checkedAt:'2026-10-18T10:12:00.000Z',...override});
test('file integrity is explicit read-only, binds actual metadata and clears its timestamp on every status read',async()=>{
 const page=await setup({fixture:{defaultRead:success(stored)}});try{
  assert.deepEqual(await calls(page),[]);await open(page);await expect(checkFiles(page)).toBeEnabled();await expect(verified(page)).toHaveCount(0);assert.deepEqual((await calls(page)).map(c=>c.kind),['read']);
  await checkFiles(page).focus();await page.keyboard.press('Enter');await expect(verified(page)).toBeVisible();await expect(page.locator('time')).toHaveText(/18 okt\. 2026.*12:12/);assert.deepEqual((await calls(page)).map(c=>c.kind),['read','verify']);assert.deepEqual((await calls(page))[1].input,{signingId:SIGNING,companyId:COMPANY});
  await page.getByRole('button',{name:'Kontrollera arkivstatus',exact:true}).click();await expect(checkFiles(page)).toBeEnabled();await expect(verified(page)).toHaveCount(0);await expect(page.locator('time')).toHaveCount(0);assert.deepEqual((await calls(page)).map(c=>c.kind),['read','verify','read']);
 }finally{await page.close();}
});
for(const role of ['admin','finance','customer'])test(`${role} explicitly checks original files within existing read scope`,async()=>{
 const customer=role==='customer',page=await setup({props:{companyId:customer?undefined:COMPANY,role:customer?undefined:role},fixture:{defaultRead:success(stored,{role}),defaultVerify:checked(stored,{role})}});try{await open(page);await checkFiles(page).click();await expect(verified(page)).toBeVisible();assert.deepEqual((await calls(page))[1].input,{signingId:SIGNING,...(customer?{}:{companyId:COMPANY})});assert.equal((await calls(page)).filter(c=>c.kind==='archive').length,0);}finally{await page.close();}
});
for(const [label,result]of [['missing',{ok:false,code:'unavailable',error:'Originalfilen saknas.'}],['corrupt',{ok:false,code:'source_invalid',error:'Originalfilens kontrollsumma stämmer inte.'}],['unavailable',{ok:false,code:'unavailable',error:'Arkivlagringen kunde inte nås.'}],['lost',{throw:true}],['missing archive',checked(null)]])test(`file verification ${label} never claims intact original or generates a replacement`,async()=>{
 const page=await setup({fixture:{defaultRead:success(stored),defaultVerify:result}});try{await open(page);await checkFiles(page).click();await expect(page.getByRole('alert')).toBeVisible();await expect(verified(page)).toHaveCount(0);await expect(page.getByText('Originalet är arkiverat.',{exact:true})).toHaveCount(0);await expect(page.getByRole('link')).toHaveCount(0);await expect(initialButton(page)).toHaveCount(0);assert.deepEqual((await calls(page)).map(c=>c.kind),['read','verify']);}finally{await page.close();}
});
for(const [field,value]of [['companyId','other-company'],['signingId','other-signing'],['actorId','other-actor'],['role','finance'],['checkedAt',null]])test(`file verification rejects mismatched ${field}`,async()=>{
 const page=await setup({fixture:{defaultRead:success(stored),defaultVerify:checked(stored,{[field]:value})}});try{await open(page);await checkFiles(page).click();await expect(page.getByRole('alert')).toContainText('kunde inte verifieras');await expect(verified(page)).toHaveCount(0);await expect(page.getByRole('link')).toHaveCount(0);}finally{await page.close();}
});
for(const patch of [{id:'other-archive'},{documentContentSha256:'d'.repeat(64)},{signingRevision:4},{archivedAt:'2026-10-16T10:00:00Z'},{rendererVersion:'different'},{pdf:{...stored.pdf,bytes:2049}},{pdf:{...stored.pdf,sha256:'d'.repeat(64)}},{evidence:{...stored.evidence,objectPath:'other-object'}},{evidence:{...stored.evidence,mimeType:'text/plain'}}])test(`file verification rejects changed registered metadata ${JSON.stringify(patch)}`,async()=>{
 const page=await setup({fixture:{defaultRead:success(stored),defaultVerify:checked({...stored,...patch})}});try{await open(page);await checkFiles(page).click();await expect(page.getByRole('alert')).toContainText('kunde inte verifieras');await expect(verified(page)).toHaveCount(0);await expect(page.getByRole('link')).toHaveCount(0);}finally{await page.close();}
});
test('pending file verification blocks duplicate checks, archive and status handlers synchronously',async()=>{
 const page=await setup({fixture:{defaultRead:success(stored)}});try{await open(page);await expect(checkFiles(page)).toBeEnabled();await page.evaluate(()=>window.fixture.manual=true);await checkFiles(page).evaluate(button=>{button.click();button.click();Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Kontrollera arkivstatus').click();});await page.waitForFunction(()=>window.fixture.calls.length===2);await expect(checkFiles(page)).toBeDisabled();await expect(page.getByRole('button',{name:'Kontrollera arkivstatus',exact:true})).toBeDisabled();assert.deepEqual((await calls(page)).map(c=>c.kind),['read','verify']);await respond(page,1,checked());await expect(verified(page)).toBeVisible();await expect(checkFiles(page)).toBeEnabled();}finally{await page.close();}
});
for(const change of ['actor','role','signing','company','draftVersion'])test(`late file verification cannot restore private data after ${change} changes`,async()=>{
 const page=await setup({fixture:{defaultRead:success(stored)}});try{await open(page);await expect(checkFiles(page)).toBeEnabled();await page.evaluate(()=>window.fixture.manual=true);await checkFiles(page).click();await page.waitForFunction(()=>window.fixture.calls.length===2);const props={signing:change==='signing'?{...row,id:'20000000-0000-4000-8000-000000000003'}:change==='draftVersion'?{...row,draftVersion:3}:row,companyId:change==='company'?'20000000-0000-4000-8000-000000000001':COMPANY,userId:change==='actor'?'20000000-0000-4000-8000-000000000002':ACTOR,role:change==='role'?'finance':'owner'};await page.evaluate(props=>window.mountArchive(props),props);await respond(page,1,checked());await expect(verified(page)).toHaveCount(0);await expect(page.getByRole('link')).toHaveCount(0);await expect(checkFiles(page)).toHaveCount(0);assert.deepEqual((await calls(page)).map(c=>c.kind),['read','verify']);}finally{await page.close();}
});
test('original-file check and timestamp wrap at320px with keyboard activation and no private storage paths',async()=>{
 const page=await setup({width:320,fixture:{defaultRead:success(stored)}});try{await open(page);await checkFiles(page).focus();await page.keyboard.press('Enter');await expect(verified(page)).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await checkFiles(page).evaluate(button=>button.scrollWidth<=button.clientWidth));assert.equal((await page.locator('body').innerText()).includes(stored.pdf.objectPath),false);await page.screenshot({path:'/tmp/trafexa-contract-integrity-320.png',fullPage:true});}finally{await page.close();}
});
