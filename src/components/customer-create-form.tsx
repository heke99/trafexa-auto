'use client';

import {useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {createCustomerRequestAction,type CustomerCreateInput} from '@/lib/data/create-record-actions';
import type {WorkspaceSnapshot} from '@/lib/data/workspace';
import {normalizeCreateText,useCreateRequest} from './use-create-request';

type Props={snapshot:WorkspaceSnapshot;companyId:string;demo?:boolean};
const initial={name:'',kind:'person' as 'person'|'business',email:'',phone:'',address:'',notes:''};
export function CustomerCreateForm(props:Props){
 const role=props.snapshot.membership?.role??'viewer';
 if(props.companyId!==props.snapshot.organization?.id||!['owner','admin','sales'].includes(role))return <p role="status">Du har inte behörighet att lägga till kunder i det aktiva företaget.</p>;
 return <ScopedCustomerForm key={`${props.companyId}:${props.snapshot.user.id}:${role}:${!!props.demo}`} {...props}/>;
}
function ScopedCustomerForm({snapshot,companyId,demo=false}:Props){
 const [fields,setFields]=useState(initial);
 const request=useCreateRequest<Omit<CustomerCreateInput,'requestId'>>({companyId,actorId:snapshot.user.id,kind:'customer',action:createCustomerRequestAction,onSuccess:()=>setFields(initial),onDenied:()=>setFields(initial)});
 const disabled=demo||request.pending||request.denied||request.conflicted;
 const change=(key:keyof typeof initial,value:string)=>{request.edit();setFields(current=>({...current,[key]:value}));};
 if(request.denied)return <p role="alert">{request.state.message}</p>;
 return <form method="post" className="workspace-form" aria-label="Lägg till kund" onSubmit={event=>{event.preventDefault();if(disabled)return;void request.submit({companyId,name:normalizeCreateText(fields.name),kind:fields.kind,email:normalizeCreateText(fields.email).toLowerCase(),phone:normalizeCreateText(fields.phone),address:normalizeCreateText(fields.address),notes:normalizeCreateText(fields.notes)});}}>
  <input type="hidden" name="expected_company_id" value={companyId}/>
  {request.state.message?<p role={request.state.status==='success'?'status':'alert'}>{request.state.message}</p>:null}
  {request.state.status==='unknown'?<button type="button" className="button button-outline" onClick={request.retry}>Kontrollera samma begäran</button>:null}
  {demo?<p className="form-privacy">Demonstration i läsläge. Ingen kund registreras.</p>:null}
  <label>Namn / företagsnamn<input name="name" value={fields.name} onChange={e=>change('name',e.target.value)} disabled={disabled} required minLength={2} autoFocus maxLength={160} autoComplete="name"/></label>
  <label>Kundtyp<select name="kind" value={fields.kind} onChange={e=>change('kind',e.target.value)} disabled={disabled}><option value="person">Privatperson</option><option value="business">Företag</option></select></label>
  <div className="field-pair"><label>Mejladress<input type="email" name="email" value={fields.email} onChange={e=>change('email',e.target.value)} disabled={disabled} maxLength={254} autoComplete="email"/></label><label>Telefon<input type="tel" name="phone" value={fields.phone} onChange={e=>change('phone',e.target.value)} disabled={disabled} maxLength={60} autoComplete="tel"/></label></div>
  <label>Adress<input name="address" value={fields.address} onChange={e=>change('address',e.target.value)} disabled={disabled} maxLength={500} autoComplete="street-address"/></label>
  <label>Intern anteckning<textarea name="notes" value={fields.notes} onChange={e=>change('notes',e.target.value)} disabled={disabled} rows={3} maxLength={2000}/></label>
  <p className="form-privacy">Lämna inte känsliga personuppgifter eller kreditunderlag i en intern anteckning.</p>
  <button type="submit" className="button button-green" disabled={disabled}>{request.pending?'Sparar…':<>Lägg till kund <ArrowRight size={17}/></>}</button>
 </form>;
}
