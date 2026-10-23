'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { listStockPurchaseConditionsAction, createPurchaseConditionVersionAction } from '@/lib/data/purchase-condition-actions';
import { formatOre, kronorToOre } from '@/lib/calculations/vehicle-calculation';
import type { Conditions, ConditionKey, ConditionStatus, CreatePurchaseConditionInput, PurchaseCondition as SavedCondition, PurchaseConditionPage } from '@/lib/purchase-condition/types';

export type PurchaseConditionProps={companyId:string;stockItemId:string;userId:string;role:string;demo?:boolean};
const labels:Record<ConditionKey,string>={body:'Kaross',interior:'Interiör',engine:'Motor',transmission:'Växellåda',tyres:'Däck',service:'Servicehistorik'};
const keys=Object.keys(labels) as ConditionKey[];
const statuses:Record<ConditionStatus,string>={unassessed:'Ej bedömt',good:'Utan anmärkning enligt kontrollen',issues:'Anmärkning'};
function blankConditions():Conditions{return Object.fromEntries(keys.map(key=>[key,{status:'unassessed',notes:''}])) as Conditions;}
export function PurchaseCondition(props:PurchaseConditionProps){return <ScopedCondition key={`${props.companyId}:${props.stockItemId}:${props.userId}:${props.role}:${!!props.demo}`} {...props}/>;}
function ScopedCondition(props:PurchaseConditionProps){
  const [opened,setOpened]=useState(false);
  const permitted=['owner','admin','finance'].includes(props.role);
  return <details style={{marginTop:16,minWidth:0}} onToggle={event=>{if(event.currentTarget.open)setOpened(true);}}><summary><strong>Inköps- och skickunderlag</strong></summary>{permitted?opened?<ConditionPanel {...props}/>:null:<p className="muted" style={{paddingTop:12}}>Inköps- och leverantörsuppgifter visas för företagets ägare, administratör och ekonomiansvarig. Kontakta en administratör om du behöver hjälp med underlaget.</p>}</details>;
}
function ConditionPanel({companyId,stockItemId,demo=false}:PurchaseConditionProps){
  const field=useId(),alive=useRef(false),reads=useRef(0),locked=useRef(false),retries=useRef(new Map<string,string>()),heading=useRef<HTMLHeadingElement>(null);
  const [page,setPage]=useState<PurchaseConditionPage|null>(null),[rows,setRows]=useState<SavedCondition[]>([]),[loading,setLoading]=useState(!demo),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  const [supplierKind,setSupplierKind]=useState<'person'|'business'>('business'),[supplierName,setSupplierName]=useState(''),[supplierOrg,setSupplierOrg]=useState(''),[acquiredOn,setAcquiredOn]=useState(''),[reference,setReference]=useState('');
  const [checkedOn,setCheckedOn]=useState(''),[mileage,setMileage]=useState(''),[conditions,setConditions]=useState<Conditions>(blankConditions),[estimateKnown,setEstimateKnown]=useState(false),[estimate,setEstimate]=useState('');
  const [review,setReview]=useState<Omit<CreatePurchaseConditionInput,'requestId'|'reviewAcknowledged'>|null>(null),[ack,setAck]=useState(false);
  function clearPrivate(){reads.current++;setPage(null);setRows([]);setReview(null);setAck(false);setBlocked(true);setLoading(false);setSupplierName('');setSupplierOrg('');setAcquiredOn('');setReference('');setCheckedOn('');setMileage('');setConditions(blankConditions());setEstimateKnown(false);setEstimate('');retries.current.clear();}
  async function load(older=false){
    const request=++reads.current;setLoading(true);
    try{
      const result=await listStockPurchaseConditionsAction({companyId,stockId:stockItemId,...(older&&page?.nextBeforeVersion?{beforeVersion:page.nextBeforeVersion}:{})});
      if(!alive.current||request!==reads.current)return;
      if(!result.ok){clearPrivate();setError(result.message);return;}
      if(result.companyId!==companyId||result.stockId!==stockItemId){clearPrivate();setError('Underlagets företag och lagerbil kunde inte verifieras.');return;}
      setPage(result);setBlocked(false);setRows(current=>older?[...current,...result.versions].filter((row,index,all)=>all.findIndex(other=>other.id===row.id)===index):result.versions);
      setAcquiredOn(current=>current||result.businessDate);setCheckedOn(current=>current||result.businessDate);setMileage(current=>current||String(result.basis.vehicle.mileageKm));
    }catch{if(alive.current&&request===reads.current){clearPrivate();setError('Inköps- och skickunderlaget kunde inte hämtas. Försök igen.');}}
    finally{if(alive.current&&request===reads.current)setLoading(false);}
  }
  useEffect(()=>{alive.current=true;if(!demo)void load();return()=>{alive.current=false;reads.current++;};},[]); // Parent key resets all state when access scope changes.
  useEffect(()=>{if(review)heading.current?.focus();},[review]);
  function updateCondition(key:ConditionKey,patch:Partial<Conditions[ConditionKey]>){setConditions(current=>({...current,[key]:{...current[key],...patch}}));}
  function prepare(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!page||demo||blocked||busy||loading||!page.canCreate||!event.currentTarget.reportValidity())return;
    try{
      if(supplierName.trim().length<2)throw Error('Ange leverantörens namn med minst två tecken.');
      const repairEstimateOre=estimateKnown?kronorToOre(estimate):null;
      if(estimateKnown&&repairEstimateOre===null)throw Error('Ange en reparationsuppskattning i kronor, även 0 om inga kostnader uppskattas.');
      if(repairEstimateOre!==null&&BigInt(repairEstimateOre)>999999999999n)throw Error('Reparationsuppskattningen får vara högst 9 999 999 999,99 kr.');
      const organization=supplierKind==='business'?(supplierOrg.replace(/[\s-]/g,'')||null):null;
      if(organization!==null&&!/^\d{10}$/.test(organization))throw Error('Ange ett organisationsnummer med tio siffror eller lämna fältet tomt.');
      const checked=Object.fromEntries(keys.map(key=>[key,{status:conditions[key].status,notes:conditions[key].notes.trim()}])) as Conditions;
      if(keys.some(key=>checked[key].status==='issues'&&checked[key].notes.length<2))throw Error('Beskriv varje anmärkning med minst två tecken.');
      setReview({companyId,stockId:stockItemId,expectedVersion:page.latestVersion,expectedPurchasePriceOre:page.basis.purchasePriceOre,expectedCalculationVersion:page.basis.calculationVersion,expectedVehicleId:page.basis.vehicle.id,supplierKind,supplierName:supplierName.trim(),supplierOrganisationNumber:organization,acquiredOn,documentReference:reference.trim()||null,checkedOn,mileageKm:Number(mileage),conditions:checked,repairEstimateOre});setAck(false);setError('');setMessage('');
    }catch(e){setError(e instanceof Error?e.message:'Kontrollera underlaget.');}
  }
  async function confirm(){
    if(!review||!ack||demo||blocked||!page?.canCreate||locked.current)return;
    const values={...review,reviewAcknowledged:true},fingerprint=JSON.stringify(values);
    let requestId=retries.current.get(fingerprint);if(!requestId){requestId=crypto.randomUUID();retries.current.set(fingerprint,requestId);}
    locked.current=true;setBusy(true);setError('');
    try{
      const result=await createPurchaseConditionVersionAction({...values,requestId});if(!alive.current)return;
      if(!result.ok){if(result.code==='access_denied'||result.code==='unauthenticated')clearPrivate();else if(result.code==='conflict'){setReview(null);setAck(false);await load();}setError(result.message);return;}
      retries.current.delete(fingerprint);setReview(null);setAck(false);setMessage('Inköps- och skickunderlaget är sparat.');await load();
    }catch{if(alive.current)setError('Sparandet kunde inte bekräftas. Försök igen med samma granskade underlag.');}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  return <section className="purchase-condition-panel" aria-labelledby={`${field}-title`} style={{paddingTop:16,minWidth:0,overflowWrap:'anywhere'}}>
    <h3 id={`${field}-title`}>Inköps- och skickunderlag</h3>
    <p className="muted">Registrera leverantör, inköpsreferens och bilens kontrollerade skick. Varje sparad version behåller uppgifterna från granskningen.</p>
    <p className="muted">Underlaget är internt. Det ändrar inte inköpspris, moms, lagerstatus eller registrerade kostnader och innebär ingen betalning eller extern fordonskontroll.</p>
    {demo?<p className="inline-note">Sparade inköps- och skickunderlag visas i ett inloggat företagskonto.</p>:null}
    {error?<p role="alert">{error}</p>:null}{message?<p role="status">{message}</p>:null}{loading?<p role="status">Hämtar inköps- och skickunderlag…</p>:null}
    {page?<div style={{marginBlock:16}}><strong>{page.basis.vehicle.registration} · {page.basis.vehicle.make} {page.basis.vehicle.model}</strong><p>Modellår {page.basis.vehicle.modelYear} · Registrerad mätarställning {page.basis.vehicle.mileageKm} km<br/>Registrerat inköpspris: <strong>{formatOre(page.basis.purchasePriceOre)}</strong></p></div>:null}
    {page&&!page.canCreate?<p className="inline-note">Bilens lagerstatus tillåter inte ett nytt underlag. Sparade versioner kan granskas och hämtas som PDF.</p>:null}
    {!demo&&page&&!blocked&&page.canCreate&&!review?<form onSubmit={prepare} className="workspace-form" style={{marginTop:18,minWidth:0}}>
      <h4>Inköpsuppgifter</h4>
      <div><label htmlFor={`${field}-supplier-kind`}>Leverantörstyp</label><select id={`${field}-supplier-kind`} value={supplierKind} onChange={event=>{setSupplierKind(event.target.value as 'person'|'business');setSupplierOrg('');}} disabled={busy}><option value="business">Företag</option><option value="person">Privatperson</option></select></div>
      <label htmlFor={`${field}-supplier`}>Leverantörens namn<input id={`${field}-supplier`} value={supplierName} onChange={event=>setSupplierName(event.target.value)} minLength={2} maxLength={160} required disabled={busy} autoComplete="off"/></label>
      {supplierKind==='business'?<label htmlFor={`${field}-org`}>Leverantörens organisationsnummer (valfritt)<input id={`${field}-org`} value={supplierOrg} onChange={event=>setSupplierOrg(event.target.value)} maxLength={24} disabled={busy} autoComplete="off"/></label>:<p className="muted">Registrera leverantörens namn. Personnummer ska inte anges.</p>}
      <label htmlFor={`${field}-acquired`}>Inköpsdatum<input id={`${field}-acquired`} type="date" min="1900-01-01" max={page.businessDate} value={acquiredOn} onChange={event=>setAcquiredOn(event.target.value)} required disabled={busy}/></label>
      <label htmlFor={`${field}-reference`}>Inköpsreferens (valfritt)<input id={`${field}-reference`} value={reference} onChange={event=>setReference(event.target.value)} maxLength={160} disabled={busy}/></label>
      <h4>Skick vid kontrollen</h4>
      <label htmlFor={`${field}-checked`}>Kontrolldatum<input id={`${field}-checked`} type="date" min="1900-01-01" max={page.businessDate} value={checkedOn} onChange={event=>setCheckedOn(event.target.value)} required disabled={busy}/></label>
      <label htmlFor={`${field}-mileage`}>Mätarställning vid kontrollen (km)<input id={`${field}-mileage`} type="number" min={0} max={2000000} step={1} value={mileage} onChange={event=>setMileage(event.target.value)} required disabled={busy}/></label>
      {keys.map(key=><fieldset key={key} style={{border:'1px solid var(--border,#d9e0e6)',borderRadius:10,padding:14,minWidth:0}}><legend>{labels[key]}</legend><div><label htmlFor={`${field}-${key}-status`}>Bedömning · {labels[key]}</label><select id={`${field}-${key}-status`} value={conditions[key].status} onChange={event=>updateCondition(key,{status:event.target.value as ConditionStatus})} disabled={busy}>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><label htmlFor={`${field}-${key}-notes`}>Anteckning · {labels[key]}<textarea id={`${field}-${key}-notes`} value={conditions[key].notes} onChange={event=>updateCondition(key,{notes:event.target.value})} rows={2} maxLength={1000} minLength={conditions[key].status==='issues'?2:undefined} required={conditions[key].status==='issues'} disabled={busy}/></label></fieldset>)}
      <label style={{display:'flex',flexDirection:'row',alignItems:'flex-start',gap:10}}><input type="checkbox" checked={estimateKnown} onChange={event=>setEstimateKnown(event.target.checked)} disabled={busy} style={{width:'auto'}}/><span>Reparationskostnaden har uppskattats</span></label>
      {estimateKnown?<><label htmlFor={`${field}-estimate`}>Uppskattad reparationskostnad (kr)<input id={`${field}-estimate`} inputMode="decimal" value={estimate} onChange={event=>setEstimate(event.target.value)} required maxLength={22} disabled={busy}/></label><p className="muted">Ange 0 om ingen reparationskostnad uppskattas. Uppskattningen registrerar ingen faktisk kostnad.</p></>:<p className="inline-note">Reparationskostnaden är okänd tills en uppskattning anges.</p>}
      <button className="button button-green" disabled={busy||loading}>Granska nytt inköps- och skickunderlag</button>
    </form>:null}
    {review&&page?<section aria-labelledby={`${field}-review`} className="workspace-form surface" style={{padding:18,marginBlock:18,minWidth:0}}><h4 id={`${field}-review`} ref={heading} tabIndex={-1}>Granska inköps- och skickunderlaget</h4><p><strong>{page.basis.vehicle.registration} · {page.basis.vehicle.make} {page.basis.vehicle.model}</strong><br/>Inköpspris: {formatOre(review.expectedPurchasePriceOre)}</p><ReviewFields {...review}/><p className="muted">Manuellt registrerat underlag. Uppgifterna och det registrerade inköpspriset sparas som en ny oföränderlig version. Reparationsuppskattningen ändrar inte bilens kostnader eller moms.</p><label style={{display:'flex',flexDirection:'row',alignItems:'flex-start',gap:10}}><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)} disabled={busy} style={{width:'auto'}}/><span>Jag har granskat leverantören, inköpsuppgifterna, bilens identitet och inköpspris, skickbedömningen och reparationsuppskattningens status.</span></label><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="button button-green" disabled={!ack||busy||loading} onClick={()=>void confirm()}>Bekräfta och spara underlaget</button><button className="button button-outline" disabled={busy} onClick={()=>{setReview(null);setAck(false);setError('');}}>Ändra uppgifter</button></div></section>:null}
    {!demo&&!loading&&page&&!rows.length?<p className="muted">Inga sparade inköps- och skickunderlag.</p>:null}
    {rows.length?<><h4>Sparade versioner</h4><ol style={{paddingLeft:20}}>{rows.map(row=><li key={row.id} style={{marginBlock:20}}><strong>Version {row.version} · {row.basis.vehicle.registration} · {row.basis.vehicle.make} {row.basis.vehicle.model}</strong><p>Inköpspris enligt versionen: {formatOre(row.basis.purchasePriceOre)}<br/>Sparad av {row.actorLabel} · {new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',dateStyle:'short',timeStyle:'short'}).format(new Date(row.createdAt))}</p><ReviewFields {...row}/><a href={`/api/purchase-condition/${stockItemId}/${row.version}/pdf`} download>Hämta inköps- och skickunderlag · version {row.version}</a></li>)}</ol></>:null}
    {!demo?<div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:16}}><button className="button button-outline" disabled={loading||busy} onClick={()=>{setReview(null);setAck(false);setError('');void load();}}>Uppdatera inköps- och skickunderlaget</button>{page?.nextBeforeVersion&&!blocked?<button className="button button-outline" disabled={loading||busy||!!review} onClick={()=>void load(true)}>Visa äldre underlag</button>:null}</div>:null}
  </section>;
}
function ReviewFields({supplierKind,supplierName,supplierOrganisationNumber,acquiredOn,documentReference,checkedOn,mileageKm,conditions,repairEstimateOre}:Pick<CreatePurchaseConditionInput,'supplierKind'|'supplierName'|'supplierOrganisationNumber'|'acquiredOn'|'documentReference'|'checkedOn'|'mileageKm'|'conditions'|'repairEstimateOre'>){
  return <div style={{display:'grid',gap:12}}><p>Leverantör: <strong>{supplierName}</strong> · {supplierKind==='business'?'Företag':'Privatperson'}{supplierOrganisationNumber?<><br/>Organisationsnummer: {supplierOrganisationNumber}</>:null}<br/>Inköpsdatum: {acquiredOn}<br/>Inköpsreferens: {documentReference||'Ej angiven'}</p><p>Kontrolldatum: {checkedOn}<br/>Mätarställning vid kontrollen: {mileageKm.toLocaleString('sv-SE')} km</p><dl style={{display:'grid',gap:10}}>{keys.map(key=><div key={key}><dt style={{fontWeight:600}}>{labels[key]} · {statuses[conditions[key].status]}</dt><dd style={{margin:0,whiteSpace:'pre-wrap'}}>{conditions[key].notes||'Ingen anteckning'}</dd></div>)}</dl><p>Uppskattad reparationskostnad: <strong>{repairEstimateOre===null?'Okänd':formatOre(repairEstimateOre)}</strong></p></div>;
}
