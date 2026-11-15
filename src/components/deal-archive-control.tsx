'use client';
import {useEffect,useRef,useState} from 'react';
import {getDealArchiveAction,mutateDealArchiveAction,getDealDeleteAction,mutateDealDeleteAction} from '@/lib/deal-archives/actions';
import type {DealArchiveInput,DealArchivePage,DealDeletePage as DeletePage,DealDeleteInput as DeleteInput} from '@/lib/deal-archives/types';
import {useDescendantBusy} from './use-descendant-busy';
type Operation='archive'|'restore'|'delete';
type Props={companyId:string;userId:string;role:string;dealId:string;demo?:boolean;archived?:boolean;blocked?:boolean;operation?:Operation;onCancel?:()=>void;onBusyChange?:(busy:boolean)=>void;onAccessDenied?:()=>void;onCompleted?:()=>void};
export function DealArchiveControl(p:Props){return <Control key={`${p.companyId}:${p.userId}:${p.role}:${p.dealId}:${!!p.demo}:${p.operation??'list'}`} {...p}/>;}
function Control(p:Props){
 const [review,setReview]=useState<{operation:Operation;page:DealArchivePage|DeletePage}|null>(null),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[denied,setDenied]=useState(false),[done,setDone]=useState(false);
 const pending=useRef<{operation:Operation;input:DealArchiveInput|DeleteInput}|null>(null),active=useRef(false),alive=useRef(true),container=useRef<HTMLElement>(null),returnOperation=useRef<Operation|null>(null),heading=useRef<HTMLHeadingElement>(null),trigger=useRef<HTMLButtonElement|null>(null);
 const {report}=useDescendantBusy(p.onBusyChange);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(review)heading.current?.focus();else if(returnOperation.current){container.current?.querySelector<HTMLButtonElement>(`[data-operation="${returnOperation.current}"]`)?.focus();returnOperation.current=null;}},[review]);
 useEffect(()=>{if(p.operation&&!p.demo&&['owner','admin'].includes(p.role))void read(p.operation,null);},[]);
 if(p.demo||!['owner','admin'].includes(p.role))return null;
 if(denied)return <p role="alert">{message||'Affärens behörighet kunde inte verifieras.'}</p>;
 function matches(v:{companyId:string;dealId:string;actorId:string;role?:string}){return v.companyId===p.companyId&&v.dealId===p.dealId&&v.actorId===p.userId&&(v.role===undefined||v.role===p.role);}
 function fail(r:{code:string;message:string}){setMessage(r.message);if(r.code==='access_denied'){pending.current=null;setReview(null);setDenied(true);report(false);p.onAccessDenied?.();}else if(r.code!=='unavailable'){pending.current=null;setReview(null);report(false);}}
 async function read(operation:Operation,button:HTMLButtonElement|null){
  if(active.current||pending.current||p.blocked)return;trigger.current=button;active.current=true;setLoading(true);setMessage('');report(true);
  try{const r=operation==='delete'?await getDealDeleteAction({companyId:p.companyId,dealId:p.dealId}):await getDealArchiveAction({companyId:p.companyId,dealId:p.dealId});if(!alive.current)return;if(!r.ok){fail(r);return;}if(!matches(r.page)||r.page.role!==p.role){fail({code:'access_denied',message:'Affärens behörighet kunde inte verifieras.'});return;}if(operation!=='delete'&&'archived'in r.page&&r.page.archived===(operation==='archive')){setDone(true);setMessage(operation==='archive'?'Affären är redan arkiverad.':'Affären visas redan i listan.');p.onCompleted?.();return;}setReview({operation,page:r.page});}
  catch{if(alive.current)setMessage('Status kunde inte hämtas. Försök igen.');}
  finally{active.current=false;if(alive.current){setLoading(false);report(false);}}
 }
 async function submit(){
  if(active.current||!review)return;
  const request=pending.current??{operation:review.operation,input:review.operation==='delete'?{companyId:p.companyId,dealId:p.dealId,reviewHash:review.page.reviewHash,acknowledged:true as const,requestId:crypto.randomUUID()}:{companyId:p.companyId,dealId:p.dealId,operation:review.operation,expectedVersion:(review.page as DealArchivePage).version,reviewHash:review.page.reviewHash,reason:review.operation==='archive'?'Arkiverad från affärslistan':'Återställd från affärslistan',acknowledged:true as const,requestId:crypto.randomUUID()}};
  pending.current=request;active.current=true;setLoading(true);setMessage('');report(true);
  try{const r=request.operation==='delete'?await mutateDealDeleteAction(request.input as DeleteInput):await mutateDealArchiveAction(request.input as DealArchiveInput);if(!alive.current)return;if(!r.ok){fail(r);return;}const receipt='page'in r?r.page:r.receipt;if(!matches(receipt)||request.operation==='delete'&&(!('deleted'in receipt)||receipt.deleted!==true||!('requestId'in receipt)||receipt.requestId!==request.input.requestId)||request.operation!=='delete'&&(!('role'in receipt)||receipt.role!==p.role||!('archived'in receipt)||receipt.archived!==(request.operation==='archive'))){fail({code:'access_denied',message:'Affärens resultat kunde inte verifieras.'});return;}pending.current=null;setReview(null);setDone(true);setMessage(request.operation==='delete'?'Affären är raderad från listorna.':request.operation==='archive'?'Affären är arkiverad. Dokument och historik finns kvar.':'Affären visas i listan igen.');report(false);p.onCompleted?.();}
  catch{if(alive.current)setMessage('Resultatet kunde inte bekräftas. Kontrollera samma begäran igen.');}
  finally{active.current=false;if(alive.current){setLoading(false);if(!pending.current)report(false);}}
 }
 const operation=review?.operation,canProceed=review&&(operation==='delete'?(review.page as DeletePage).canDelete:operation==='restore'||(review.page as DealArchivePage).canArchive);
 const why=review?.page.blockedReason;
 const explanation=operation==='delete'?(why==='active_reservation'?'Avsluta reservationen innan affären raderas.':why==='not_draft'?'Affärens status tillåter inte radering. Arkivera affären i stället.':'Affären har underlag eller historik som behöver sparas och kan inte raderas. Använd Arkivera för att ta bort den från den aktiva listan.'):why==='active_reservation'?'Avsluta reservationen innan affären arkiveras.':why==='live_contract'?'Ett avtal väntar fortfarande på underskrift eller en offert är aktiv. Slutför eller återkalla underlaget först.':why==='unsettled_payment'?'Affären har oavslutade betalningar. Stäm av dem först.':'Affären kan inte arkiveras i sin nuvarande status.';
 return <section ref={container} aria-label="Hantera affär" style={{padding:'0 16px 16px',display:'flex',flexWrap:'wrap',gap:8,minWidth:0}}>
 {!review&&!done&&!p.operation?<><button type="button" className="button button-outline" data-operation={p.archived?'restore':'archive'} disabled={loading||p.blocked} onClick={e=>void read(p.archived?'restore':'archive',e.currentTarget)}>{p.archived?'Återställ i listan':'Arkivera'}</button><button type="button" className="button button-outline" data-operation="delete" disabled={loading||p.blocked} onClick={e=>void read('delete',e.currentTarget)}>Radera affär</button></>:null}
 {p.operation&&!review&&!done&&!loading?<><button type="button" className="button button-outline" onClick={()=>void read(p.operation!,null)}>Läs in aktuell status</button><button type="button" className="button button-outline" onClick={()=>p.onCancel?.()}>Avbryt</button></>:null}
 {loading&&!review?<p role="status">Läser in affären…</p>:null}
 {review?<div className="surface" style={{padding:16,flexBasis:'100%',minWidth:0}} role="region" aria-label={operation==='delete'?'Bekräfta radering':'Bekräfta arkivering'}><h4 ref={heading} tabIndex={-1}>{operation==='delete'?'Radera affären?':operation==='restore'?'Visa affären i listan igen?':'Arkivera affären?'}</h4><p>{canProceed?operation==='delete'?'Affären tas bort från listorna. Sparade underlag och historik bevaras internt. Detta går inte att ångra här.':operation==='restore'?'Affären visas i listan igen.':'Affären tas bort från den aktiva listan. Avtal och historik finns kvar under Arkiverade.':explanation}</p><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{canProceed?<button type="button" className="button button-green" disabled={loading} onClick={()=>void submit()}>{loading?'Verifierar…':pending.current?'Kontrollera samma begäran igen':operation==='delete'?'Bekräfta radering':operation==='restore'?'Återställ affär':'Bekräfta arkivering'}</button>:null}{!pending.current?<button type="button" className="button button-outline" disabled={loading} onClick={()=>{returnOperation.current=review.operation;setReview(null);setMessage('');p.onCancel?.();queueMicrotask(()=>trigger.current?.focus());}}>Avbryt</button>:null}</div></div>:null}
 {message?<p role="status" style={{flexBasis:'100%'}}>{message}</p>:null}
 </section>;
}
