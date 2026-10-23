import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSourceLoader} from './helpers/source-loader.mjs';
import {asRole} from './crm-db/helpers.mjs';
import {fixture,id,U,C,D,S,EMAIL,strokes} from './guest-customer-db/helpers.mjs';

const BUCKET='native-contract-originals';
const env={CONTRACT_EMAIL_ENABLED:'true',TRANSACTIONAL_EMAIL_DOMAIN_VERIFIED:'true',RESEND_API_KEY:'synthetic-dealer-journey-provider',SUPABASE_SECRET_KEY:'sb_secret_synthetic_dealer_journey_only',NEXT_PUBLIC_SUPABASE_URL:'https://buqdtssxrotkzndublrt.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_dealer_journey_only'};
const USER_TOKEN=`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({role:'authenticated',sub:U})).toString('base64url')}.synthetic_signature`;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const success=(result,label)=>{assert.equal(result.ok,true,label+': '+JSON.stringify(result));return result;};

/** Full real action/context/SQL/renderer/transport chain. Auth and Storage APIs are
 * local I/O adapters, not real services; Storage catalogs still enforce SQL RLS.
 * Every network request is intercepted. No buyer Auth account is seeded/created. */
async function setup(t){
 const previous=Object.fromEntries([...Object.keys(env),'TRANSACTIONAL_EMAIL_ENABLED'].map(key=>[key,process.env[key]]));Object.assign(process.env,env);delete process.env.TRANSACTIONAL_EMAIL_ENABLED;
 const h=await fixture(),state={cookie:null,selected:C,objects:new Map(),providers:[],downloads:[],rpcCalls:[],invalidations:[],guestAuthCalls:0};
 t.after(async()=>{await h.db.close();for(const[key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 async function call(role,name,args){
  assert.match(name,/^[a-z_][a-z0-9_]*$/);for(const key of Object.keys(args))assert.match(key,/^[a-z_][a-z0-9_]*$/);
  return asRole(h.db,role,role==='authenticated'?U:null,async tx=>(await tx.query(`select public.${name}(${Object.keys(args).map((key,i)=>'"'+key+'" => $'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result);
 }
 function request(role,name,args){const pending=Promise.resolve().then(async()=>{state.rpcCalls.push({role,name,args});try{return{data:await call(role,name,args),error:null};}catch(error){return{data:null,error};}});pending.abortSignal=signal=>{assert.ok(signal instanceof AbortSignal);return pending;};return pending;}
 function storage(role){return{from(bucket){assert.equal(bucket,BUCKET);return{async download(path,_options,control){assert.equal(control.cache,'no-store');assert.ok(control.signal instanceof AbortSignal);state.downloads.push({role,path});try{const exists=await asRole(h.db,role,role==='authenticated'?U:null,async tx=>(await tx.query('select name from storage.objects where bucket_id=$1 and name=$2',[bucket,path])).rows[0]);const object=state.objects.get(path);if(!exists||!object)return{data:null,error:{code:'42501'}};return{data:new Blob([new Uint8Array(object.bytes)],{type:object.mime}),error:null};}catch(error){return{data:null,error};}}};}};}
 const dealer={
  auth:{async getUser(token){if(token!==undefined)assert.equal(token,USER_TOKEN);return{data:{user:(await h.db.query('select id,email,email_confirmed_at,is_anonymous from auth.users where id=$1',[U])).rows[0]},error:null};},async getSession(){return{data:{session:{access_token:USER_TOKEN,user:{id:U}}},error:null};}},
  from(table){assert.equal(table,'memberships');const values={};
   async function execute(){try{return{data:await asRole(h.db,'authenticated',U,async tx=>(await tx.query("select jsonb_build_object('company_id',m.company_id,'user_id',m.user_id,'role',m.role,'status',m.status,'companies',jsonb_build_object('id',c.id,'name',c.name,'organisation_number',c.organisation_number,'status',c.status)) value from public.memberships m join public.companies c on c.id=m.company_id where ($1::uuid is null or m.company_id=$1) and m.user_id=$2 and m.status=$3 and c.status=$4 order by m.company_id",[values.company_id??null,values.user_id,values.status,values['companies.status']])).rows.map(row=>row.value)),error:null};}catch(error){return{data:null,error};}}
   const query={select(){return query;},eq(key,value){values[key]=value;return query;},order(){return query;},async maybeSingle(){const result=await execute();return{...result,data:result.data?.[0]??null};},then(resolve,reject){return execute().then(resolve,reject);}};return query;},
  rpc:(name,args)=>request('authenticated',name,args),storage:storage('authenticated'),
 };
 const worker={rpc:(name,args)=>request('service_role',name,args),storage:storage('service_role')};Object.defineProperty(worker,'auth',{get(){state.guestAuthCalls++;assert.fail('Guest journey must never use Auth');}});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const target=new URL(String(url));
  if(target.origin==='https://api.resend.com'){
   assert.equal(target.pathname,'/emails');assert.equal(options.method,'POST');const key=options.headers['Idempotency-Key'];assert.match(key,/^trafexa\/[a-f0-9-]{36}$/);
   const row=(await h.db.query('select id,kind,reference_id,recipient from private.transactional_email_outbox where id=$1',[key.slice('trafexa/'.length)])).rows[0];assert.ok(row);const body=JSON.parse(options.body);assert.deepEqual(body.to,[row.recipient]);state.providers.push({row,body,key});return Response.json({id:'synthetic-journey-accepted-'+state.providers.length});
  }
  assert.equal(target.origin,env.NEXT_PUBLIC_SUPABASE_URL,'Unexpected external request');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  if(target.pathname==='/rest/v1/rpc/register_contract_signing_archive'){
   assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(options.headers.Authorization,undefined);const args=JSON.parse(options.body);
   try{return Response.json(await call('service_role','register_contract_signing_archive',args));}catch(error){return Response.json({code:error.code},{status:400});}
  }
  const prefix='/storage/v1/object/'+BUCKET+'/';assert.ok(target.pathname.startsWith(prefix));const path=target.pathname.slice(prefix.length),bytes=new Uint8Array(options.body),mime=options.headers['Content-Type'];assert.equal(options.headers.apikey,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);assert.equal(options.headers.Authorization,'Bearer '+USER_TOKEN);assert.equal(options.headers['x-upsert'],'false');
  try{await asRole(h.db,'authenticated',U,tx=>tx.query('insert into storage.objects(bucket_id,name,metadata,owner_id)values($1,$2,$3,$4)',[BUCKET,path,{size:bytes.length,mimetype:mime},U]));state.objects.set(path,{bytes,mime});return Response.json({Key:BUCKET+'/'+path});}catch(error){return Response.json({code:error.code},{status:409});}
 });
 const loader=await createSourceLoader({
  'next/cache':{revalidatePath(path){state.invalidations.push(path);}},
  'next/navigation':{redirect(path){throw Object.assign(Error('Synthetic redirect'),{digest:'NEXT_REDIRECT;'+path,path});}},
  'next/headers':{async cookies(){return{get(name){if(name==='trafexa-company')return{value:state.selected};assert.equal(name,'trafexa-guest-document');return state.cookie?{value:state.cookie}:undefined;}};}},
  '@/lib/supabase/server':{async createServerSupabaseClient(){return dealer;}},

  '@supabase/supabase-js':{createClient(url,key){assert.equal(url,env.NEXT_PUBLIC_SUPABASE_URL);assert.equal(key,env.SUPABASE_SECRET_KEY);return worker;}},
 });
 const modules={offer:loader.load('@/lib/data/offer-actions'),review:loader.load('@/lib/data/offer-review-actions'),contract:loader.load('@/lib/data/contract-actions'),signing:loader.load('@/lib/data/contract-signing-actions'),guest:loader.load('@/lib/data/guest-customer-actions'),archive:loader.load('@/lib/data/contract-archive-actions'),fulfil:loader.load('@/lib/deal-fulfilment/actions'),legacy:loader.load('@/lib/data/actions'),renew:loader.load('@/lib/data/customer-document-renewal-actions')};
 function useMail(kind,reference){const mail=state.providers.findLast(item=>item.row.kind===kind&&item.row.reference_id===reference);assert.ok(mail,'Missing personal '+kind+' message');const target=new URL(mail.body.text.match(/https:\/\/[^\s]+/g).find(value=>value.includes('/customer-document/invitation')));const token=target.searchParams.get('token'),invitationId=target.searchParams.get('invitation');assert.match(token,/^[A-Za-z0-9_-]{43}$/);state.cookie=`v1.${invitationId}.${token}`;return{mail,invitationId,tokenHash:digest(Buffer.from(token))};}
 return{...h,state,loader,modules,call,useMail};
}

async function journey(t,order){
 const h=await setup(t),{modules:a}=h;
 const form=new FormData();for(const[key,value]of Object.entries({deal_id:D,submission_id:id(100),company_id:C,gross_confirmed:'true',terms:'Kontrollerat fullständigt underlag utan externa betalningspåståenden',valid_until:new Date(Date.now()+30*86400000).toISOString().slice(0,10)}))form.set(key,value);
 const offer=success(await a.offer.createOfferVersionAction(form),'create offer');const published=success(await a.review.publishOfferReviewAction({companyId:C,dealId:D,offerId:offer.offerId,requestId:id(101)}),'publish offer');const offerCap=h.useMail('offer_invitation',published.review.id);
 const offered=success(await a.guest.getGuestCustomerDocumentAction({documentId:published.review.id}),'read guest offer');assert.equal(offered.document.review.offerVersion,2);
 success(await a.guest.respondGuestOfferAction({reviewId:published.review.id,expectedVersion:1,decision:'accepted',responderName:'Guest Buyer',reason:null,acknowledged:true,ackVersion:'2026-10-14',requestId:id(102)}),'approve guest offer');
 const template=success(await a.contract.createContractTemplateVersionAction({companyId:C,templateId:id(103),expectedVersion:0,title:'Genomgående köpeavtal',body:'Säljare {{company.name}} Köpare {{customer.name}} Pris {{offer.price_ore}}',requestId:id(104)}),'create contract template').template;
 const approved=success(await a.contract.reviewContractTemplateAction({companyId:C,templateVersionId:template.id,expectedApprovalVersion:1,status:'approved',reason:'Granskad exakt mallversion',reviewAcknowledged:true,requestId:id(105)}),'approve template').template;
 const draft=success(await a.contract.createSaleContractDraftAction({companyId:C,dealId:D,offerId:offer.offerId,templateVersionId:template.id,expectedTemplateApprovalVersion:approved.approvalVersion,reviewAcknowledged:true,requestId:id(106)}),'create draft').draft;
 const signing=success(await a.signing.requestContractSigningAction({companyId:C,dealId:D,draftId:draft.id,reviewAcknowledged:true,requestId:id(107)}),'request signatures').signing;h.useMail('contract_invitation',signing.id);
 const guestSign=revision=>a.guest.signGuestContractAction({signingId:signing.id,expectedRevision:revision,documentHash:signing.documentHash,fullName:'Guest Buyer',acknowledged:true,consentVersion:'2026-10-14',requestId:id(108)});
 const dealerSign=revision=>a.signing.signContractAction({companyId:C,signingId:signing.id,expectedRevision:revision,documentHash:signing.documentHash,fullName:'Dealer Owner',strokes,acknowledged:true,consentVersion:'2026-10-14',requestId:id(109)});
 if(order==='dealer-first'){success(await dealerSign(1),'dealer first');success(await guestSign(2),'guest second');}else{success(await guestSign(1),'guest first');success(await dealerSign(2),'dealer second');}
 const completed=h.useMail('contract_completed',signing.id);const read=success(await a.guest.getGuestCustomerDocumentAction({documentId:signing.id}),'read completed guest document');assert.equal(read.document.signing.status,'completed');assert.equal(read.document.signing.customerSignature.authenticationMethod,'email_link');assert.equal(read.document.signing.companySignature.fullName,'Dealer Owner');
 const signatureCount=(await h.db.query('select (select count(*)from private.contract_signatures)+(select count(*)from private.guest_contract_signatures) n')).rows[0].n;
 assert.equal((await guestSign(2)).code,'access_denied','A completed read-link must not approve the customer party');
 await assert.rejects(h.call('service_role','sign_guest_contract',{p_invitation_id:completed.invitationId,p_token_hash:completed.tokenHash,p_expected_revision:2,p_document_hash:signing.documentHash,p_full_name:'Impersonated company',p_strokes:[],p_acknowledged:true,p_consent_version:'2026-10-14',p_request_id:id(110)}),e=>e.code==='42501');
 await assert.rejects(h.call('service_role','sign_contract',{p_signing_id:signing.id,p_company_id:C,p_expected_revision:2,p_document_hash:signing.documentHash,p_full_name:'Impersonated company',p_strokes:strokes,p_acknowledged:true,p_consent_version:'2026-10-14',p_request_id:id(111)}),e=>e.code==='42501');
 assert.equal((await h.db.query('select (select count(*)from private.contract_signatures)+(select count(*)from private.guest_contract_signatures) n')).rows[0].n,signatureCount);
 const archived=success(await a.archive.archiveContractAction({companyId:C,signingId:signing.id,requestId:id(112)}),'archive exact original').archive;assert.equal(h.state.objects.size,2);assert.equal(archived.documentContentSha256,signing.documentHash);
 const beforeDelivery=await originals();
 const beforeStock=await h.call('authenticated','inventory_dashboard_totals',{p_company_id:C});
 assert.equal(beforeStock.activeStockCount,'1');assert.equal(beforeStock.availableStockCount,'1');assert.equal(beforeStock.purchaseValueOre,'100');
 const reserve=new FormData();reserve.set('deal_id',D);await assert.rejects(a.legacy.reserveVehicleAction(reserve),error=>{assert.ok(error.digest?.startsWith('NEXT_REDIRECT;'));assert.ok(error.path.startsWith('/deals?success='),decodeURIComponent(error.path));return true;});
 const reservedStock=await h.call('authenticated','inventory_dashboard_totals',{p_company_id:C});
 assert.equal(reservedStock.activeStockCount,'1');assert.equal(reservedStock.availableStockCount,'0');assert.equal(reservedStock.purchaseValueOre,'100','Reservation retains inventory purchase value');
 let reconciliation=success(await a.fulfil.getDealFulfilmentAction({companyId:C,dealId:D}),'read reconciliation').page;assert.equal(reconciliation.blockedReason,null);assert.equal(reconciliation.source.archiveId,archived.id);
 const payment={companyId:C,dealId:D,requestId:id(113),expectedVersion:reconciliation.version,operation:'payment',amountOre:reconciliation.source.amountDueOre,bankReference:'MANUALLY-CHECKED-JOURNEY-001',bookedOn:reconciliation.businessDate,reason:'Manuellt avstämt underlag, ingen bankintegration'};
 reconciliation=success(await a.fulfil.mutateDealFulfilmentAction(payment),'record manual payment').page;assert.equal(reconciliation.registeredOre,'200');assert.equal(reconciliation.canDeliver,true);
 assert.deepEqual(success(await a.fulfil.mutateDealFulfilmentAction(payment),'replay same manual payment').page,reconciliation);
 const delivered=success(await a.fulfil.mutateDealFulfilmentAction({companyId:C,dealId:D,requestId:id(114),expectedVersion:reconciliation.version,operation:'deliver',reason:'Utlämning manuellt bekräftad av handlaren'}),'register delivery').page;assert.ok(delivered.delivery);
 const afterStock=await h.call('authenticated','inventory_dashboard_totals',{p_company_id:C});
 assert.equal(afterStock.activeStockCount,'0');assert.equal(afterStock.availableStockCount,'0');assert.equal(afterStock.purchaseValueOre,'0','Completed delivery removes sold stock from purchase totals');
 assert.equal(afterStock.activeDealCount,'0');assert.equal(afterStock.reservedDealCount,'0');
 assert.equal((await h.db.query('select status from public.deals where id=$1',[D])).rows[0].status,'completed');assert.equal((await h.db.query('select status from public.stock_items where id=$1',[S])).rows[0].status,'sold');assert.equal((await h.db.query('select count(*)::int n from private.deal_payment_entries')).rows[0].n,1);
 async function originals(){const output={};for(const format of ['pdf','evidence']){const route=h.loader.load(`src/app/customer-document/${format}/route.ts`),response=await route.GET(new Request(`https://app.trafexa.com/customer-document/${format}?document=${signing.id}`));assert.equal(response.status,200,`${format}: ${await(response.status===200?Promise.resolve(''):response.text())}`);assert.match(response.headers.get('Cache-Control'),/private, no-store/);assert.match(response.headers.get('Content-Disposition'),/-original/);const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual(bytes,h.state.objects.get(archived[format].objectPath).bytes);assert.equal(digest(bytes),archived[format].sha256);output[format]=bytes;}assert.equal(JSON.parse(new TextDecoder().decode(output.evidence)).signedPdfSha256,digest(output.pdf));return output;}
 const original=await originals();assert.deepEqual(original,beforeDelivery,'Delivery must preserve exact guest PDF/evidence bytes');const dealerRoute=h.loader.load('src/app/api/contract-signings/[id]/pdf/route.ts');const dealerPdf=await dealerRoute.GET(new Request(`https://app.trafexa.com/api/contract-signings/${signing.id}/pdf?companyId=${C}`),{params:Promise.resolve({id:signing.id})});assert.equal(dealerPdf.status,200);assert.deepEqual(new Uint8Array(await dealerPdf.arrayBuffer()),original.pdf);
 assert.equal(h.state.guestAuthCalls,0);assert.equal((await h.db.query('select count(*)::int n from auth.users')).rows[0].n,1);assert.equal((await h.db.query('select count(*)::int n from private.account_approvals')).rows[0].n,1);assert.equal((await h.db.query('select count(*)::int n from public.memberships')).rows[0].n,1);
 return{...h,signing,completed,archived,original,originals};
}

for(const order of ['guest-first','dealer-first'])test(`real ${order} dealer journey: frozen offer → account-free buyer → both signatures → RLS-protected original → manual payment → delivery; guest and dealer retain exact PDF/evidence`,async t=>{await journey(t,order);});

test('delivered completed contract renews only a read-link; old token remains expired and new guest receives identical original bytes without new signatures or payment',async t=>{
 const h=await journey(t,'guest-first');
 await h.db.exec('alter table private.guest_document_invitations disable trigger guest_invitation_immutable');await h.db.query("update private.guest_document_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",[h.completed.invitationId]);await h.db.exec('alter table private.guest_document_invitations enable trigger guest_invitation_immutable');
 assert.equal((await h.modules.guest.getGuestCustomerDocumentAction({documentId:h.signing.id})).code,'access_denied');
 const input={companyId:C,dealId:D,kind:'contract_completed',referenceId:h.signing.id};const review=success(await h.modules.renew.getCustomerDocumentRenewalAction(input),'review expired completed read-link').lifecycle;assert.equal(review.canRenew,true);
 const payload={...input,expectedEmailId:review.emailId,expectedInvitationId:review.invitationId,expectedGeneration:review.generation,expectedDocumentHash:review.documentHash,expectedDocumentVersion:review.documentVersion,expectedRecipientEmail:review.recipientEmail,expectedReviewToken:review.reviewToken,reason:'Förnya utgången läslänk till samma färdiga original',requestId:id(115),acknowledged:true,invalidatesPreviousLink:true};const renewed=success(await h.modules.renew.renewCustomerDocumentAction(payload),'renew delivered completed read-link');assert.equal(renewed.dispatchStatus,'accepted');const cap=h.useMail('contract_completed',h.signing.id);assert.notEqual(cap.invitationId,h.completed.invitationId);
 assert.deepEqual(await h.originals(),h.original);assert.equal((await h.modules.guest.signGuestContractAction({signingId:h.signing.id,expectedRevision:2,documentHash:h.signing.documentHash,fullName:'Guest Buyer',acknowledged:true,consentVersion:'2026-10-14',requestId:id(116)})).code,'access_denied');
 await assert.rejects(h.call('service_role','sign_guest_contract',{p_invitation_id:cap.invitationId,p_token_hash:cap.tokenHash,p_expected_revision:2,p_document_hash:h.signing.documentHash,p_full_name:'Impersonated company',p_strokes:[],p_acknowledged:true,p_consent_version:'2026-10-14',p_request_id:id(117)}),e=>e.code==='42501');
 await assert.rejects(h.call('service_role','get_guest_customer_document',{p_invitation_id:h.completed.invitationId,p_token_hash:h.completed.tokenHash}),e=>e.code==='42501');assert.equal((await h.db.query('select count(*)::int n from private.deal_payment_entries')).rows[0].n,1);assert.equal((await h.db.query('select count(*)::int n from private.deal_deliveries')).rows[0].n,1);assert.equal((await h.db.query('select count(*)::int n from private.guest_contract_signatures')).rows[0].n,1);assert.equal((await h.db.query('select count(*)::int n from auth.users')).rows[0].n,1);
});
