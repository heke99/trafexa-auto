'use client';

import {useCallback,useId,useState} from 'react';
import {ArrowRight,ShieldCheck} from 'lucide-react';
import {createFinanceIntakeRequestAction,type FinanceIntakeCreateInput} from '@/lib/data/create-record-actions';
import {normalizeCreateMoney,normalizeCreateText,useCreateRequest} from './use-create-request';
import type {WorkspaceSnapshot} from '@/lib/data/workspace';
import type {DealerRegisterDeal,DealerRegisterPage} from '@/lib/registers/types';
import {formatOre} from '@/lib/calculations/vehicle-calculation';
import {DealerRegisters} from './dealer-registers';

type Props={snapshot:WorkspaceSnapshot;companyId:string;demo?:boolean};
const date=(value:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'}).format(new Date(value));
function description(deal:DealerRegisterDeal){return `${deal.stockItem.vehicles.make} ${deal.stockItem.vehicles.model} · ${deal.stockItem.vehicles.registration_number} · ${deal.customer.name} · ${formatOre(String(deal.sale_price_ore))} · ${date(deal.created_at)}`;}


export function FinanceRequestForm(props:Props){
 const {snapshot,companyId,demo=false}=props;
 const role=snapshot.membership?.role??'viewer';
 if(companyId!==snapshot.organization?.id||!['owner','admin','sales','finance'].includes(role))return <p role="status">Du har inte behörighet att anmäla finansbehov i det aktiva företaget.</p>;
 return <ScopedFinanceRequestForm key={`${companyId}:${snapshot.user.id}:${role}:${demo}`} {...props}/>;
}
function ScopedFinanceRequestForm({snapshot,companyId,demo=false}:Props){
 const [fields,setFields]=useState({product:'purchase' as 'purchase'|'stock',requestedAmount:'',deposit:'0',termMonths:'',note:''});
 const [pickerOpen,setPickerOpen]=useState(false);
 const [selection,setSelection]=useState<{deal:DealerRegisterDeal;snapshot:WorkspaceSnapshot}|null>(null);
 const selected=selection?.snapshot===snapshot?selection.deal:null;
 const [verified,setVerified]=useState<{page:DealerRegisterPage;snapshot:WorkspaceSnapshot}|null>(null);
 const summaryId=useId();
 const request=useCreateRequest<Omit<FinanceIntakeCreateInput,'requestId'>>({companyId,actorId:snapshot.user.id,kind:'finance_intake',action:createFinanceIntakeRequestAction,onSuccess:()=>{setFields({product:'purchase',requestedAmount:'',deposit:'0',termMonths:'',note:''});setSelection(null);},onDenied:()=>{setFields({product:'purchase',requestedAmount:'',deposit:'0',termMonths:'',note:''});setSelection(null);setVerified(null);}});
 const disabled=demo||request.pending||request.denied||request.conflicted;
 const change=(key:keyof typeof fields,value:string)=>{request.edit();setFields(current=>({...current,[key]:value}));};
 const clearSelection=useCallback(()=>{setSelection(null);setVerified(null);},[]);
 const verifySelection=useCallback((page:DealerRegisterPage)=>{
  setVerified({page,snapshot});
  setSelection(current=>{if(!current||current.snapshot!==snapshot||page.kind!=='deals')return null;const deal=page.rows.find(row=>row.id===current.deal.id);return deal&&deal.status===current.deal.status&&deal.sale_price_ore===current.deal.sale_price_ore?{deal,snapshot}:null;});
 },[snapshot]);
 if(request.denied)return <p role="alert">{request.state.message}</p>;
 return <>
  <div className="inline-note"><ShieldCheck size={19}/><p>Detta är en intresseanmälan till Trafexa. Ingen kreditupplysning tas och ingen ansökan skickas till en bank.</p></div>
  <section aria-label="Kopplad affär" style={{marginBlock:'16px'}}>
   <p id={summaryId}>{selected?<>Vald affär: <strong>{description(selected)}</strong></>:'Ingen kopplad affär. Du kan anmäla behovet utan att välja en affär.'}</p>
   <button type="button" className="button button-outline" aria-expanded={pickerOpen} disabled={request.pending} onClick={()=>setPickerOpen(value=>!value)}>{pickerOpen?'Stäng affärsväljaren':selected?'Byt affär':'Välj affär'}</button>
   {selected?<button type="button" className="button button-outline" disabled={request.pending} onClick={()=>setSelection(null)}>Ta bort koppling</button>:null}
  </section>
  {pickerOpen?<DealerRegisters kind="deals" companyId={companyId} userId={snapshot.user.id} role={snapshot.membership?.role??'viewer'} demo={demo} snapshot={snapshot} onCriteriaChange={clearSelection} onPage={verifySelection} renderRows={page=>page.kind==='deals'?<ul style={{listStyle:'none',padding:0}}>{page.rows.map(deal=><li key={deal.id} style={{paddingBlock:12,borderBottom:'1px solid var(--border)',overflowWrap:'anywhere'}}><p>{description(deal)}</p><button type="button" className="button button-outline" aria-pressed={selected?.id===deal.id} disabled={disabled||verified?.page!==page||verified.snapshot!==snapshot} onClick={()=>{request.edit();setSelection({deal,snapshot});}}>Välj {deal.stockItem.vehicles.registration_number}</button></li>)}</ul>:null}/>:null}
  <form method="post" className="workspace-form" aria-label="Anmäl finansbehov" onSubmit={event=>{event.preventDefault();if(disabled)return;void request.submit({companyId,product:fields.product,dealId:selected?.id??null,requestedAmount:normalizeCreateMoney(fields.requestedAmount),deposit:normalizeCreateMoney(fields.deposit),termMonths:normalizeCreateText(fields.termMonths).replace(/^0+(?=\d)/,''),note:normalizeCreateText(fields.note)});}}>
   {request.state.message?<p role={request.state.status==='success'?'status':'alert'}>{request.state.message}</p>:null}
  {request.state.status==='unknown'?<button type="button" className="button button-outline" onClick={request.retry}>Kontrollera samma begäran</button>:null}
   <input type="hidden" name="expected_company_id" value={companyId}/><input type="hidden" name="deal_id" value={selected?.id??''}/>
   {demo?<p className="form-privacy">Demonstration i läsläge. Ingen intresseanmälan skickas.</p>:null}
   <label>Vad gäller behovet?<select name="product" value={fields.product} onChange={e=>change('product',e.target.value)} disabled={disabled}><option value="purchase">Köpfinansiering för kund</option><option value="stock">Lagerfinansiering för företaget</option></select></label>
   <p aria-describedby={summaryId}>{selected?'Intresseanmälan kopplas till vald affär ovan.':'Intresseanmälan skickas utan kopplad affär.'}</p>
   <div className="field-pair"><label>Önskat finansbelopp, kr<input name="requested_amount" value={fields.requestedAmount} onChange={e=>change('requestedAmount',e.target.value)} type="number" min="1" step="0.01" required disabled={disabled}/></label><label>Kontantinsats, kr<input name="deposit" value={fields.deposit} onChange={e=>change('deposit',e.target.value)} type="number" min="0" step="0.01" required disabled={disabled}/></label></div>
   <label><span>Önskad löptid, månader <span className="optional">valfritt</span></span><input name="term_months" value={fields.termMonths} onChange={e=>change('termMonths',e.target.value)} type="number" min="1" max="120" disabled={disabled}/></label>
   <label>Beskriv behovet<textarea name="note" value={fields.note} onChange={e=>change('note',e.target.value)} rows={3} maxLength={2000} placeholder="Vad vill du finansiera? Lämna inga personnummer eller kreditunderlag här." disabled={disabled}/></label>
   <button type="submit" className="button button-green" disabled={disabled}>{request.pending?'Sparar…':<>Skicka intresseanmälan <ArrowRight size={17}/></>}</button>
  </form>
 </>;
}
