'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { listDealTradeInsAction, createTradeInVersionAction } from '@/lib/data/trade-in-actions';
import { formatOre, kronorToOre } from '@/lib/calculations/vehicle-calculation';
import type { CreateTradeInInput, TradeIn, TradeInPage } from '@/lib/trade-in/types';

export type DealTradeInsProps = { companyId:string; dealId:string; canEdit:boolean; demo?:boolean };
export function DealTradeIns(props:DealTradeInsProps) {
  return <TradeInPanel key={`${props.companyId}:${props.dealId}:${props.canEdit}:${!!props.demo}`} {...props}/>;
}
function TradeInPanel({companyId,dealId,canEdit,demo=false}:DealTradeInsProps) {
  const prefix=useId(), alive=useRef(false), sequence=useRef(0), locked=useRef(false), retries=useRef(new Map<string,string>());
  const heading=useRef<HTMLHeadingElement>(null);
  const [page,setPage]=useState<TradeInPage|null>(null), [rows,setRows]=useState<TradeIn[]>([]);
  const [loading,setLoading]=useState(!demo), [busy,setBusy]=useState(false), [blocked,setBlocked]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  const [registration,setRegistration]=useState(''),[make,setMake]=useState(''),[model,setModel]=useState('');
  const [year,setYear]=useState(''),[mileage,setMileage]=useState(''),[condition,setCondition]=useState(''),[equipment,setEquipment]=useState('');
  const [value,setValue]=useState(''),[debtKnown,setDebtKnown]=useState(false),[debt,setDebt]=useState(''),[lender,setLender]=useState('');
  const [review,setReview]=useState<Omit<CreateTradeInInput,'requestId'|'reviewAcknowledged'>|null>(null),[ack,setAck]=useState(false);
  function clearPrivate(){setPage(null);setRows([]);setReview(null);setAck(false);setBlocked(true);setRegistration('');setMake('');setModel('');setYear('');setMileage('');setCondition('');setEquipment('');setValue('');setDebt('');setLender('');setDebtKnown(false);retries.current.clear();}
  async function load(older=false){
    const token=++sequence.current;setLoading(true);
    try{
      const result=await listDealTradeInsAction({companyId,dealId,...(older&&page?.nextBeforeVersion?{beforeVersion:page.nextBeforeVersion}:{})});
      if(!alive.current||token!==sequence.current)return;
      if(!result.ok){clearPrivate();setError(result.message);return;}
      if(result.companyId!==companyId||result.dealId!==dealId){clearPrivate();setError('Inbytesunderlaget kunde inte verifieras.');return;}
      setBlocked(false);setPage(result);setRows(current=>older?[...current,...result.versions].filter((row,index,all)=>all.findIndex(other=>other.id===row.id)===index):result.versions);
    }catch{if(alive.current&&token===sequence.current){clearPrivate();setError('Underlaget kunde inte hämtas. Försök igen.');}}
    finally{if(alive.current&&token===sequence.current)setLoading(false);}
  }
  useEffect(()=>{alive.current=true;if(!demo)void load();return()=>{alive.current=false;sequence.current++;};},[]); // The keyed panel owns one access scope.
  useEffect(()=>{if(review)heading.current?.focus();},[review]);
  function prepare(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!page||!canEdit||!page.canCreate||demo||blocked||busy||loading||!event.currentTarget.reportValidity())return;
    try{
      const valueOre=kronorToOre(value),debtOre=debtKnown?kronorToOre(debt):null;
      if(valueOre===null||(debtKnown&&debtOre===null))throw Error('Ange värdering och känd skuld i kronor med högst två decimaler.');
      if(BigInt(valueOre)<1n||BigInt(valueOre)>999999999999n||(debtOre!==null&&BigInt(debtOre)>999999999999n))throw Error('Inbytesvärdet måste vara minst 0,01 kr. Beloppen får vara högst 9 999 999 999,99 kr.');
      setReview({companyId,dealId,expectedVersion:page.latestVersion,expectedSalePriceOre:page.salePriceOre,registration:registration.trim().toUpperCase(),make:make.trim(),model:model.trim(),modelYear:Number(year),mileageKm:Number(mileage),conditionNotes:condition.trim(),equipmentNotes:equipment.trim(),valueOre,debtKnown,debtOre,lenderName:debtKnown?(lender.trim()||null):null});setAck(false);setError('');setMessage('');
    }catch(e){setError(e instanceof Error?e.message:'Kontrollera beloppen.');}
  }
  async function confirm(){
    if(!review||!ack||!canEdit||!page?.canCreate||demo||blocked||locked.current)return;
    const values={...review,reviewAcknowledged:true},fingerprint=JSON.stringify(values);
    let requestId=retries.current.get(fingerprint);if(!requestId){requestId=crypto.randomUUID();retries.current.set(fingerprint,requestId);}
    locked.current=true;setBusy(true);setError('');
    try{
      const result=await createTradeInVersionAction({...values,requestId});if(!alive.current)return;
      if(!result.ok){if(result.code==='access_denied'||result.code==='unauthenticated')clearPrivate();else if(result.code==='conflict'){setReview(null);setAck(false);await load();}setError(result.message);return;}
      retries.current.delete(fingerprint);setReview(null);setAck(false);setMessage('Inbytesunderlaget är sparat.');await load();
    }catch{if(alive.current)setError('Sparandet kunde inte bekräftas. Försök igen med samma granskade underlag.');}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  const fieldStyle={minWidth:0,width:'100%'} as const;
  const maximumModelYear=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Stockholm',year:'numeric'}).format(new Date()))+1;
  return <section aria-labelledby={`${prefix}-title`} style={{minWidth:0,overflowWrap:'anywhere',paddingBlock:16}}>
    <h3 id={`${prefix}-title`}>Inbytesunderlag</h3>
    <p className="muted">Intern värdering av kundens inbytesbil. Uppgifterna registreras manuellt och skulden måste kontrolleras separat. Underlaget är inget köpeavtal eller besked om genomförd betalning.</p>
    {demo?<p className="inline-note">Inbytesunderlag sparas i ett inloggat företagskonto.</p>:null}
    {error?<p role="alert">{error}</p>:null}{message?<p role="status">{message}</p>:null}{loading?<p role="status">Hämtar inbytesunderlag…</p>:null}
    {page?<p>Kund: <strong>{page.customerName}</strong> · Affärens försäljningspris: <strong>{formatOre(page.salePriceOre)}</strong></p>:null}
    {page&&!page.canCreate?<p className="inline-note">Affären eller offertens status tillåter inte ett nytt inbytesunderlag. Sparade versioner kan granskas nedan.</p>:null}
    {!demo&&page&&canEdit&&page.canCreate&&!blocked&&!review?<form onSubmit={prepare} style={{display:'grid',gap:14,minWidth:0}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:14}}>
        <label>Registreringsnummer<input style={fieldStyle} value={registration} onChange={e=>setRegistration(e.target.value)} required minLength={2} maxLength={15} disabled={busy}/></label>
        <label>Märke<input style={fieldStyle} value={make} onChange={e=>setMake(e.target.value)} required minLength={2} maxLength={160} disabled={busy}/></label>
        <label>Modell<input style={fieldStyle} value={model} onChange={e=>setModel(e.target.value)} required minLength={2} maxLength={160} disabled={busy}/></label>
        <label>Modellår<input style={fieldStyle} type="number" min={1900} max={maximumModelYear} step={1} value={year} onChange={e=>setYear(e.target.value)} required disabled={busy}/></label>
        <label>Mätarställning (km)<input style={fieldStyle} type="number" min={0} max={2000000} step={1} value={mileage} onChange={e=>setMileage(e.target.value)} required disabled={busy}/></label>
        <label>Inbytesvärde (kr)<input style={fieldStyle} inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} required maxLength={22} disabled={busy}/></label>
      </div>
      <label>Skick och kända skador<textarea style={fieldStyle} rows={3} maxLength={2000} value={condition} onChange={e=>setCondition(e.target.value)} disabled={busy}/></label>
      <label>Utrustning och övriga uppgifter<textarea style={fieldStyle} rows={3} maxLength={2000} value={equipment} onChange={e=>setEquipment(e.target.value)} disabled={busy}/></label>
      <label style={{display:'flex',alignItems:'flex-start',gap:10}}><input type="checkbox" checked={debtKnown} onChange={e=>setDebtKnown(e.target.checked)} disabled={busy}/>Skuldens belopp är känt enligt underlaget</label>
      {debtKnown?<div style={{display:'grid',gap:14}}><label>Kvarvarande skuld (kr)<input style={fieldStyle} inputMode="decimal" value={debt} onChange={e=>setDebt(e.target.value)} required maxLength={22} disabled={busy}/></label><p className="muted">Ange 0 om bilen är skuldfri enligt de uppgifter du har granskat.</p><label>Kreditgivare (valfritt)<input style={fieldStyle} value={lender} onChange={e=>setLender(e.target.value)} maxLength={160} disabled={busy}/></label></div>:<p className="inline-note">Skulden är okänd. Nettoinbyte och mellanskillnad kan därför inte beräknas.</p>}
      <button className="button button-green" disabled={busy||loading}>Granska nytt inbytesunderlag</button>
    </form>:null}
    {review?<section aria-labelledby={`${prefix}-review`} className="surface" style={{padding:18,minWidth:0}}><h4 id={`${prefix}-review`} tabIndex={-1} ref={heading}>Granska inbytesunderlaget</h4><p><strong>{review.registration} · {review.make} {review.model}</strong><br/>Modellår {review.modelYear} · {review.mileageKm} km</p><p style={{whiteSpace:'pre-wrap'}}>Skick: {review.conditionNotes||'Ej angivet'}<br/>Utrustning: {review.equipmentNotes||'Ej angiven'}</p><p>Kreditgivare: {review.lenderName||'Ej angiven'}</p><Calculation sale={review.expectedSalePriceOre} value={review.valueOre} debt={review.debtOre}/><p className="muted">Manuellt registrerade uppgifter. Försäljningspriset hämtas från affären. Skulden är inte verifierad hos kreditgivaren. Sparandet ändrar inte lagret, offerten eller betalningar.</p><label style={{display:'flex',gap:10,alignItems:'flex-start'}}><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} disabled={busy}/>Jag har granskat biluppgifterna, värderingen och skuldens status.</label><div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:16}}><button className="button button-green" disabled={!ack||busy||loading} onClick={()=>void confirm()}>Bekräfta och spara</button><button className="button button-outline" disabled={busy} onClick={()=>{setReview(null);setAck(false);setError('');}}>Ändra uppgifter</button></div></section>:null}
    {!loading&&!demo&&page&&!rows.length?<p className="muted">Inga sparade inbytesunderlag.</p>:null}
    {rows.length?<><h4>Sparade versioner</h4><ol style={{paddingLeft:20}}>{rows.map(row=><li key={row.id} style={{marginBlock:18}}><strong>Version {row.version} · {row.registration} · {row.make} {row.model}</strong><p>Modellår {row.modelYear} · {row.mileageKm} km · {row.actorLabel}<br/>Sparad {new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',dateStyle:'short',timeStyle:'short'}).format(new Date(row.createdAt))}</p><p style={{whiteSpace:'pre-wrap'}}>Skick: {row.conditionNotes||'Ej angivet'}<br/>Utrustning: {row.equipmentNotes||'Ej angiven'}</p><p>Kreditgivare: {row.lenderName||'Ej angiven'}</p><Calculation sale={row.salePriceOre} value={row.valueOre} debt={row.debtOre}/></li>)}</ol></>:null}
    {!demo?<div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="button button-outline" disabled={loading||busy} onClick={()=>{setReview(null);setAck(false);setError('');void load();}}>Uppdatera inbytesunderlaget</button>{page?.nextBeforeVersion&&!blocked?<button className="button button-outline" disabled={loading||busy} onClick={()=>void load(true)}>Visa äldre versioner</button>:null}</div>:null}
  </section>;
}
function Calculation({sale,value,debt}:{sale:string;value:string;debt:string|null}){
  const net=debt===null?null:BigInt(value)-BigInt(debt),amount=net===null?null:BigInt(sale)-net;
  return <dl style={{display:'grid',gap:8,marginBlock:18}}><div><dt>Försäljningspris enligt underlaget</dt><dd>{formatOre(sale)}</dd></div><div><dt>Inbytesvärde</dt><dd>{formatOre(value)}</dd></div><div><dt>Kvarvarande skuld enligt underlaget</dt><dd>{debt===null?'Okänd':formatOre(debt)}</dd></div><div><dt>Nettoinbyte</dt><dd>{net===null?'Kan inte beräknas':formatOre(net.toString())}</dd></div><div><dt>{amount!==null&&amount<0n?'Att betala till kunden enligt underlaget':'Att betala av kunden enligt underlaget'}</dt><dd><strong>{amount===null?'Kan inte beräknas':formatOre((amount<0n?-amount:amount).toString())}</strong></dd></div></dl>;
}
