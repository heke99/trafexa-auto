'use client';

import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {getDirectDealOptionsAction,prepareDirectDealAction,approveAndSendDirectDealAction} from '@/lib/data/direct-deal-actions';
import {getContractSigningDeliveryAction} from '@/lib/data/contract-signing-actions';
import type {ContractSigning,ContractSigningDelivery} from '@/lib/contracts/signing-types';
import type {DirectDealCustomerContext,DirectDealOptions,DirectDealReview,PrepareDirectDealInput,ApproveDirectDealInput} from '@/lib/data/direct-deal-types';
import type {Customer,InventoryItem,WorkspaceSnapshot} from '@/lib/data/workspace';
import {formatOre} from '@/lib/calculations/vehicle-calculation';
import {useDescendantBusy} from './use-descendant-busy';
import {DealOptionPicker} from './deal-form';
import styles from './direct-deal-form.module.css';

export type DirectDealFormProps={snapshot:WorkspaceSnapshot;companyId:string;dealId?:string;demo?:boolean;onBusyChange?:(busy:boolean)=>void;onPrepared?:(dealId:string)=>void;onCompleted?:(signingId:string)=>void;onAccessDenied?:(message:string)=>void};
type Fields={tradeInId:string;stockItemId:string;customerMode:'existing'|'new';customerId:string;kind:'person'|'business';name:string;email:string;phone:string;address:string;identityNumber:string;agreedPrice:string;templateVersionId:string};
type Sent={ok:true;signing:ContractSigning;delivery:Pick<ContractSigningDelivery,'status'|'transport'>|null};
const BASE_TEMPLATE='__trafexa_base__';
const blankFields=():Fields=>({tradeInId:'',stockItemId:'',customerMode:'new',customerId:'',kind:'person',name:'',email:'',phone:'',address:'',identityNumber:'',agreedPrice:'',templateVersionId:''});
function kronor(value:string|number){try{if(typeof value==='number'&&!Number.isSafeInteger(value))return '';const n=BigInt(value);return `${n/100n},${(n%100n).toString().padStart(2,'0')}`;}catch{return '';}}
function customerFields(customer:DirectDealCustomerContext){return {customerMode:'existing' as const,customerId:customer.id,name:customer.name,kind:customer.kind,email:customer.email,phone:customer.phone,address:customer.address,identityNumber:''};}
function validReview(review:DirectDealReview,companyId:string,dealId?:string){return review.companyId===companyId&&review.draft.companyId===companyId&&review.draft.dealId===review.dealId&&(!dealId||review.dealId===dealId)&&review.draft.sourceOffer.company.id===companyId&&review.draft.sourceOffer.deal_id===review.dealId&&/^[a-f0-9]{64}$/.test(review.reviewHash);}

export function DirectDealForm(props:DirectDealFormProps){
 const role=props.snapshot.membership?.role??'viewer';
 if(props.companyId!==props.snapshot.organization?.id||!['owner','admin','sales'].includes(role))return <p role="alert">För att skapa en affär behöver du vara ägare, administratör eller säljare i det valda företaget.</p>;
 return <ScopedDirectDealForm key={`${props.companyId}:${props.snapshot.user.id}:${role}:${props.dealId??'new'}:${!!props.demo}`} {...props}/>;
}

function ScopedDirectDealForm({snapshot,companyId,dealId,demo=false,onBusyChange,onPrepared,onCompleted,onAccessDenied}:DirectDealFormProps){
 const canApprove=['owner','admin'].includes(snapshot.membership?.role??'');
 const field=useId(),busy=useDescendantBusy(onBusyChange),alive=useRef(false),reads=useRef(0),errorFocus=useRef<HTMLParagraphElement>(null),reviewFocus=useRef<HTMLHeadingElement>(null),completionFocus=useRef<HTMLHeadingElement>(null);
 const [fields,setFields]=useState<Fields>(blankFields),[options,setOptions]=useState<DirectDealOptions|null>(null),[customer,setCustomer]=useState<DirectDealCustomerContext|null>(null),[activeDealId,setActiveDealId]=useState(dealId??null),[review,setReview]=useState<DirectDealReview|null>(null),[sent,setSent]=useState<Sent|null>(null);
 const [loading,setLoading]=useState(!demo),[error,setError]=useState(''),[denied,setDenied]=useState(false),[unknown,setUnknown]=useState<'prepare'|'send'|null>(null),[sellerName,setSellerName]=useState(''),[ack,setAck]=useState(false),[needsRefresh,setNeedsRefresh]=useState(false);
 const prepareAttempt=useRef<PrepareDirectDealInput|null>(null),sendAttempt=useRef<ApproveDirectDealInput|null>(null);
 const [pickedStock,setPickedStock]=useState<InventoryItem|null>(null),[pickedCustomer,setPickedCustomer]=useState<Customer|null>(null),[stockReady,setStockReady]=useState(false),[customerReady,setCustomerReady]=useState(false);
 const pickerLocked=useRef(false),pickedCustomerId=useRef<string|null>(null),readSelectedCustomer=useRef<(id:string)=>void>(()=>{});
 pickerLocked.current=busy.busy||unknown!==null||denied;
 function purge(message:string){reads.current++;setFields(blankFields());setOptions(null);setCustomer(null);setReview(null);setSent(null);setSellerName('');setAck(false);setUnknown(null);prepareAttempt.current=null;sendAttempt.current=null;setDenied(true);setLoading(false);setError(message);onAccessDenied?.(message);}
 function fail(code:string,message:string){if(['access_denied','unauthenticated','company_changed'].includes(code))purge(message);else {setError(message);if(code==='conflict'){setNeedsRefresh(true);setAck(false);}}}
 async function load(selectedCustomerId?:string,initial=false){
  if(demo||busy.busyRef.current)return;const seq=++reads.current;setLoading(true);setError('');
  try{
   const result=await getDirectDealOptionsAction({companyId,...(activeDealId?{dealId:activeDealId}:{}),...(selectedCustomerId?{customerId:selectedCustomerId}:{})});
   if(!alive.current||seq!==reads.current)return;
   if(!result.ok){fail(result.code,result.message);return;}
   if(result.templates.some(row=>row.companyId!==companyId||row.status!=='approved')||result.deal&&activeDealId&&result.deal.id!==activeDealId||result.customer&&selectedCustomerId&&result.customer.id!==selectedCustomerId){purge('Affärens underlag kunde inte verifieras. Läs in sidan igen.');return;}
   setOptions(result);setNeedsRefresh(false);setSellerName(current=>current||result.actorName||'');
   setFields(current=>({...current,templateVersionId:current.templateVersionId===BASE_TEMPLATE||result.templates.some(row=>row.id===current.templateVersionId)?current.templateVersionId:result.templates[0]?.id??BASE_TEMPLATE}));
   if(selectedCustomerId){const selected=result.customer;setCustomer(selected);if(selected)setFields(current=>({...current,...customerFields(selected)}));}
   else if(initial&&result.deal){setActiveDealId(result.deal.id);setCustomer(result.deal.customer);setFields(current=>({...current,...customerFields(result.deal!.customer),stockItemId:result.deal!.stockItemId,agreedPrice:kronor(result.deal!.agreedPriceOre)}));}
   if(initial&&result.pendingReview&&!needsRefresh){if(!validReview(result.pendingReview,companyId,activeDealId??undefined)){purge('Det sparade avtalsunderlaget kunde inte verifieras.');return;}setReview(result.pendingReview);setActiveDealId(result.pendingReview.dealId);}
   if(initial&&result.signing){
    const signing=result.signing;if(signing.companyId!==companyId||signing.dealId!==result.deal?.id){purge('Avtalets företagskoppling kunde inte verifieras.');return;}
    let delivery:Sent['delivery']=null;
    if(canApprove&&signing.status!=='completed'){
     try{
      const status=await getContractSigningDeliveryAction({companyId,dealId:signing.dealId,signingId:signing.id});
      if(!alive.current||seq!==reads.current)return;
      if(!status.ok){if(['access_denied','unauthenticated'].includes(status.code)){purge(status.message);return;}}
      else if(status.delivery.companyId!==companyId||status.delivery.dealId!==signing.dealId||status.delivery.signingId!==signing.id){purge('Avtalets utskicksstatus kunde inte verifieras.');return;}
      else delivery={status:status.delivery.status,transport:status.delivery.transport};
     }catch{/* Keep unknown delivery neutral; the verified signing remains readable. */}
    }
    if(!alive.current||seq!==reads.current)return;
    setSent({ok:true,signing,delivery});setReview(null);
   }
  }catch{if(alive.current&&seq===reads.current)setError('Affärens underlag kunde inte hämtas. Försök läsa in det igen.');}
  finally{if(alive.current&&seq===reads.current)setLoading(false);}
 }
 readSelectedCustomer.current=value=>void load(value);
 const selectStock=useCallback((row:Customer|InventoryItem|null)=>{if(pickerLocked.current)return;const next=row&&'vehicles'in row?row:null;setPickedStock(next);setFields(current=>current.stockItemId===(next?.id??'')?current:({...current,stockItemId:next?.id??'',agreedPrice:next?kronor(next.asking_price_ore):''}));prepareAttempt.current=null;},[]);
 const selectCustomer=useCallback((row:Customer|InventoryItem|null)=>{if(pickerLocked.current)return;const next=row&&'name'in row?row:null;setPickedCustomer(next);if(pickedCustomerId.current===(next?.id??null))return;pickedCustomerId.current=next?.id??null;setCustomer(null);setFields(current=>({...current,customerId:next?.id??'',name:'',email:'',phone:'',address:'',identityNumber:''}));prepareAttempt.current=null;if(next)readSelectedCustomer.current(next.id);},[]);
 useEffect(()=>{alive.current=true;if(!demo)void load(undefined,true);return()=>{alive.current=false;reads.current++;};},[]);
 useEffect(()=>{if(error)errorFocus.current?.focus();},[error]);
 useEffect(()=>{if(review)reviewFocus.current?.focus();},[review]);
 useEffect(()=>{if(sent)completionFocus.current?.focus();},[sent?.signing.id,sent?.signing.status]);
 const refreshSigning=useRef<()=>Promise<void>>(async()=>{}),refreshingSigning=useRef(false);
 refreshSigning.current=async()=>{
  if(!alive.current||demo||denied||unknown||loading||busy.busyRef.current||refreshingSigning.current||!sent||sent.signing.status==='completed'||sent.signing.status==='unavailable'||document.visibilityState==='hidden')return;
  refreshingSigning.current=true;
  try{await load(undefined,true);}finally{refreshingSigning.current=false;}
 };
 useEffect(()=>{
  if(!sent||sent.signing.status==='completed'||sent.signing.status==='unavailable'||denied||demo)return;
  const refresh=()=>{void refreshSigning.current();},timer=window.setInterval(refresh,15000);
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[sent?.signing.id,sent?.signing.status,denied,demo]);
 function edit<K extends keyof Fields>(key:K,value:Fields[K]){if(busy.busyRef.current||unknown)return;setFields(current=>({...current,[key]:value}));setError('');prepareAttempt.current=null;sendAttempt.current=null;}
 function mode(value:Fields['customerMode']){if(busy.busyRef.current||unknown||activeDealId)return;reads.current++;setLoading(false);setCustomer(null);setPickedCustomer(null);setCustomerReady(false);pickedCustomerId.current=null;setFields(current=>({...current,customerMode:value,customerId:'',kind:'person',name:'',email:'',phone:'',address:'',identityNumber:''}));setError('');prepareAttempt.current=null;}
 async function prepare(retry=false){
  if(demo||denied||busy.busyRef.current||loading||!activeDealId&&(!stockReady||fields.customerMode==='existing'&&!customerReady))return;
  let input=retry?prepareAttempt.current:null;
  if(!input){const template=options?.templates.find(row=>row.id===fields.templateVersionId);if(!template&&fields.templateVersionId!==BASE_TEMPLATE){setError('Välj en godkänd avtalsmall innan du fortsätter.');return;}if(fields.customerMode==='existing'&&!customer){setError('Välj och läs in en kund innan du fortsätter.');return;}const trade=(options?.tradeIns??[]).find(row=>row.id===fields.tradeInId);if(fields.tradeInId&&(!trade||!trade.debtKnown||trade.debtOre===null)){setError('Välj ett aktuellt inbytesunderlag med bekräftad skuld.');return;}input={tradeInId:trade?.id??null,expectedTradeInVersion:trade?.version??null,companyId,requestId:crypto.randomUUID(),dealId:activeDealId,stockItemId:fields.stockItemId,customerId:fields.customerMode==='existing'?fields.customerId:null,customer:{name:fields.name.trim(),kind:fields.kind,email:fields.email.trim().toLowerCase(),phone:fields.phone.trim(),address:fields.address.trim(),identityNumber:fields.identityNumber.trim()},expectedCustomerVersion:fields.customerMode==='existing'?customer?.version??null:null,agreedPrice:fields.agreedPrice.trim(),templateVersionId:template?.id??null,expectedTemplateApprovalVersion:template?.approvalVersion??0};prepareAttempt.current=input;}
  busy.report(true);setError('');
  try{
   const result=await prepareDirectDealAction(input);if(!alive.current)return;
   if(!result.ok){if(result.code==='unavailable')setUnknown('prepare');else {setUnknown(null);prepareAttempt.current=null;}fail(result.code,result.message);return;}
   if(!validReview(result.review,companyId,activeDealId??undefined)||result.review.requestId!==input.requestId||result.review.draft.sourceOffer.stock.id!==input.stockItemId||(input.tradeInId?result.review.draft.sourceOffer.trade_in?.id!==input.tradeInId||result.review.draft.sourceOffer.trade_in?.version!==input.expectedTradeInVersion:!!result.review.draft.sourceOffer.trade_in)){purge('Det sparade avtalsunderlaget kunde inte verifieras. Läs in affären igen.');return;}
   setUnknown(null);setReview(result.review);setActiveDealId(result.review.dealId);setAck(false);sendAttempt.current=null;onPrepared?.(result.review.dealId);
  }catch{if(alive.current){setUnknown('prepare');setError('Resultatet kunde inte bekräftas. Uppgifterna finns kvar; kontrollera samma försök innan du gör ändringar.');}}
  finally{busy.report(false);}
 }
 async function send(retry=false){
  if(!review||!canApprove||demo||denied||busy.busyRef.current||!ack&&!retry)return;
  let input=retry?sendAttempt.current:null;
  if(!input){input={companyId,dealId:review.dealId,draftId:review.draft.id,reviewHash:review.reviewHash,sellerName:sellerName.trim(),acknowledged:true,requestId:crypto.randomUUID()};sendAttempt.current=input;}
  busy.report(true);setError('');
  try{
   const result=await approveAndSendDirectDealAction(input);if(!alive.current)return;
   if(!result.ok){if(result.code==='unavailable')setUnknown('send');else {setUnknown(null);sendAttempt.current=null;}fail(result.code,result.message);return;}
   if(result.signing.companyId!==companyId||result.signing.dealId!==input.dealId||result.signing.draftId!==input.draftId||!result.signing.companySignature||result.signing.companySignature.fullName!==input.sellerName){purge('Avtalets godkännande kunde inte verifieras. Läs in affären igen.');return;}
   setSent(result);setReview(null);setFields(blankFields());setCustomer(null);setUnknown(null);setAck(false);prepareAttempt.current=null;
   if(result.delivery.status==='accepted'||result.signing.status==='completed')onCompleted?.(result.signing.id);
  }catch{if(alive.current){setUnknown('send');setError('Utskickets resultat kunde inte bekräftas. Kontrollera samma begäran; skapa inte ett nytt avtal.');}}
  finally{busy.report(false);}
 }
 function back(){
  if(!review||busy.busyRef.current||unknown)return;
  const source=review.draft.sourceOffer;
  // Keep the exact reviewed customer/version. A fresh register read would overwrite
  // staged contact edits and erase the identity before the seller can amend them.
  // prepare still verifies customerVersion on the server before another review.
  setCustomer({id:source.customer.id,version:review.customerVersion,identityPresent:customer?.id===source.customer.id&&customer.kind===source.customer.kind?customer.identityPresent:options?.deal?.customer.id===source.customer.id&&options.deal.customer.kind===source.customer.kind?options.deal.customer.identityPresent:false,name:source.customer.name,kind:source.customer.kind,email:source.customer.email??'',phone:source.customer.phone??'',address:source.customer.address??''});
  setFields(current=>({...current,tradeInId:source.trade_in?.id??'',stockItemId:source.stock.id,customerMode:'existing',customerId:source.customer.id,name:source.customer.name,kind:source.customer.kind,email:source.customer.email??'',phone:source.customer.phone??'',address:source.customer.address??'',identityNumber:review.draft.customerIdentity?.number??current.identityNumber,agreedPrice:kronor(source.sale_price_ore),templateVersionId:options?.templates.some(row=>row.id===review.draft.template.id)?review.draft.template.id:BASE_TEMPLATE}));
  setReview(null);setAck(false);setError('');prepareAttempt.current=null;
 }
 const disabled=demo||busy.busy||loading||denied||unknown!==null||needsRefresh;
 const identityRequired=fields.customerMode==='new'||customer?.identityPresent===false||!!customer&&customer.kind!==fields.kind;
 const vehicle=pickedStock??snapshot.inventory.find(row=>row.id===fields.stockItemId);
 const pickerScope={companyId,actorId:snapshot.user.id,role:snapshot.membership?.role??'viewer',demo};
 return <div className={styles.form} aria-busy={busy.busy||loading}>
  {error?<p className={`notice error ${styles.alert}`} role="alert" ref={errorFocus} tabIndex={-1}>{error}</p>:null}
  {needsRefresh&&!denied?<button type="button" className="button button-outline" disabled={busy.busy||loading} onClick={()=>{setReview(null);setAck(false);void load(undefined,true);}}>Läs in aktuellt underlag</button>:null}
  {unknown?<button type="button" className="button button-outline" disabled={busy.busy} onClick={()=>void (unknown==='prepare'?prepare(true):send(true))}>Kontrollera samma försök</button>:null}
  {denied?null:sent?<section className={styles.status}>
   <h3 ref={completionFocus} tabIndex={-1}>{sent.signing.status==='completed'?'Avtalet är färdigsignerat':sent.signing.status==='unavailable'?'Avtalet kan inte signeras':sent.delivery?.status==='accepted'?'Avtalet är skickat':'Avtalet väntar på kundens underskrift'}</h3>
   <p>{sent.signing.customerEmail}</p>
   {sent.signing.status==='completed'?<><p>Båda parter har skrivit under.</p>{canApprove?<div className={styles.actions}><a className="button button-green" href={`/api/contract-signings/${sent.signing.id}/pdf?${new URLSearchParams({companyId})}`} download>Hämta signerat avtal</a><a className="button button-outline" href={`/api/contract-signings/${sent.signing.id}/evidence?${new URLSearchParams({companyId})}`} download>Hämta signeringsbevis</a></div>:null}</>:sent.signing.status==='unavailable'?<p>Kontrollera affärens status innan du skapar ett nytt avtal.</p>:!sent.delivery?<p>Uppdatera status för att följa kundens underskrift.</p>:sent.delivery.status==='accepted'?<p>Du kan följa kundens underskrift i affären.</p>:sent.delivery.transport!=='configured'?<p>Utskicket behöver kontrolleras i affären. Ingen ny inbjudan ska skapas.</p>:<p>Signeringslänkens utskick väntar eller behöver kontrolleras i affären.</p>}
   <button type="button" className="button button-outline" disabled={busy.busy||loading} onClick={()=>void load(undefined,true)}>{loading?'Uppdaterar…':'Uppdatera status'}</button>
  </section>:options?.agreementExists&&!canApprove?<section className={styles.status}><h3>Avtal finns för affären</h3><p>Företagets ägare eller administratör kan följa och hantera underskrifterna.</p><button type="button" className="button button-outline" disabled={busy.busy||loading} onClick={()=>void load(undefined,true)}>{loading?'Uppdaterar…':'Uppdatera status'}</button></section>:review&&!canApprove?<section className={styles.status}><h3 ref={reviewFocus} tabIndex={-1}>Affären är sparad</h3><p>Företagets ägare eller administratör kan godkänna och skicka avtalet.</p><p>{review.draft.sourceOffer.customer.name}<br/>{review.draft.sourceOffer.vehicle.registration_number} · {formatOre(review.draft.sourceOffer.sale_price_ore)}</p></section>:review?<section className={styles.review} aria-labelledby={`${field}-review`}>
   <h3 id={`${field}-review`} ref={reviewFocus} tabIndex={-1}>Granska och skicka avtalet</h3>
   <dl className={styles.summary}><div><dt>Kund</dt><dd>{review.draft.sourceOffer.customer.name}<br/>{review.draft.sourceOffer.customer.email}<br/>{review.draft.sourceOffer.customer.phone}</dd></div><div><dt>Bil</dt><dd>{review.draft.sourceOffer.vehicle.registration_number} · {review.draft.sourceOffer.vehicle.make} {review.draft.sourceOffer.vehicle.model}</dd></div><div><dt>Överenskommet pris</dt><dd><strong>{formatOre(review.draft.sourceOffer.sale_price_ore)}</strong></dd></div><div><dt>Avtalsmall</dt><dd>{review.draft.template.title}</dd></div></dl>
   {(options?.tradeIns??[]).length>0&&!review.draft.sourceOffer.trade_in?<p className="notice">Det finns ett inbytesunderlag. Detta avtal är utan inbyte. Välj Tillbaka och ändra för att lägga till det.</p>:null}
   {review.draft.sourceOffer.trade_in?<section aria-label="Inbyte i avtalet"><h4>Inbyte i avtalet</h4><p>{review.draft.sourceOffer.trade_in.registration} · {review.draft.sourceOffer.trade_in.make} {review.draft.sourceOffer.trade_in.model} · Version {review.draft.sourceOffer.trade_in.version}<br/>Inbytesvärde: {formatOre(review.draft.sourceOffer.trade_in.value_ore)}<br/>Bekräftad skuld: {formatOre(review.draft.sourceOffer.trade_in.debt_ore!)}<br/>Nettoinbyte: {formatOre(review.draft.sourceOffer.trade_in.net_trade_in_ore!)}<br/>{BigInt(review.draft.sourceOffer.trade_in.amount_to_pay_ore!)<0n?'Att betala till kunden':'Att betala av kunden'}: <strong>{formatOre((BigInt(review.draft.sourceOffer.trade_in.amount_to_pay_ore!)<0n?-BigInt(review.draft.sourceOffer.trade_in.amount_to_pay_ore!):BigInt(review.draft.sourceOffer.trade_in.amount_to_pay_ore!)).toString())}</strong></p></section>:null}
   <details><summary>Visa avtalsvillkoren</summary><div className={styles.terms}>{review.renderedTerms}</div></details>
   <a className="text-link" href={`/api/contracts/${review.draft.id}/pdf`} target="_blank" rel="noopener noreferrer">Förhandsgranska avtalet som PDF</a>
   <label>Ditt fullständiga namn<input value={sellerName} onChange={event=>{if(!unknown&&!busy.busyRef.current){setSellerName(event.target.value);setAck(false);sendAttempt.current=null;}}} disabled={disabled} required minLength={2} maxLength={160} autoComplete="name"/></label>
   <label className={styles.ack}><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)} disabled={disabled}/><span>Jag har granskat kunduppgifter, pris och avtalsvillkor, är behörig att företräda {snapshot.organization?.name} och godkänner avtalet med mitt namn. Jag begär kundens underskrift via en personlig länk.</span></label>
   <div className={styles.actions}><button type="button" className="button button-green" disabled={disabled||!ack||sellerName.trim().length<2} onClick={()=>void send()}>Godkänn och skicka avtal</button><button type="button" className="button button-outline" disabled={disabled} onClick={back}>Tillbaka och ändra</button></div>
  </section>:<form className={`workspace-form ${styles.form}`} aria-label={dealId?'Fortsätt affär':'Skapa affär'} onSubmit={event=>{event.preventDefault();void prepare();}}>
   {demo?<p className={styles.note}>Demonstration i läsläge. Ingen affär eller inbjudan skapas.</p>:loading?<p role="status">Läser affärens underlag…</p>:null}
   <section className={styles.section}><h3>Bil och pris</h3>{activeDealId?<p className={styles.note}>Bil i affären: <strong>{vehicle?`${vehicle.vehicles.registration_number} · ${vehicle.vehicles.make} ${vehicle.vehicles.model}`:'Affärens sparade bil'}</strong></p>:<fieldset disabled={disabled} style={{border:0,padding:0,margin:0,minWidth:0}}><DealOptionPicker compact {...pickerScope} kind="inventory" demoRows={snapshot.inventory} selected={pickedStock} onSelect={selectStock} onReadyChange={setStockReady}/></fieldset>}<label>Överenskommet pris, kr<input inputMode="decimal" value={fields.agreedPrice} onChange={event=>edit('agreedPrice',event.target.value)} disabled={disabled} required maxLength={30} placeholder="Exempel 159 000"/></label>{vehicle?<p className={styles.note}>Totalpris inklusive eventuell moms.</p>:null}</section>
   <section className={styles.section}><h3>Kund</h3>{!activeDealId?<div className={styles.choice}><button type="button" className={`button ${fields.customerMode==='new'?'button-green':'button-outline'}`} aria-pressed={fields.customerMode==='new'} onClick={()=>mode('new')} disabled={disabled}>Ny kund</button><button type="button" className={`button ${fields.customerMode==='existing'?'button-green':'button-outline'}`} aria-pressed={fields.customerMode==='existing'} onClick={()=>mode('existing')} disabled={disabled}>Befintlig kund</button></div>:null}
    {fields.customerMode==='existing'?(activeDealId?<p className={styles.note}>Kund i affären: <strong>{fields.name}</strong></p>:<fieldset disabled={disabled} style={{border:0,padding:0,margin:0,minWidth:0}}><DealOptionPicker compact {...pickerScope} kind="customers" demoRows={snapshot.customers} selected={pickedCustomer} onSelect={selectCustomer} onReadyChange={setCustomerReady}/></fieldset>):null}
    {fields.customerMode==='new'||fields.customerId?<><label>Kundtyp<select value={fields.kind} onChange={event=>{edit('kind',event.target.value as Fields['kind']);edit('identityNumber','');}} disabled={disabled}><option value="person">Privatperson</option><option value="business">Företag</option></select></label><label>{fields.kind==='business'?'Företagsnamn':'Fullständigt namn'}<input value={fields.name} onChange={event=>edit('name',event.target.value)} required minLength={2} maxLength={160} disabled={disabled} autoComplete={fields.kind==='business'?'organization':'name'}/></label><label>{fields.kind==='business'?'Organisationsnummer':'Personnummer'}{!identityRequired?<span className={styles.required}> · Redan registrerat, lämna tomt för att behålla</span>:null}<input className={styles.identity} value={fields.identityNumber} onChange={event=>edit('identityNumber',event.target.value)} required={identityRequired} maxLength={20} inputMode="numeric" autoComplete="off" disabled={disabled} placeholder={identityRequired?(fields.kind==='business'?'556000-0000':'ÅÅÅÅMMDD-NNNN'):'Ändra endast vid behov'}/></label><div className={styles.row}><label>Mejladress<input type="email" value={fields.email} onChange={event=>edit('email',event.target.value)} required maxLength={254} disabled={disabled} autoComplete="email"/></label><label>Telefonnummer<input type="tel" value={fields.phone} onChange={event=>edit('phone',event.target.value)} required maxLength={60} disabled={disabled} autoComplete="tel"/></label></div><label>Adress <span className={styles.required}>· Valfritt</span><input value={fields.address} onChange={event=>edit('address',event.target.value)} maxLength={500} disabled={disabled} autoComplete="street-address"/></label></>:null}
   </section>
   {activeDealId&&(options?.tradeIns??[]).length===0?<p className={styles.note}>Lägg till underlag under Inbytesunderlag före avtalet skickas om affären ska ha ett inbyte.</p>:null}
   {activeDealId&&(options?.tradeIns??[]).length>0?<section className={styles.section}><h3>Inbyte</h3><label>Inbyte i avtalet<select value={fields.tradeInId} onChange={event=>edit('tradeInId',event.target.value)} disabled={disabled}><option value="">Utan inbyte</option>{(options?.tradeIns??[]).map((row,index)=><option key={row.id} value={row.id} disabled={index!==0||!row.debtKnown}>{row.registration} · Version {row.version} · {formatOre(row.valueOre)}{!row.debtKnown?' · Skuld behöver bekräftas':index!==0?' · Ersatt av nyare underlag':''}</option>)}</select></label><p className={styles.note}>Välj uttryckligen det inbyte som ska ingå. Beloppet att betala räknas från det överenskomna bilpriset och det valda inbytets värde och skuld. Kunden granskar och signerar även inbytet.</p></section>:null}
   <label>Avtalsmall<select required value={fields.templateVersionId} onChange={event=>edit('templateVersionId',event.target.value)} disabled={disabled}><option value={BASE_TEMPLATE}>Trafexa-grundavtal</option>{options?.templates.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
   {!loading&&!demo&&fields.templateVersionId===BASE_TEMPLATE?<p className={styles.note}>Trafexa-grundavtalet granskas och godkänns av dig när du skickar. Du behöver inte skapa en mall först.</p>:null}
   <p className={styles.note}>Du granskar avtalet innan du godkänner och skickar det. Kunden behöver inget Trafexakonto.</p>
   <button type="submit" className="button button-green" disabled={disabled||!options||!activeDealId&&(!stockReady||fields.customerMode==='existing'&&!customerReady)}>{busy.busy?'Förbereder avtalet…':activeDealId?'Granska avtalet':'Skapa affär'}</button>
   {!loading&&!demo&&!options&&error?<button type="button" className="button button-outline" disabled={busy.busy} onClick={()=>void load(undefined,true)}>Läs in underlaget igen</button>:null}
  </form>}
 </div>;
}
