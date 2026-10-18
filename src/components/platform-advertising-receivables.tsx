'use client';

import dynamic from 'next/dynamic';
import {useCallback,useEffect,useId,useRef,useState,useTransition} from 'react';
import {getPlatformAdvertisingReceivablesAction} from '@/lib/advertising/receivables-actions';
import {getPlatformAdvertisingIssuedInvoiceAction} from '@/lib/advertising/issuance-actions';
import type {AdvertisingReceivablesCursor,AdvertisingReceivablesFilter,AdvertisingReceivablesItem,AdvertisingReceivablesPage} from '@/lib/advertising/receivables-types';
import type {AdvertisingIssuedInvoice} from '@/lib/advertising/issuance-types';

const AdvertisingPaymentPanel=dynamic(()=>import('./advertising-payment-panel').then(module=>module.AdvertisingPaymentPanel),{loading:()=> <p role="status">Läser in fakturans betalningsavstämning…</p>});
type Props={actorUserId:string;onDenied?:(message:string)=>void;onBusyChange?:(busy:boolean)=>void};
const filters:[AdvertisingReceivablesFilter,string][]=[['all','Alla fakturor'],['unpaid','Obetalda'],['partial','Delbetalda'],['settled','Avstämda'],['overpaid','Överskott att hantera'],['credited','Krediterade'],['overdue','Förfallna med restbelopp']];
const labels={unpaid:'Obetald',partial:'Delbetald',settled:'Avstämd',overpaid:'Överskott',credited:'Krediterad'};
const countLabels={unpaid:'Obetalda',partial:'Delbetalda',settled:'Avstämda',overpaid:'Överskott',credited:'Krediterade'};
const detailRow={display:'grid',gridTemplateColumns:'minmax(0,1fr)',gap:6};
function money(value:string){const amount=BigInt(value);return `${(amount/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ')},${(amount%100n).toString().padStart(2,'0')} kr`;}
const count=(value:string)=>value.replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const stamp=(value:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

function InvoiceParties({invoice}:{invoice:AdvertisingIssuedInvoice}){
 const source=invoice.snapshot.assessment.snapshot.draft.snapshot;
 return <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:20}}>{[['Säljare',source.sellerProfile.fields],['Fakturamottagare',source.buyerProfile.fields]].map(([label,fields])=>{
  if(typeof fields==='string')return null;
  return <section key={String(label)} aria-label={`${label} i utfärdad faktura`}><h4>{String(label)}</h4><p><strong>{fields.legalName}</strong><br/>Organisationsnummer {fields.organisationNumber}<br/>{fields.addressLine1}{fields.addressLine2?<><br/>{fields.addressLine2}</>:null}<br/>{fields.postalCode} {fields.city}<br/>{fields.countryCode}<br/>{fields.invoiceEmail}{fields.reference?<><br/>Referens: {fields.reference}</>:null}</p></section>;
 })}</div>;
}
export function PlatformAdvertisingReceivables(props:Props){return <Receivables key={props.actorUserId} {...props}/>;}
function Receivables({actorUserId,onDenied,onBusyChange}:Props){
 const filterId=useId();
 const [filter,setFilter]=useState<AdvertisingReceivablesFilter>('all'),[cursors,setCursors]=useState<(AdvertisingReceivablesCursor|null)[]>([null]),[position,setPosition]=useState(0),[refresh,setRefresh]=useState(0);
 const [page,setPage]=useState<AdvertisingReceivablesPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[denied,setDenied]=useState(false);
 const [selected,setSelected]=useState<AdvertisingReceivablesItem|null>(null),[invoice,setInvoice]=useState<AdvertisingIssuedInvoice|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
 const alive=useRef(false),generation=useRef(0),detailGeneration=useRef(0),denial=useRef(onDenied),rowButtons=useRef(new Map<string,HTMLButtonElement>()),restoreInvoice=useRef<string|null>(null),heading=useRef<HTMLHeadingElement>(null),detailHeading=useRef<HTMLHeadingElement>(null);
 const [paymentBusy,setPaymentBusy]=useState(false);
 const paymentBusyRef=useRef(false),busyCallback=useRef(onBusyChange);busyCallback.current=onBusyChange;
 const reportBusy=useCallback((busy:boolean)=>{paymentBusyRef.current=busy;setPaymentBusy(busy);busyCallback.current?.(busy);},[]);
 const [,startRead]=useTransition();denial.current=onDenied;
 const cursor=cursors[position]??null;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;++generation.current;++detailGeneration.current;busyCallback.current?.(false);};},[]);
 useEffect(()=>{if(selected?.invoiceId)detailHeading.current?.focus();},[selected?.invoiceId,invoice]);
 useEffect(()=>{if(page&&restoreInvoice.current){(rowButtons.current.get(restoreInvoice.current)??heading.current)?.focus();restoreInvoice.current=null;}},[page]);
 function clearDetail(){++detailGeneration.current;setSelected(null);setInvoice(null);setDetailLoading(false);setDetailError('');}
 function fail(result:{code?:string;message:string},detail=false){
  if(['access_denied','unauthenticated'].includes(result.code??'')){
   ++generation.current;clearDetail();setPage(null);setLoading(false);setDenied(true);setError(result.message);restoreInvoice.current=null;reportBusy(false);denial.current?.(result.message);
  }else if(detail)setDetailError(result.message);else setError(result.message);
 }
 useEffect(()=>{
  const request=++generation.current;clearDetail();setPage(null);
  if(denied){setLoading(false);return;}
  setError('');setLoading(true);
  startRead(async()=>{
   try{
    const result=await getPlatformAdvertisingReceivablesAction({filter,cursor});
    if(!alive.current||generation.current!==request)return;
    if(!result.ok){fail(result);return;}
    const next=result.page;
    if(next.actorUserId!==actorUserId||next.actorRole!=='platform_admin'||next.filter!==filter||next.items.length>25||next.nextCursor&&(next.nextCursor.actorUserId!==actorUserId||next.nextCursor.filter!==filter)){
     fail({code:'access_denied',message:'Fakturorna eller din superadminbehörighet kunde inte verifieras.'});return;
    }
    setPage(next);
   }catch{if(alive.current&&generation.current===request)setError('Annonsfakturorna kunde inte hämtas. Inga totalsummor har verifierats. Försök igen.');}
   finally{if(alive.current&&generation.current===request)setLoading(false);}
  });
  return()=>{++generation.current;++detailGeneration.current;};
 },[actorUserId,filter,cursor,refresh,denied]);
 function reset(next:AdvertisingReceivablesFilter=filter){if(paymentBusyRef.current)return;++generation.current;clearDetail();setPage(null);setError('');setFilter(next);setCursors([null]);setPosition(0);setRefresh(v=>v+1);}
 function move(next:boolean){if(!page||loading||denied||paymentBusyRef.current)return;++generation.current;clearDetail();setPage(null);setError('');if(next&&page.nextCursor){setCursors(v=>[...v.slice(0,position+1),page.nextCursor]);setPosition(v=>v+1);}else if(!next&&position>0)setPosition(v=>v-1);}
 function open(row:AdvertisingReceivablesItem){
  if(loading||denied||!page||paymentBusyRef.current)return;
  const request=++detailGeneration.current,scope=generation.current;setSelected(row);setInvoice(null);setDetailError('');setDetailLoading(true);
  startRead(async()=>{
   try{
    const result=await getPlatformAdvertisingIssuedInvoiceAction({companyId:row.companyId,id:row.invoiceId});
    if(!alive.current||generation.current!==scope||detailGeneration.current!==request)return;
    if(!result.ok){fail(result,true);return;}
    const saved=result.invoice,buyer=saved.snapshot.assessment.snapshot.draft.snapshot.buyerProfile.fields;
    if(saved.id!==row.invoiceId||saved.companyId!==row.companyId||saved.sourceHash!==row.invoiceSourceHash||saved.invoiceNumber!==row.invoiceNumber||saved.invoiceDate!==row.invoiceDate||saved.dueDate!==row.dueDate||saved.snapshot.grossTotalOre!==row.grossTotalOre||buyer.legalName!==row.buyerLegalName||buyer.organisationNumber!==row.buyerOrganisationNumber){fail({code:'access_denied',message:'Fakturans bevarade original kunde inte verifieras mot den valda raden.'});return;}
    setInvoice(saved);
   }catch{if(alive.current&&generation.current===scope&&detailGeneration.current===request)setDetailError('Fakturans original kunde inte hämtas. Försök igen.');}
   finally{if(alive.current&&generation.current===scope&&detailGeneration.current===request)setDetailLoading(false);}
  });
 }
 function close(){if(paymentBusyRef.current)return;restoreInvoice.current=selected?.invoiceId??null;clearDetail();++generation.current;setPage(null);setError('');setRefresh(v=>v+1);}
 const summary=page?.summary;
 return <section aria-label="Trafexas annonsfakturor" style={{minWidth:0,overflowWrap:'anywhere'}}>
  <h2 ref={heading} tabIndex={-1}>Annonsfakturor</h2>
  <p>Utfärdade annonsfakturor och manuellt registrerad betalningsavstämning för samtliga företag. Beloppen visar registreringarna i Trafexa; de är inte bankverifierade saldon eller omsättning.</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'end',marginBlock:20}}>
   <div style={{display:'grid',gap:6,minWidth:0,maxWidth:'100%'}}><label htmlFor={filterId}>Fakturastatus</label><select id={filterId} value={filter} disabled={loading||denied||paymentBusy} style={{maxWidth:'100%'}} onChange={event=>reset(event.target.value as AdvertisingReceivablesFilter)}>{filters.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
   <button type="button" className="button button-outline" disabled={loading||denied||paymentBusy} style={{whiteSpace:'normal'}} onClick={()=>reset()}>Uppdatera annonsfakturor</button>
  </div>
  {loading?<p role="status">Verifierar annonsfakturor och globala saldon…</p>:null}
  {error?<div><p role="alert">{error}</p>{!denied?<button type="button" className="button button-outline" disabled={loading} onClick={()=>reset()}>Försök läsa fakturorna igen</button>:null}</div>:null}
  {page&&summary?<>
   <section className="surface" aria-label="Globala fakturasaldon" style={{padding:20,marginBlock:20,minWidth:0}}><h3>Alla utfärdade annonsfakturor</h3><p>Saldona gäller alla företag och påverkas inte av fakturafiltret eller sidan i listan. Även historiska fakturor för spärrade företag ingår.</p><p>{count(summary.totalCount)} fakturor totalt · {count(summary.overdueCount)} med förfallet restbelopp.<br/>Verifierat <time dateTime={page.generatedAt}>{stamp(page.generatedAt)}</time> (svensk tid).</p>
    <dl aria-label="Globala fakturaantal" className="detail-list" style={{padding:'8px 0',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,130px),1fr))',gap:'0 20px'}}>{(Object.keys(countLabels) as (keyof typeof countLabels)[]).map(status=><div key={status} style={detailRow}><dt>{countLabels[status]}</dt><dd style={{textAlign:'left'}}>{count(summary.counts[status])}</dd></div>)}</dl>
    <dl className="detail-list" style={{padding:'8px 0',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:'0 24px'}}>{[
     ['Ursprungliga fakturabelopp',summary.grossTotalOre],['Utfärdade krediter',summary.creditTotalOre],['Fordran efter krediter',summary.receivableOre],['Registrerat mottaget, efter återföringar',summary.receivedOre],['Kvar att betala enligt registreringarna',summary.outstandingOre],['Förfallet restbelopp',summary.overdueOutstandingOre],['Överskott att hantera separat',summary.surplusOre],
    ].map(([label,value])=><div key={label} style={detailRow}><dt>{label}</dt><dd style={{textAlign:'left',minWidth:0}}>{money(value)}</dd></div>)}</dl><p>Överskott och krediter kräver separat avstämning av eventuell återbetalning. Vyn flyttar inga pengar.</p>
   </section>
   <section className="surface" aria-label="Lista över annonsfakturor" style={{marginBlock:20,minWidth:0}}><h3 style={{padding:20}}>Utfärdade fakturor · {filters.find(([value])=>value===filter)?.[1]}</h3>
    {page.items.length?<div className="table-scroll"><table className="data-table"><caption>Fakturanummer, mottagare och registrerade betalningssaldon</caption><thead><tr><th scope="col">Faktura och företag</th><th scope="col">Förfallodag</th><th scope="col">Status</th><th scope="col">Fakturabelopp</th><th scope="col">Registrerat mottaget</th><th scope="col">Restbelopp</th><th scope="col">Överskott</th><th scope="col">Öppna</th></tr></thead><tbody>{page.items.map(row=><tr key={row.invoiceId}><td style={{minWidth:180}}><strong>{row.invoiceNumber}</strong><span className="cell-subtext">{row.companyLabel}{row.companyStatus==='suspended'?' · Företaget är spärrat':''}</span><span className="cell-subtext">Fakturamottagare: {row.buyerLegalName} · {row.buyerOrganisationNumber}</span><span className="cell-subtext">Fakturadatum {row.invoiceDate}</span></td><td>{row.dueDate}</td><td><span className="badge">{labels[row.status]}</span>{row.isOverdue?<span className="badge badge-amber">Förfallen</span>:null}{row.credit?<span className="cell-subtext">Kredit {row.credit.creditNumber}</span>:null}</td><td>{money(row.grossTotalOre)}</td><td>{money(row.receivedOre)}</td><td>{money(row.outstandingOre)}</td><td>{money(row.surplusOre)}</td><td><button type="button" className="button button-outline button-small" disabled={paymentBusy} ref={button=>{if(button)rowButtons.current.set(row.invoiceId,button);else rowButtons.current.delete(row.invoiceId);}} onClick={()=>open(row)}>Visa faktura {row.invoiceNumber}</button></td></tr>)}</tbody></table></div>:<div className="empty-state"><h4>{summary.totalCount==='0'?'Inga annonsfakturor har utfärdats ännu.':position>0&&page.filteredCount!=='0'?'Den här sidan är tom efter en ändring.':'Inga fakturor matchar valt filter.'}</h4><p>{summary.totalCount==='0'?'Utfärdade fakturor visas här när de finns.':'Byt filter eller gå till första sidan för att fortsätta.'}</p>{summary.totalCount!=='0'?<button type="button" className="button button-outline" onClick={()=>reset('all')}>Visa alla fakturor</button>:null}</div>}
    <div className="table-footer" style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}><span>Visar {page.items.length} av {count(page.filteredCount)} matchande fakturor.</span><nav aria-label="Annonsfakturornas sidor" style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><button type="button" className="button button-outline button-small" disabled={loading||denied||paymentBusy||position===0} onClick={()=>move(false)}>Nyare fakturor</button><span>Sida {position+1}</span><button type="button" className="button button-outline button-small" disabled={loading||denied||paymentBusy||!page.nextCursor} onClick={()=>move(true)}>Äldre fakturor</button></nav></div>
   </section>
  </>:null}
  {selected?<section className="surface" aria-label="Valt fakturaoriginal och avstämning" style={{padding:20,marginBlock:20,minWidth:0}}>
   <h3 ref={detailHeading} tabIndex={-1}>Faktura {selected.invoiceNumber}</h3><button type="button" className="button button-outline" disabled={paymentBusy} style={{whiteSpace:'normal',marginBlock:12,maxWidth:'100%'}} onClick={close}>Stäng fakturan och uppdatera översikten</button>
   {detailLoading?<p role="status">Verifierar fakturans bevarade original…</p>:null}{detailError?<><p role="alert">{detailError}</p><button type="button" className="button button-outline" disabled={detailLoading} onClick={()=>open(selected)}>Försök läsa fakturan igen</button></>:null}
   {invoice?<><p>Fakturadatum {invoice.invoiceDate}<br/>Förfallodag {invoice.dueDate}</p><InvoiceParties invoice={invoice}/><dl className="detail-list" style={{padding:'8px 0'}}>{[['Exklusive moms',invoice.snapshot.netTotalOre],['Moms',invoice.snapshot.vatTotalOre],['Inklusive moms',invoice.snapshot.grossTotalOre]].map(([label,value])=><div key={label} style={detailRow}><dt>{label}</dt><dd style={{textAlign:'left',minWidth:0}}>{money(value)}</dd></div>)}</dl><a className="text-link" href={`/api/advertising/issued/${encodeURIComponent(invoice.id)}/pdf?companyId=${encodeURIComponent(invoice.companyId)}`}>Hämta PDF av faktura {invoice.invoiceNumber}</a><AdvertisingPaymentPanel companyId={invoice.companyId} userId={actorUserId} role="platform_admin" superadmin invoiceId={invoice.id} invoiceSourceHash={invoice.sourceHash} onBusyChange={reportBusy} onDenied={message=>fail({code:'access_denied',message})}/></>:null}
  </section>:null}
 </section>;
}
