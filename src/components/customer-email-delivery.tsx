'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getCustomerEmailDeliveryAction, retryCustomerEmailAction } from '@/lib/data/customer-email-actions';

const CustomerDocumentRenewal=dynamic(()=>import('./customer-document-renewal').then(module=>module.CustomerDocumentRenewal),{loading:()=> <p role="status">Läser in dokumentlänkens status…</p>});

type Delivery = Extract<Awaited<ReturnType<typeof getCustomerEmailDeliveryAction>>, { ok: true }>['delivery'];
export type CustomerEmailDeliveryProps = { companyId: string; dealId: string; referenceId: string; kind: 'contract_invitation' | 'offer_invitation' | 'contract_completed'; userId: string; role: string };
export function CustomerEmailDelivery(props: CustomerEmailDeliveryProps) {
  return <DeliveryPanel key={`${props.companyId}:${props.dealId}:${props.referenceId}:${props.kind}:${props.userId}:${props.role}`} {...props}/>;
}
function DeliveryPanel({ companyId, dealId, referenceId, kind, userId, role }: CustomerEmailDeliveryProps) {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [review, setReview] = useState(false), [ack, setAck] = useState(false);
  const [showLink,setShowLink]=useState(false),[renewalBusy,setRenewalBusy]=useState(false),[denied,setDenied]=useState(false);
  const renewalBusyRef=useRef(false),deniedRef=useRef(false);
  const handleRenewalBusy=useCallback((blocked:boolean)=>{renewalBusyRef.current=blocked;setRenewalBusy(blocked);},[]);
  const alive = useRef(false), generation = useRef(0), lock = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const completion = kind === 'contract_completed';
  const contract = kind !== 'offer_invitation';
  const reviewLabel = completion ? 'Granska nytt försök för färdigsignerat avtal' : 'Granska nytt utskicksförsök';
  const allowed = (contract ? ['owner','admin','finance'] : ['owner','admin','sales','finance','viewer']).includes(role);
  const writable = (contract ? ['owner','admin'] : ['owner','admin','sales']).includes(role);
  function valid(value: Delivery) {
    return value.companyId === companyId && value.dealId === dealId && value.referenceId === referenceId && value.kind === kind && value.actorUserId === userId && value.actorRole === role;
  }
  function deny(message:string){++generation.current;deniedRef.current=true;setDenied(true);setDelivery(null);setReview(false);setAck(false);setShowLink(false);setNotice('');setLoading(false);setBusy(false);handleRenewalBusy(false);setError(message);}
  async function refresh() {
    if(renewalBusyRef.current||lock.current||deniedRef.current)return;
    const request = ++generation.current; setLoading(true); setDelivery(null); setError(''); setReview(false); setAck(false);
    try {
      const result = await getCustomerEmailDeliveryAction({ companyId, dealId, referenceId, kind });
      if (!alive.current || generation.current !== request) return;
      if (!result.ok) { if(result.code==='access_denied')deny(result.message);else setError(result.message); return; }
      if (!valid(result.delivery)) { deny('Mejlinbjudan kunde inte verifieras för aktuellt företag, konto och underlag.'); return; }
      setDelivery(result.delivery);
    } catch { if (alive.current && generation.current === request) setError('Mejlstatus kunde inte hämtas. Uppdatera status för att försöka igen.'); }
    finally { if (alive.current && generation.current === request) setLoading(false); }
  }
  useEffect(() => { alive.current = true; if (allowed) void refresh(); else setLoading(false); return () => { alive.current = false; ++generation.current; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);
  const canRetry = writable && !denied && delivery?.status === 'pending' && delivery.transport === 'configured';
  async function retry() {
    if (lock.current || renewalBusyRef.current || deniedRef.current || !canRetry || !review || !ack || loading || busy) return;
    lock.current = true; const request = generation.current; setBusy(true); setError(''); setNotice('');
    try {
      const result = await retryCustomerEmailAction({ companyId, dealId, referenceId, kind, acknowledged: true });
      if (!alive.current || generation.current !== request) return;
      setReview(false); setAck(false); setDelivery(null);
      if (!result.ok) { if(result.code==='access_denied')deny(result.message);else setError(result.message); return; }
      if (!valid(result.delivery)) { deny('Mejlstatus efter försöket kunde inte verifieras för aktuellt företag och underlag. Uppdatera status.'); return; }
      setDelivery(result.delivery); setNotice('Mejlstatus har uppdaterats. Se aktuell status ovan.');
    } catch {
      if (alive.current && generation.current === request) { setDelivery(null); setReview(false); setAck(false); setError('Försökets utfall kunde inte bekräftas. Uppdatera mejlstatus innan du överväger ett nytt försök.'); }
    } finally { lock.current = false; if (alive.current && generation.current === request) setBusy(false); }
  }
  if (!allowed) return null;
  const compactStatus=delivery?.status?({pending:'Väntar på utskick',processing:'Skickar…',accepted:'Skickat',rejected:'Utskicket avvisades',unknown:'Kontroll krävs',cancelled:'Utskicket stoppat'} as const)[delivery.status]:completion?'Inget färdigmejl skickat':'Ingen inbjudan skickad';
  return <section className="contract-delivery-panel contract-delivery-compact" aria-label={completion ? 'Kundens mejl med färdigsignerat avtal' : 'Kundens mejlinbjudan'}>
    <div className="contract-delivery-heading"><div><h5>{completion?'Färdigt avtal':contract?'Avtalsutskick':'Offertutskick'}</h5>{delivery?<p className="contract-delivery-status">{compactStatus}</p>:null}</div><button className="text-link" type="button" aria-label={completion?'Uppdatera färdigmejlets status':'Uppdatera mejlinbjudans status'} disabled={loading || busy || renewalBusy || denied} onClick={() => void refresh()}>Uppdatera</button></div>
    {loading?<p role="status">Kontrollerar utskicket…</p>:null}{error?<p role="alert">{error}</p>:null}
    {delivery?<><p className="contract-delivery-recipient">{delivery.recipientEmail}</p>
      {delivery.status==='pending'&&delivery.transport!=='configured'?<p>Mejlet väntar. Kontakta Trafexa för att aktivera utskicket.</p>:null}
      {delivery.status==='unknown'?<p>Utfallet behöver kontrolleras hos Trafexa innan ett nytt utskick görs.</p>:null}
      {canRetry && !review ? <button type="button" className="button button-outline" disabled={busy || loading || renewalBusy || denied} onClick={() => { if(renewalBusyRef.current||deniedRef.current)return;setReview(true); setAck(false); setError(''); setNotice(''); }}>{reviewLabel}</button>:null}
      {canRetry && review ? <section className="customer-email-retry-review" aria-label={completion ? 'Granska nytt mejlförsök för färdigsignerat avtal' : 'Granska nytt mejlförsök'}><h6 ref={heading} tabIndex={-1}>{completion?'Kontrollera mottagaren av det färdigsignerade avtalet':'Kontrollera mottagaren före nytt försök'}</h6><p>{completion ? 'Försöket gäller samma sparade mejl med det färdigsignerade avtalet. Mottagaren och dokumentet ändras inte.' : 'Försöket gäller samma sparade mejlinbjudan. Mottagaren och underlaget ändras inte.'}</p><label><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)}/><span>{completion ? 'Jag har granskat mottagaren och vill försöka skicka det väntande mejlet med färdigsignerat avtal igen.' : 'Jag har granskat mottagaren och vill försöka skicka den väntande mejlinbjudan igen.'}</span></label><div><button className="button button-green" type="button" disabled={!ack || busy || loading || renewalBusy || denied} onClick={() => void retry()}>{busy ? 'Kontrollerar utskicksförsöket…' : 'Försök skicka mejlet igen'}</button><button className="button button-outline" type="button" disabled={busy} onClick={() => { setReview(false); setAck(false); }}>Avbryt utskicksförsök</button></div></section>:null}
    </>:null}{notice?<p role="status">{notice}</p>:null}
    {!denied?<details className="contract-delivery-details"><summary onClick={event=>{if(renewalBusyRef.current||lock.current)event.preventDefault();}}>Leverans och dokumentlänk</summary>
      {delivery?.status==='accepted'?<p>Mejltjänsten har accepterat utskicket. Leverans till inkorgen är inte bekräftad.</p>:null}
      <p>Underskrift och mejlleverans följs separat. Att uppdatera status skickar inget nytt mejl.</p>
      <button type="button" className="button button-outline" disabled={loading||busy||renewalBusy} onClick={()=>{if(renewalBusyRef.current||lock.current||deniedRef.current)return;setShowLink(value=>!value);}}>{showLink?'Dölj dokumentlänkens status':'Visa dokumentlänkens status'}</button>{showLink?<CustomerDocumentRenewal companyId={companyId} dealId={dealId} referenceId={referenceId} kind={kind} userId={userId} role={role} disabled={busy||loading||review} onBusyChange={handleRenewalBusy} onDenied={deny} onRenewed={()=>void refresh()}/>:null}
    </details>:null}
  </section>;
}
