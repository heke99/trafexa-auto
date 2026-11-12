import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSourceLoader} from '../../../tests/helpers/source-loader.mjs';
import {asRole} from '../../../tests/crm-db/helpers.mjs';
import {fixture,id,U,C,D,S,EMAIL,strokes} from '../../../tests/guest-customer-db/helpers.mjs';

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
 const guestSign=revision=>a.guest.signGuestContractAction({signingId:signing.id,expectedRevision:revision,documentHash:signing.documentHash,fullName:'李文',acknowledged:true,consentVersion:'2026-10-14',requestId:id(108)});
 const dealerSign=revision=>a.signing.signContractAction({companyId:C,signingId:signing.id,expectedRevision:revision,documentHash:signing.documentHash,fullName:'Dealer Owner',strokes,acknowledged:true,consentVersion:'2026-10-14',requestId:id(109)});
 if(order==='dealer-first'){success(await dealerSign(1),'dealer first');success(await guestSign(2),'guest second');}else{success(await guestSign(1),'guest first');success(await dealerSign(2),'dealer second');}
 const completed=h.useMail('contract_completed',signing.id);const read=success(await a.guest.getGuestCustomerDocumentAction({documentId:signing.id}),'read completed guest document');assert.equal(read.document.signing.status,'completed');assert.equal(read.document.signing.customerSignature.authenticationMethod,'email_link');assert.equal(read.document.signing.companySignature.fullName,'Dealer Owner');

 assert.equal(read.document.signing.customerSignature.fullName,'李文');
 const persisted={status:read.document.signing.status,revision:read.document.signing.revision};
 assert.equal(persisted.status,'completed');
 assert.equal((await h.db.query('select (select count(*)::int from private.contract_signatures where signing_id=$1)+(select count(*)::int from private.guest_contract_signatures where signing_id=$1) n',[signing.id])).rows[0].n,2);
 const renderer=h.loader.load('@/lib/documents/signed-contract-pdf');
 await assert.rejects(renderer.generateSignedContractArtifacts(read.document.signing),/tecken.*inte stöder/);
 const archived=await a.archive.archiveContractAction({companyId:C,signingId:signing.id,requestId:id(112)});
 assert.equal(archived.ok,false);assert.equal(archived.code,'unavailable');
 const route=h.loader.load('src/app/customer-document/pdf/route.ts');
 const response=await route.GET(new Request('https://app.trafexa.com/customer-document/pdf?document='+signing.id));
 assert.equal(response.status,503);
 const fulfilment=success(await a.fulfil.getDealFulfilmentAction({companyId:C,dealId:D}),'read blocked fulfilment').page;
 assert.equal(fulfilment.blockedReason,'original_required');
 console.log(JSON.stringify({finding:'completed signature accepts name unrenderable by PDF',persistedStatus:persisted.status,persistedRevision:persisted.revision,archiveCode:archived.code,guestPdfStatus:response.status,fulfilmentBlockedReason:fulfilment.blockedReason,objectsWritten:h.state.objects.size}));
}
test('new defect reproduction: accepted CJK signing name permanently completes contract but blocks PDF, archive and fulfilment',async t=>journey(t,'guest-first'));
