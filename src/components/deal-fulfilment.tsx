'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { getDealFulfilmentAction, mutateDealFulfilmentAction } from '@/lib/deal-fulfilment/actions';
import type { FulfilmentMutation, FulfilmentPage } from '@/lib/deal-fulfilment/types';
import { formatOre } from '../lib/calculations/vehicle-calculation';

type Props={companyId:string;userId:string;role:string;dealId:string;demo?:boolean;onDelivered?:()=>void;onBusyChange?:(busy:boolean)=>void;onAccessDenied?:(message:string)=>void};
type Category='customer_incoming'|'customer_payout'|'lender_payment';
const labels:Record<Category,string>={customer_incoming:'Inbetalning från kund',customer_payout:'Utbetalning till kund',lender_payment:'Betalning till kreditgivare'};
const categories:Category[]=['customer_incoming','customer_payout','lender_payment'];
const reasons={accepted_offer_required:'Skapa och signera affärens avtal för att gå vidare.',contract_required:'Båda parter behöver signera avtalet.',original_required:'Det signerade originalet behöver arkiveras.',trade_in_settlement_unsupported:'Inbytesunderlaget är ofullständigt. Kontrollera det signerade inbytesvärdet och den kända skulden innan affären stäms av.',deal_unavailable:'Affären kan inte avslutas i sitt aktuella läge.'};
const money=(value:string)=>formatOre(value);
const emptyPayment=()=>({amount:'',reference:'',date:'',reason:''});
function required(page:FulfilmentPage,category:Category){const trade=page.source?.tradeIn;return trade?category==='customer_incoming'?trade.customerIncomingOre:category==='customer_payout'?trade.customerPayoutOre:trade.lenderPaymentOre:page.source?.amountDueOre??'0';}
function registered(page:FulfilmentPage,category:Category){return page.settlement?category==='customer_incoming'?page.settlement.customerIncomingOre:category==='customer_payout'?page.settlement.customerPayoutOre:page.settlement.lenderPaymentOre:category==='customer_incoming'?page.registeredOre:'0';}
export function DealFulfilment(props:Props){if(!['owner','admin','finance'].includes(props.role))return null;return <FulfilmentPanel key={`${props.companyId}:${props.userId}:${props.role}:${props.dealId}:${!!props.demo}`} {...props}/>;}
function FulfilmentPanel({companyId,dealId,userId,role,demo,onDelivered,onBusyChange,onAccessDenied}:Props){
 const prefix=useId(),alive=useRef(false),lock=useRef(false),unknownRef=useRef(false),retries=useRef(new Map<string,string>()),reviewHeading=useRef<HTMLHeadingElement>(null),errorFocus=useRef<HTMLParagraphElement>(null);
 const [open,setOpen]=useState(false),[page,setPage]=useState<FulfilmentPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState<Omit<FulfilmentMutation,'requestId'>|null>(null),[blocked,setBlocked]=useState(false),[unknown,setUnknown]=useState(false),[ack,setAck]=useState(false);
 const [payment,setPayment]=useState(emptyPayment),[category,setCategory]=useState<Category>('customer_incoming'),[reversalReasons,setReversalReasons]=useState<Record<string,string>>({}),[deliveryReason,setDeliveryReason]=useState('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onBusyChange?.(lock.current||unknownRef.current);return()=>onBusyChange?.(false);},[onBusyChange]);
 useEffect(()=>{if(review)reviewHeading.current?.focus();},[review]);
 useEffect(()=>{if(error)errorFocus.current?.focus();},[error]);
 function reportBusy(value:boolean){setBusy(value);onBusyChange?.(value||unknownRef.current);}
 function markUnknown(value:boolean){unknownRef.current=value;setUnknown(value);if(!lock.current)onBusyChange?.(value);}
 function purge(message:string,denied=false){setPage(null);setReview(null);setBlocked(true);setPayment(emptyPayment());setReversalReasons({});setDeliveryReason('');markUnknown(false);setAck(false);retries.current.clear();setError(message);if(denied)onAccessDenied?.(message);}
 function verified(value:FulfilmentPage){return value.companyId===companyId&&value.dealId===dealId&&value.actorId===userId&&value.role===role&&(!value.source?.tradeIn||!!value.settlement&&/^[a-f0-9]{64}$/.test(value.source.documentHash??''));}
 function accept(value:FulfilmentPage){if(!verified(value)){purge('Företaget eller behörigheten har ändrats. Läs in affären igen.',true);return false;}setPage(value);setBlocked(false);setPayment(current=>({...current,date:current.date||value.businessDate}));if(value.source?.tradeIn)setCategory(current=>BigInt(required(value,current))>BigInt(registered(value,current))?current:categories.find(item=>BigInt(required(value,item))>BigInt(registered(value,item)))??'customer_incoming');return true;}
 async function load(){
  if(lock.current||demo||unknown)return;lock.current=true;reportBusy(true);setError('');setReview(null);setAck(false);
  try{const result=await getDealFulfilmentAction({companyId,dealId});if(!alive.current)return;if(result.ok)accept(result.page);else purge(result.message,['access_denied','unauthenticated'].includes(result.code));}
  catch{if(alive.current){setPage(null);setError('Avstämningen kunde inte hämtas. Dina osparade uppgifter finns kvar. Försök igen.');}}
  finally{lock.current=false;if(alive.current)reportBusy(false);}
 }
 function binding(){return page?.source?.tradeIn?{expectedDocumentHash:page.source.documentHash,acknowledged:true as const}:{};}
 function prepare(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!page||busy||blocked||unknown||role==='finance'||!event.currentTarget.reportValidity())return;
  const raw=payment.amount.trim().replace(/\s/g,'').replace(',','.');
  if(!/^[0-9]{1,11}(\.[0-9]{1,2})?$/.test(raw)){setError('Ange ett belopp med högst två decimaler.');return;}
  const [whole,fraction='']=raw.split('.'),amountOre=(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))).toString();
  if(BigInt(amountOre)<=0n||BigInt(amountOre)>1999999999998n){setError('Beloppet är ogiltigt.');return;}
  const selected=page.source?.tradeIn?category:'customer_incoming';
  if(BigInt(amountOre)>BigInt(required(page,selected))-BigInt(registered(page,selected))){setError('Beloppet överstiger det som återstår att stämma av för denna betalning.');return;}
  setError('');setAck(false);setReview({companyId,dealId,expectedVersion:page.version,operation:'payment',amountOre,bankReference:payment.reference.trim(),bookedOn:payment.date,reason:payment.reason.trim(),...(page.source?.tradeIn?{category,...binding()}: {})});
 }
 async function confirm(){
  if(!review||lock.current||blocked||demo||role==='finance'||page?.source?.tradeIn&&!ack)return;
  const fingerprint=JSON.stringify(review);let requestId=retries.current.get(fingerprint);if(!requestId){requestId=crypto.randomUUID();retries.current.set(fingerprint,requestId);}
  lock.current=true;reportBusy(true);setError('');
  try{const result=await mutateDealFulfilmentAction({...review,requestId});if(!alive.current)return;
   if(!result.ok){setError(result.message);if(['conflict','access_denied','unauthenticated'].includes(result.code))purge(result.message,['access_denied','unauthenticated'].includes(result.code));else if(result.code==='unavailable')markUnknown(true);return;}
   if(!accept(result.page))return;markUnknown(false);setReview(null);setAck(false);retries.current.clear();if(review.operation==='payment')setPayment({...emptyPayment(),date:result.page.businessDate});if(review.operation==='reverse')setReversalReasons(current=>({...current,[review.reversalOf!]:''}));if(result.page.delivery)onDelivered?.();
  }catch{if(alive.current){markUnknown(true);setError('Resultatet kunde inte bekräftas. Försök igen med samma granskade begäran.');}}
  finally{lock.current=false;if(alive.current)reportBusy(false);}
 }
 const trade=page?.source?.tradeIn,disabled=busy||blocked||unknown,reversalTarget=review?.operation==='reverse'?page?.entries.find(entry=>entry.id===review.reversalOf&&!entry.reversalOf):null;
 const available=page?categories.filter(item=>BigInt(required(page,item))>BigInt(registered(page,item))):[];
 return <section aria-label="Betalning och leverans"><button type="button" className="button button-outline button-small" aria-expanded={open} disabled={busy||unknown} onClick={()=>{if(lock.current||unknown)return;setOpen(!open);if(!open&&!page)void load();}}>Betalning och leverans</button>
  {open?<div className="stack" style={{display:'grid',gap:16,minWidth:0,fontSize:13,lineHeight:1.6}}><p className="muted small">Manuell avstämning mot handlarens eget bankunderlag. Uppgifterna är inte bankverifierade och inga pengar överförs.</p>
   {demo?<p>Avstämning sparas inte i demon.</p>:null}{error?<p ref={errorFocus} tabIndex={-1} role="alert">{error}</p>:null}{busy?<p role="status">Arbetar…</p>:null}
   {!demo?<button type="button" className="button button-outline button-small" disabled={busy||unknown} onClick={()=>void load()}>Läs in aktuell avstämning</button>:null}
   {page?<><p>{trade?'Manuellt registrerat per betalning visas nedan.':<>Manuellt registrerat: <strong>{money(page.registeredOre)}</strong>{page.source?<> av {money(page.source.amountDueOre)}</>:null}</>}</p>
    {trade?<section aria-label="Signerad inbytesavräkning"><h3>Inbyte enligt det signerade avtalet</h3><p>Underlagsversion {trade.tradeInVersion}. Beloppen är frysta i avtalet.</p><dl className="detail-list"><div><dt>Bilens försäljningspris</dt><dd>{money(trade.salePriceOre)}</dd></div><div><dt>Inbytesvärde</dt><dd>{money(trade.valueOre)}</dd></div><div><dt>Skuld till kreditgivare</dt><dd>{money(trade.debtOre)}</dd></div><div><dt>{BigInt(trade.netCashOre)<0n?'Att betala till kunden':'Att få från kunden'}</dt><dd>{money((BigInt(trade.netCashOre)<0n?-BigInt(trade.netCashOre):BigInt(trade.netCashOre)).toString())}</dd></div></dl><p>{trade.acquired?'Inbytesbilen är registrerad i lagret.':'Registrera inbytesköpet och ta in inbytesbilen i lagret innan leveransen avslutas.'}</p><p>Varje betalning stäms av separat. Inbytesvärdet är ingen bankbetalning.</p><ul>{categories.map(item=><li key={item} style={{marginBlock:8}}>{labels[item]}: {money(registered(page,item))} av {money(required(page,item))}</li>)}</ul></section>:null}
    {page.blockedReason?<p>{reasons[page.blockedReason]}</p>:null}
    {page.delivery?<><p role="status">Leverans registrerad {new Date(page.delivery.deliveredAt).toLocaleDateString('sv-SE')}. Bilen är såld och affären avslutad. {page.delivery.note}</p><p className="inline-note">Kontrollera och avpublicera bilens annonser hos externa annonskanaler. Registrerad leverans tar inte automatiskt bort annonser hos Blocket eller Wayke.</p></>:null}
    {page.entries.length?<ul aria-label="Manuella betalningsposter">{page.entries.map(entry=><li key={entry.id} style={{overflowWrap:'anywhere',marginBlock:12}}>{entry.reversalOf?'Återföring av ':''}{labels[entry.category??'customer_incoming']}: {money(entry.amountOre)} · {entry.bankReference} · {entry.bookedOn} · {entry.actorLabel}. {entry.reason}
     {!page.delivery&&role!=='finance'&&!review&&!entry.reversalOf&&!page.entries.some(item=>item.reversalOf===entry.id)?<form className="workspace-form" onSubmit={event=>{event.preventDefault();if(!disabled&&event.currentTarget.reportValidity()){setAck(false);setReview({companyId,dealId,expectedVersion:page.version,operation:'reverse',reversalOf:entry.id,reason:(reversalReasons[entry.id]??'').trim(),...binding()});}}}><label>Varför ska posten återföras?<input required minLength={2} maxLength={300} value={reversalReasons[entry.id]??''} disabled={disabled} onChange={event=>setReversalReasons(current=>({...current,[entry.id]:event.target.value}))}/></label><button type="submit" className="button button-outline button-small" disabled={disabled}>Granska återföring</button></form>:null}</li>)}</ul>:<p>Inga manuella betalningsposter.</p>}
    {role==='finance'?<p className="muted">Din roll kan läsa avstämningen. Ägare eller administratör registrerar ändringar och leverans.</p>:!page.delivery&&page.source&&!review?<>{(!trade||available.length>0)?<form className="workspace-form" onSubmit={prepare}>
     {trade?<label>Betalning som ska stämmas av<select aria-label="Betalning som ska stämmas av" value={category} disabled={disabled} onChange={event=>{setCategory(event.target.value as Category);setPayment(current=>({...current,amount:''}));}}>{available.map(item=><option key={item} value={item}>{labels[item]}</option>)}</select></label>:null}
     <label htmlFor={`${prefix}-amount`}>{trade?'Avstämt belopp, kr':'Inbetalt belopp, kr'}</label><input id={`${prefix}-amount`} inputMode="decimal" value={payment.amount} onChange={event=>setPayment(current=>({...current,amount:event.target.value}))} required disabled={disabled}/>
     {trade?<p>Återstår: {money((BigInt(required(page,category))-BigInt(registered(page,category))).toString())}</p>:null}
     <label htmlFor={`${prefix}-reference`}>Unik referens från bankunderlaget</label><input id={`${prefix}-reference`} minLength={2} maxLength={300} value={payment.reference} onChange={event=>setPayment(current=>({...current,reference:event.target.value}))} required disabled={disabled}/>
     <label htmlFor={`${prefix}-date`}>Bokföringsdatum</label><input id={`${prefix}-date`} type="date" min="2000-01-01" max={page.businessDate} value={payment.date} onChange={event=>setPayment(current=>({...current,date:event.target.value}))} required disabled={disabled}/>
     <label htmlFor={`${prefix}-reason`}>{trade?'Underlagsreferens eller notering':'Anteckning om avstämningen'}</label><input id={`${prefix}-reason`} minLength={2} maxLength={300} value={payment.reason} onChange={event=>setPayment(current=>({...current,reason:event.target.value}))} required disabled={disabled}/>
     <button type="submit" className="button button-green" disabled={disabled}>{trade?'Granska betalning':'Granska inbetalning'}</button>
    </form>:null}
    {page.canDeliver?<form className="workspace-form" onSubmit={event=>{event.preventDefault();if(!disabled&&event.currentTarget.reportValidity()){setAck(false);setReview({companyId,dealId,expectedVersion:page.version,operation:'deliver',reason:deliveryReason.trim(),...binding()});}}}><label>Leveransanteckning<input minLength={2} maxLength={300} required value={deliveryReason} onChange={event=>setDeliveryReason(event.target.value)} disabled={disabled}/></label><button type="submit" className="button button-green" disabled={disabled}>Granska leverans</button></form>:<p>Leverans kräver full manuellt avstämd betalning, ett signerat och arkiverat avtal samt en aktiv reservation för affären.{trade?' Vid inbyte krävs också separat avstämning av kund och kreditgivare samt registrerat inbytesköp och lagerintag.':''}</p>}</>:null}
   </>:null}
   {review?<div role="region" aria-label="Granska avstämning" style={{display:'grid',gap:12,border:'1px solid #d5dfca',borderRadius:6,padding:16,minWidth:0,overflowWrap:'anywhere'}}><h3 ref={reviewHeading} tabIndex={-1}>Granska {review.operation==='payment'?(trade?labels[review.category??'customer_incoming'].toLowerCase():'inbetalning'):review.operation==='reverse'?'återföring':'leverans'}</h3><p>{reversalTarget?<>Återför {labels[reversalTarget.category??'customer_incoming'].toLowerCase()}: {money(reversalTarget.amountOre)} · {reversalTarget.bankReference} · {reversalTarget.bookedOn}</>:<>{review.amountOre?money(review.amountOre):''} {review.bankReference} {review.bookedOn}</>}</p><p>{review.reason}</p>{review.operation==='deliver'?<p>Bekräftelsen markerar bilen som såld, avslutar affären och frigör dess reservation. Den kan inte ångras här. Kontrollera och avpublicera även bilens externa annonser; de tas inte bort automatiskt.</p>:<p>Detta är din manuella registrering utifrån bankunderlaget. Inga pengar överförs.</p>}
    {trade?<label style={{display:'flex',alignItems:'flex-start',gap:10}}><input type="checkbox" style={{width:18,height:18,flexShrink:0,marginTop:4}} checked={ack} disabled={busy||unknown} onChange={event=>setAck(event.target.checked)}/><span>Jag har kontrollerat det signerade inbytesunderlaget, betalningsmottagare, belopp och eget bankunderlag och bekräftar denna manuella registrering.</span></label>:null}
    <button type="button" disabled={busy||unknown} className="button button-outline" onClick={()=>{setReview(null);setAck(false);}}>Tillbaka</button><button type="button" disabled={busy||blocked||!!trade&&!ack||review.operation==='reverse'&&!reversalTarget} className="button button-green" onClick={()=>void confirm()}>Bekräfta {review.operation==='deliver'?'leverans':'registrering'}</button>
   </div>:null}
  </div>:null}
 </section>;
}
