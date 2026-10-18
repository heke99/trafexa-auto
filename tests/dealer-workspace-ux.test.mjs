import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir} from 'node:fs/promises';
import {startHarness,expect} from './helpers/register-ui/runtime.mjs';
import {snapshot} from './helpers/register-ui/fixtures.mjs';
let harness;const output=process.env.TRAFEXA_DEALER_UX_QA_DIR;
before(async()=>{harness=await startHarness();if(output)await mkdir(output,{recursive:true});});
after(async()=>{await harness?.close();});
async function setup({width=1440,section='dashboard',role='owner',demo=true,strict=false}={}){const p=await harness.page(width);await p.evaluate(strict=>window.fixture.strictMode=strict,strict);await p.evaluate(props=>window.mountWorkspace(props),{snapshot:snapshot({size:4,role}),section,demo});return p;}
async function opened(p){await p.getByRole('button',{name:'Öppna menyn',exact:true}).click();await expect(p.getByRole('dialog',{name:'Navigationsmeny'})).toBeVisible();await expect(p.locator('#dealer-navigation')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');}
test('mobile drawer traps keyboard focus, hides background and restores focus after Escape',async()=>{const p=await setup({width:390});try{await opened(p);const menu=p.getByRole('dialog',{name:'Navigationsmeny'});await expect(menu.getByRole('link',{name:'Översikt',exact:true})).toBeFocused();assert.equal(await p.locator('.workspace-body').evaluate(n=>n.inert),true);assert.equal(await p.evaluate(()=>document.body.style.overflow),'hidden');const links=menu.locator('a[href],button');await links.last().focus();await p.keyboard.press('Tab');await expect(links.first()).toBeFocused();await p.keyboard.press('Shift+Tab');await expect(links.last()).toBeFocused();await p.keyboard.press('Escape');await expect(p.getByRole('button',{name:'Öppna menyn',exact:true})).toBeFocused();assert.equal(await p.locator('.workspace-body').evaluate(n=>n.inert),false);assert.equal(await p.evaluate(()=>document.body.style.overflow),'');assert.equal(harness.audit.posts.length,0);}finally{await p.close();}});
test('mobile close control and backdrop each restore usable page without background tab targets',async()=>{const p=await setup({width:390});try{await opened(p);await p.getByRole('button',{name:'Stäng navigationsmenyn'}).click();await expect(p.getByRole('button',{name:'Öppna menyn',exact:true})).toBeFocused();await opened(p);await p.locator('.sidebar-overlay').click({position:{x:370,y:100}});await expect(p.getByRole('button',{name:'Öppna menyn',exact:true})).toBeFocused();}finally{await p.close();}});
test('mobile settings navigation highlights actual active destination and resize resets drawer state',async()=>{const p=await setup({width:390,section:'settings'});try{await opened(p);await expect(p.getByRole('dialog',{name:'Navigationsmeny'}).getByRole('link',{name:'Företag & inställningar',exact:true})).toHaveAttribute('aria-current','page');await expect(p.getByRole('dialog',{name:'Navigationsmeny'}).getByRole('link',{name:'Företag & inställningar',exact:true})).toBeFocused();await p.setViewportSize({width:1440,height:900});await expect(p.getByRole('dialog',{name:'Navigationsmeny'})).toHaveCount(0);assert.equal(await p.locator('.workspace-body').evaluate(n=>n.inert),false);await expect(p.getByRole('navigation',{name:'Arbetsytans meny'})).toBeVisible();}finally{await p.close();}});
test('settings provide company overview before feature modules, clear section links and truthful native signing status',async()=>{const p=await setup({section:'settings',demo:false});try{const nav=p.getByRole('navigation',{name:'Inställningsområden'});await expect(nav.getByRole('link',{name:'Företag & konto',exact:true})).toHaveAttribute('href','#settings-account');await expect(nav.getByRole('link',{name:'Personal & ägarroll'})).toHaveAttribute('href','#settings-team');await expect(p.getByText('Dokumentsignering',{exact:true})).toBeVisible();await expect(p.getByText('Inbyggd',{exact:true})).toBeVisible();assert.equal(await p.evaluate(()=>!!(document.getElementById('settings-account').compareDocumentPosition(document.getElementById('settings-store'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);await expect(p.getByRole('button',{name:'Logga ut'})).toBeVisible();await expect(p.getByRole('link',{name:'Återställ lösenord'})).toBeVisible();assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);}finally{await p.close();}});
test('settings section shortcuts respect role and demo limits',async()=>{for(const [role,demo]of[['viewer',false],['sales',false],['finance',false],['owner',true]]){const p=await setup({section:'settings',role,demo});try{const nav=p.getByRole('navigation',{name:'Inställningsområden'});if(['viewer','sales','finance'].includes(role))await expect(nav.getByRole('link',{name:'Butik & offentlig synlighet'})).toHaveCount(0);if(['viewer','sales'].includes(role))await expect(nav.getByRole('link',{name:'Avtalsmallar'})).toHaveCount(0);if(role==='finance')await expect(nav.getByRole('link',{name:'Avtalsmallar'})).toBeVisible();if(demo){await expect(nav.getByRole('link',{name:'Personal & ägarroll'})).toHaveCount(0);await expect(p.getByRole('button',{name:'Logga ut'})).toHaveCount(0);}}finally{await p.close();}}});
test('dealer desktop and mobile views stay within viewport and produce inspectable screenshot evidence',async()=>{for(const width of [1440,390])for(const section of ['dashboard','settings']){const p=await setup({width,section});try{assert.ok(await p.evaluate(width=>document.documentElement.scrollWidth<=width,width));await expect(p.getByRole('heading',{level:1})).toBeVisible();if(output)await p.screenshot({path:`${output}/after-${section}-${width}.png`,fullPage:true});if(width===390&&section==='dashboard'){await opened(p);if(output)await p.screenshot({path:`${output}/after-mobile-menu.png`,fullPage:true});}}finally{await p.close();}}assert.equal(harness.audit.posts.length,0);assert.deepEqual(harness.audit.errors,[]);});
test('long legal company names and account emails wrap without horizontal page overflow',async()=>{for(const width of [320,390,1440]){const p=await harness.page(width);try{const data=snapshot({size:0});data.organization.name='MycketLångtFöretagsnamn'.repeat(8);data.user.email='mycketlangtpersonnamn'.repeat(5)+'@example.invalid';await p.evaluate(props=>window.mountWorkspace(props),{snapshot:data,section:'settings',demo:true});assert.ok(await p.evaluate(width=>document.documentElement.scrollWidth<=width,width));await expect(p.locator('.company-switch>span').first()).toHaveAttribute('title',data.organization.name);await p.evaluate(props=>window.mountWorkspace(props),{snapshot:data,section:'dashboard',demo:true});assert.ok(await p.evaluate(width=>document.documentElement.scrollWidth<=width,width));}finally{await p.close();}}});
test('vehicle, customer and finance forms carry their origin company and cannot survive a company switch',async()=>{
 const nextCompany='10000000-0000-4000-8000-000000000099';
 for(const [section,label]of[['inventory','Lägg till bil'],['customers','Lägg till kund'],['finance','Anmäl finansbehov']]){
 const p=await setup({section,demo:false});try{
 const original=snapshot({size:4});await p.getByRole('button',{name:label,exact:true}).click();const form=p.getByRole('dialog').locator('form');await expect(form.locator('input[name="expected_company_id"]')).toHaveValue(original.organization.id);const captured=await form.evaluate(node=>Object.fromEntries(new FormData(node)));assert.equal(captured.expected_company_id,original.organization.id);
 await p.evaluate(props=>window.mountWorkspace(props),{snapshot:snapshot({size:4,companyId:nextCompany}),section,demo:false});await expect(p.getByRole('dialog')).toHaveCount(0);await p.getByRole('button',{name:label,exact:true}).click();await expect(p.getByRole('dialog').locator('input[name="expected_company_id"]')).toHaveValue(nextCompany);assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
 }finally{await p.close();}
 }
});

test('vehicle dialogs restore their exact opener after close, Escape and backdrop including StrictMode at mobile and desktop widths',async()=>{
 for(const width of [390,1440])for(const strict of [false,true]){
  const p=await setup({width,strict});try{
   const opener=p.getByRole('button',{name:'Visa Volvo V60 0001',exact:true});
   for(const method of ['close','escape','backdrop']){
    await opener.focus();await opener.click();await expect(p.getByRole('dialog')).toBeVisible();
    if(method==='close')await p.getByRole('button',{name:'Stäng',exact:true}).click();
    else if(method==='escape')await p.keyboard.press('Escape');
    else await p.mouse.click(2,2);
    await expect(p.getByRole('dialog')).toHaveCount(0);await expect(opener).toBeFocused();
    assert.equal(await p.evaluate(()=>document.querySelectorAll('dialog:modal').length),0);
   }
   assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
  }finally{await p.close();}
 }
});

test('closing a stock-intake form after entering data restores the create button without submitting',async()=>{
 const p=await setup({section:'inventory',demo:false});try{
  const opener=p.getByRole('button',{name:'Lägg till bil',exact:true});await opener.click();await p.getByLabel('Registreringsnummer',{exact:true}).fill('QAFOCUS');
  await p.getByRole('button',{name:'Stäng',exact:true}).click();await expect(opener).toBeFocused();
  assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
 }finally{await p.close();}
});

test('a selected dashboard vehicle closes when a same-company refresh no longer contains that stock item',async()=>{
 const p=await setup();try{
  const original=snapshot({size:4});await p.getByRole('button',{name:'Visa Volvo V60 0001',exact:true}).click();await expect(p.getByRole('dialog').locator('.registration-plate')).toHaveText('QA00001');
  const refreshed={...original,inventory:original.inventory.slice(1)};await p.evaluate(props=>window.mountWorkspace(props),{snapshot:refreshed,section:'dashboard',demo:true});
  await expect(p.getByRole('dialog')).toHaveCount(0);await expect(p.getByRole('button',{name:'Visa Volvo V60 0001',exact:true})).toHaveCount(0);assert.equal(await p.locator('input[name="stock_item_id"]').count(),0);
  assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
 }finally{await p.close();}
});

test('fresh register removal and failed refresh both purge an open vehicle detail without mutations',async()=>{
 const p=await harness.page(1440);try{
  const data=snapshot({size:4});const page={kind:'inventory',companyId:data.organization.id,actorId:data.user.id,role:data.membership.role,rows:data.inventory,totalCount:4,filteredCount:4,counts:{all:4,available:4},nextCursor:null};
  await p.evaluate(page=>window.fixture.defaults.register={ok:true,page},page);await p.evaluate(props=>window.mountWorkspace(props),{snapshot:data,section:'inventory',demo:false});
  await p.getByRole('button',{name:'Visa Volvo V60 0001',exact:true}).click();await expect(p.getByRole('dialog')).toBeVisible();
  const next={...page,rows:page.rows.slice(1),totalCount:3,filteredCount:3,counts:{all:3,available:3}};await p.evaluate(page=>window.fixture.defaults.register={ok:true,page},next);await p.evaluate(props=>window.mountWorkspace(props),{snapshot:{...data,inventory:data.inventory.slice(1)},section:'inventory',demo:false});
  await expect(p.getByRole('dialog')).toHaveCount(0);await p.getByRole('button',{name:'Visa Volvo V60 0002',exact:true}).click();await expect(p.getByRole('dialog')).toBeVisible();
  await p.evaluate(()=>window.fixture.defaults.register={ok:false,error:'Registret kunde inte verifieras i detta försök.'});await p.evaluate(props=>window.mountWorkspace(props),{snapshot:{...data,inventory:data.inventory.slice(1)},section:'inventory',demo:false});
  await expect(p.getByRole('dialog')).toHaveCount(0);await expect(p.getByRole('alert')).toContainText('Registret kunde inte verifieras');await expect(p.getByRole('button',{name:'Försök igen',exact:true})).toBeVisible();assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);
 }finally{await p.close();}
});
test('company name is a keyboard-accessible route to company selection on mobile and desktop',async()=>{for(const width of [320,390,1440])for(const demo of [false,true]){const p=await setup({width,demo});try{const link=p.getByRole('link',{name:'Företagsinställningar för Fiktiv QA Bilhandel. Byt företag.',exact:true});await expect(link).toBeVisible();await expect(link).toHaveAttribute('href',demo?'/demo?section=settings#settings-account':'/settings#settings-account');await link.focus();await expect(link).toBeFocused();assert.ok(await p.evaluate(width=>document.documentElement.scrollWidth<=width,width));}finally{await p.close();}}});
test('first empty dealer registers give role-appropriate creation guidance without pointless search advice',async()=>{for(const [kind,role,copy]of[['inventory','owner','Använd ”Lägg till bil”'],['customers','sales','Använd ”Lägg till kund”'],['deals','owner','Registrera en kund och en tillgänglig bil.'],['inventory','sales','Registret fylls när en behörig medarbetare']]){const p=await harness.page(320);try{const data=snapshot({size:0,role});await p.evaluate(({data,kind,role})=>{window.fixture.defaults.register={ok:true,page:{companyId:data.organization.id,actorId:data.user.id,role,kind,rows:[],totalCount:0,filteredCount:0,counts:{all:0},nextCursor:null}};window.mountWorkspace({snapshot:data,section:kind,demo:false});},{data,kind,role});await expect(p.locator('.empty-state')).toContainText(copy);await expect(p.locator('.empty-state')).not.toContainText('Ändra sökningen');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=320));}finally{await p.close();}}});
test('no-match dealer search clears both query and status through an explicit show-all action',async()=>{const p=await setup({width:320,section:'inventory',demo:true});try{await p.getByRole('combobox',{name:'Lagerstatus'}).selectOption('reserved');await p.getByRole('searchbox').fill('inget matchar');await p.getByRole('button',{name:'Sök',exact:true}).click();await expect(p.locator('.empty-state')).toContainText('Inga bilar matchar');await p.getByRole('button',{name:'Visa alla bilar',exact:true}).click();await expect(p.getByRole('searchbox')).toHaveValue('');await expect(p.getByRole('combobox',{name:'Lagerstatus'})).toHaveValue('all');await expect(p.locator('.empty-state')).toHaveCount(0);await expect(p.getByText('Visar 4 av 4 träffar · 4 bilar totalt',{exact:true})).toBeVisible();assert.equal(await p.evaluate(()=>window.fixture.writes.length),0);}finally{await p.close();}});
