'use client';

import {useEffect,useRef,useState,useTransition,type FormEvent} from 'react';
import {getCustomerDocumentRenewalAction,renewCustomerDocumentAction} from '@/lib/data/customer-document-renewal-actions';
import type {CustomerDocumentRenewalInput,CustomerDocumentRenewalLifecycle,CustomerDocumentRenewalRequest} from '@/lib/data/customer-document-renewal-types';

type Props=CustomerDocumentRenewalInput&{userId:string;role:string;disabled?:boolean;onBusyChange?:(blocked:boolean)=>void;onDenied?:(message:string)=>void;onRenewed?:()=>void};
type Review={input:CustomerDocumentRenewalRequest;source:CustomerDocumentRenewalLifecycle;invalidatesAck:boolean;emailAck:boolean};
type Failure={code?:string;message:string;mutationStarted?:boolean;transport?:'paused'|'unconfigured'|'configured'};
const buttonStyle={maxWidth:'100%',whiteSpace:'normal'} as const;
const firstAck='Jag har granskat mottagaren och dokumentversionen och förstår att den tidigare dokumentlänken blir ogiltig.';
const secondAck='Jag vill skapa en ny personlig dokumentlänk och ett nytt mejl till den sparade mottagaren.';
const linkLabels={missing:'Ingen dokumentlänk är registrerad',active:'Dokumentlänken är giltig',expired:'Dokumentlänken har gått ut',revoked:'Dokumentlänken är återkallad'};
const blockedLabels={no_link:'Det finns ingen dokumentlänk att förnya för detta underlag.',not_expired:'Den befintliga länken är fortfarande giltig.',revoked:'En återkallad länk kan inte förnyas här.',source_changed:'Dokumentet eller mottagaren har ändrats. Utgå från aktuellt granskat underlag för en ny inbjudan.',provider_unknown:'Mejlets utfall behöver kontrolleras hos Trafexa innan en ny dokumentlänk kan skapas.',lease_active:'Ett utskicksförsök pågår. Vänta tills resultatet har klarlagts.',actor_changed:'Förnyelsen måste göras av den som skapade den ursprungliga inbjudan.',unavailable:'Dokumentlänken kan inte förnyas med nuvarande underlag.'};
const emailLabels={pending:'Det sparade mejlet väntar på utskick.',processing:'Ett utskicksförsök pågår.',accepted:'Mejltjänsten har tagit emot mejlet. Leverans till kundens inkorg är ännu inte bekräftad.',rejected:'Mejltjänsten avvisade utskicket.',unknown:'Utskickets resultat behöver kontrolleras. Ny länk eller nytt mejl skapas inte automatiskt.',cancelled:'Utskicket har stoppats.'};
const date=(value:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
function title(kind:Props['kind']){return kind==='offer_invitation'?'Offertens dokumentlänk':kind==='contract_completed'?'Dokumentlänk till färdigsignerat avtal':'Avtalets signeringslänk';}
function version(kind:Props['kind'],value:number|null){return value===null?'Dokumentversionen kunde inte verifieras.':`${kind==='offer_invitation'?'Offert':kind==='contract_completed'?'Färdigsignerat avtal':'Avtal'} · version ${value}`;}
export function CustomerDocumentRenewal(props:Props){return <Renewal key={`${props.companyId}:${props.dealId}:${props.referenceId}:${props.kind}:${props.userId}:${props.role}`} {...props}/>;}
function Renewal({companyId,dealId,referenceId,kind,userId,role,disabled=false,onBusyChange,onDenied,onRenewed}:Props){
 const [lifecycle,setLifecycle]=useState<CustomerDocumentRenewalLifecycle|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[denied,setDenied]=useState(false),[uncertain,setUncertain]=useState(false),[refresh,setRefresh]=useState(0);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[editing,setEditing]=useState(false),[reason,setReason]=useState(''),[review,setReview]=useState<Review|null>(null);
 const alive=useRef(false),generation=useRef(0),lock=useRef(false),heading=useRef<HTMLHeadingElement>(null),busyCallback=useRef(onBusyChange),denialCallback=useRef(onDenied),renewedCallback=useRef(onRenewed);
 const [,startAction]=useTransition();busyCallback.current=onBusyChange;denialCallback.current=onDenied;renewedCallback.current=onRenewed;
 const contract=kind!=='offer_invitation';
 const readable=(contract?['owner','admin','finance']:['owner','admin','sales','finance','viewer']).includes(role);
 const writable=(contract?['owner','admin']:['owner','admin','sales']).includes(role);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;++generation.current;busyCallback.current?.(false);};},[]);
 useEffect(()=>{if(review)heading.current?.focus();},[review?.input.requestId]);
 function valid(value:CustomerDocumentRenewalLifecycle){return value.companyId===companyId&&value.dealId===dealId&&value.referenceId===referenceId&&value.kind===kind&&value.actorUserId===userId&&value.actorRole===role&&(!value.canRenew||writable&&value.linkStatus==='expired'&&!value.revoked&&!!value.emailId&&!!value.invitationId&&Number.isSafeInteger(value.generation)&&value.generation!==null&&value.generation>=0&&!!value.documentHash&&/^[0-9a-f]{64}$/.test(value.documentHash)&&Number.isSafeInteger(value.documentVersion)&&value.documentVersion!==null&&value.documentVersion>=1&&!!value.reviewToken&&/^[0-9a-f]{64}$/.test(value.reviewToken)&&['accepted','rejected','pending','processing'].includes(value.status??'')&&value.blockedReason===null);}
 function fail(result:Failure){setError(result.message);if(['access_denied','unauthenticated'].includes(result.code??'')){++generation.current;setLifecycle(null);setReview(null);setEditing(false);setReason('');setNotice('');setBusy(false);setLoading(false);setUncertain(false);setDenied(true);busyCallback.current?.(false);denialCallback.current?.(result.message);}}
 useEffect(()=>{
  const request=++generation.current;setLifecycle(null);setReview(null);setEditing(false);setReason('');
  if(denied){setLoading(false);return;}
  if(!readable){fail({code:'access_denied',message:'Din roll har inte tillgång till denna dokumentlänk.'});return;}
  setLoading(true);setError('');
  startAction(async()=>{try{
   const result=await getCustomerDocumentRenewalAction({companyId,dealId,referenceId,kind});
   if(!alive.current||generation.current!==request)return;
   if(!result.ok){fail(result);return;}
   if(!valid(result.lifecycle)){fail({code:'access_denied',message:'Dokumentlänken kunde inte verifieras för aktuellt företag, konto och dokument.'});return;}
   setLifecycle(result.lifecycle);
  }catch{if(alive.current&&generation.current===request)setError('Dokumentlänkens status kunde inte hämtas. Försök igen. Ingen ny länk eller mejl har skapats.');}
  finally{if(alive.current&&generation.current===request)setLoading(false);}});
  return()=>{++generation.current;};
 },[companyId,dealId,referenceId,kind,userId,role,refresh,denied]);
 const canRenew=writable&&lifecycle?.canRenew===true&&lifecycle.linkStatus==='expired'&&lifecycle.transport==='configured'&&!disabled&&!denied;
 function prepare(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!canRenew||!lifecycle||busy||lock.current||!event.currentTarget.reportValidity())return;setError('');setNotice('');try{
  const text=reason.trim();if(text.length<2||text.length>500)throw Error('Ange en motivering med 2–500 tecken.');
  if(!lifecycle.emailId||!lifecycle.invitationId||lifecycle.generation===null||!lifecycle.documentHash||lifecycle.documentVersion===null||!lifecycle.reviewToken)throw Error('Dokumentlänkens underlag behöver kontrolleras på nytt.');
  const input:CustomerDocumentRenewalRequest={companyId,dealId,referenceId,kind,expectedEmailId:lifecycle.emailId,expectedInvitationId:lifecycle.invitationId,expectedGeneration:lifecycle.generation,expectedDocumentHash:lifecycle.documentHash,expectedDocumentVersion:lifecycle.documentVersion,expectedRecipientEmail:lifecycle.recipientEmail,expectedReviewToken:lifecycle.reviewToken,requestId:crypto.randomUUID(),reason:text,acknowledged:true,invalidatesPreviousLink:true};
  setReview({input,source:lifecycle,invalidatesAck:false,emailAck:false});
 }catch(e){setError(e instanceof Error?e.message:'Förnyelsen kunde inte förberedas. Läs in dokumentlänkens status igen.');}}
 function confirm(){
  if(!review?.invalidatesAck||!review.emailAck||busy||loading||lock.current||denied||disabled)return;
  const frozen=review,scope=generation.current;let blockedAfter=false,renewed=false;lock.current=true;setBusy(true);setError('');setNotice('');busyCallback.current?.(true);
  startAction(async()=>{try{
   const result=await renewCustomerDocumentAction(frozen.input);
   if(!alive.current||generation.current!==scope)return;
   if(!result.ok){fail(result);if(['access_denied','unauthenticated'].includes(result.code))return;
    if('mutationStarted' in result&&result.mutationStarted===false){setUncertain(false);setReview(null);setEditing(false);if(result.code==='configuration_missing'&&'transport' in result&&(result.transport==='paused'||result.transport==='unconfigured')){setLifecycle(current=>current?{...current,transport:result.transport as 'paused'|'unconfigured'}:null);}else{setLifecycle(null);setRefresh(v=>v+1);}return;}
    blockedAfter=true;setUncertain(true);return;
   }
   const receipt=result.receipt,next=result.lifecycle,input=frozen.input;
   const same=receipt.companyId===companyId&&receipt.dealId===dealId&&receipt.referenceId===referenceId&&receipt.kind===kind&&receipt.actorUserId===userId&&(contract?['owner','admin']:['owner','admin','sales']).includes(receipt.actorRole)&&receipt.requestId===input.requestId&&receipt.previousEmailId===input.expectedEmailId&&receipt.previousInvitationId===input.expectedInvitationId&&receipt.emailId!==input.expectedEmailId&&receipt.invitationId!==input.expectedInvitationId&&receipt.generation===input.expectedGeneration+1&&receipt.recipientEmail===input.expectedRecipientEmail&&receipt.documentHash===input.expectedDocumentHash&&receipt.documentVersion===input.expectedDocumentVersion&&receipt.reason===input.reason&&receipt.reviewToken===input.expectedReviewToken;
   const receiptScope=receipt.companyId===companyId&&receipt.dealId===dealId&&receipt.referenceId===referenceId&&receipt.kind===kind&&receipt.actorUserId===userId;
   const nextScope=next.companyId===companyId&&next.dealId===dealId&&next.referenceId===referenceId&&next.kind===kind&&next.actorUserId===userId;
   if(!receiptScope||!nextScope){fail({code:'access_denied',message:'Förnyelsens kvitto tillhör inte aktuellt företag, konto och dokument.'});return;}
   if(!same||!valid(next)){blockedAfter=true;setUncertain(true);setError('Förnyelsens kvitto eller aktuella underlag kunde inte verifieras. Behåll samma granskade begäran och kontrollera den igen.');return;}
   setLifecycle(next);setReview(null);setEditing(false);setReason('');setUncertain(false);setNotice('Den granskade förnyelsen är registrerad. Dokumentlänkens aktuella giltighet och mejlstatus visas nedan.');renewed=true;
  }catch{if(alive.current&&generation.current===scope){blockedAfter=true;setUncertain(true);setError('Förnyelsens resultat är okänt. Kontrollera samma granskade begäran igen. Skapa inte en ny förnyelse eller ett separat utskick.');}}
  finally{lock.current=false;if(alive.current&&generation.current===scope){setBusy(false);busyCallback.current?.(blockedAfter);if(renewed)renewedCallback.current?.();}}});
 }
 return <section className="surface" aria-label={title(kind)} style={{padding:16,marginTop:16,minWidth:0,overflowWrap:'anywhere'}}>
  <h5>{title(kind)}</h5><p>Dokumentlänkens giltighet och mejlets utskick är separata. Att läsa eller uppdatera status skapar ingen länk och skickar inget mejl.</p>
  <button type="button" className="button button-outline button-small" style={{...buttonStyle,marginBlock:12}} disabled={loading||busy||denied||disabled||editing||!!review} onClick={()=>{if(lock.current||uncertain)return;setNotice('');setRefresh(v=>v+1);}}>Uppdatera dokumentlänkens status</button>
  {loading?<p role="status">Verifierar sparad dokumentlänk…</p>:null}{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  {lifecycle?<><p><strong>{uncertain?'Senast granskad länk · utfallet behöver kontrolleras':linkLabels[lifecycle.linkStatus]}</strong></p><p>Mottagare: <strong>{lifecycle.recipientEmail}</strong><br/>{version(kind,lifecycle.documentVersion)}</p>{lifecycle.expiresAt?<p>{uncertain?'Tidigare granskad giltighet':'Giltig till'} <time dateTime={lifecycle.expiresAt}>{date(lifecycle.expiresAt)}</time> (svensk tid).</p>:null}
   {uncertain?<p>Mejlstatusen för förnyelsen är ännu inte verifierad.</p>:lifecycle.canRenew&&['pending','processing'].includes(lifecycle.status??'')?<p>Det tidigare mejlet saknar bekräftat utskick. Den utgångna länken kan förnyas efter granskning.</p>:lifecycle.status?<p>{emailLabels[lifecycle.status]}</p>:<p>Inget mejl är registrerat för dokumentlänken.</p>}
   {lifecycle.transport!=='configured'?<p>{lifecycle.transport==='paused'?'Dokumentmejlen är pausade.':'Mejlinställningarna behöver kompletteras.'} Förnyelse är inte aktiverad och inget nytt mejl bekräftas skickat.</p>:null}
   {lifecycle.blockedReason?<p>{blockedLabels[lifecycle.blockedReason]}</p>:null}
   {canRenew&&!editing&&!review?<button type="button" className="button button-outline" style={buttonStyle} onClick={()=>{setEditing(true);setReason('');setError('');setNotice('');}}>Förnya utgången dokumentlänk</button>:null}
   {editing&&!review&&canRenew?<form className="workspace-form" onSubmit={prepare} style={{minWidth:0,marginTop:16}}><label style={{fontSize:13}}>Motivering till förnyelsen<textarea value={reason} minLength={2} maxLength={500} required disabled={busy} onChange={event=>setReason(event.target.value)}/></label><button type="submit" className="button button-outline" style={buttonStyle} disabled={busy}>Granska förnyelsen</button><button type="button" className="button button-outline" style={buttonStyle} disabled={busy} onClick={()=>{setEditing(false);setReason('');setError('');}}>Avbryt förnyelsen</button></form>:null}
  </>:null}
  {review?<section className="workspace-form" aria-label="Slutgranskning av dokumentlänkens förnyelse" style={{minWidth:0,marginTop:16}}><h5 ref={heading} tabIndex={-1}>Granska ny personlig dokumentlänk</h5><p>Mottagare: <strong>{review.source.recipientEmail}</strong><br/>{version(kind,review.source.documentVersion)}</p>{review.source.expiresAt?<p>Den granskade länken gick ut <time dateTime={review.source.expiresAt}>{date(review.source.expiresAt)}</time> (svensk tid).</p>:null}<p>Motivering: {review.input.reason}</p><p>Förnyelsen gäller samma sparade dokumentversion och mottagare. Den tidigare länken blir ogiltig. Ett nytt mejl hör till den nya personliga länken.</p>
   <label style={{display:'flex',flexDirection:'row',gap:10,alignItems:'start',fontSize:13,fontWeight:400,lineHeight:1.6,color:'var(--ink)'}}><input type="checkbox" style={{width:18,height:18,flexShrink:0,marginTop:2}} checked={review.invalidatesAck} disabled={busy||uncertain||disabled} onChange={event=>setReview({...review,invalidatesAck:event.target.checked})}/><span>{firstAck}</span></label>
   <label style={{display:'flex',flexDirection:'row',gap:10,alignItems:'start',fontSize:13,fontWeight:400,lineHeight:1.6,color:'var(--ink)'}}><input type="checkbox" style={{width:18,height:18,flexShrink:0,marginTop:2}} checked={review.emailAck} disabled={busy||uncertain||disabled} onChange={event=>setReview({...review,emailAck:event.target.checked})}/><span>{secondAck}</span></label>
   {uncertain?<p role="status">Samma begäran, mottagare och dokumentversion behålls. Endast denna begäran kan kontrolleras igen; ingen automatisk förnyelse eller nytt utskick görs.</p>:null}
   <button type="button" className="button button-green" style={buttonStyle} disabled={busy||disabled||!review.invalidatesAck||!review.emailAck} onClick={confirm}>{busy?'Kontrollerar förnyelsen…':uncertain?'Kontrollera samma förnyelse igen':'Bekräfta ny länk och nytt mejl'}</button>
   <button type="button" className="button button-outline" style={buttonStyle} disabled={busy||uncertain||disabled} onClick={()=>setReview(null)}>Tillbaka och ändra motivering</button>
  </section>:null}
 </section>;
}
