'use client';

import { useEffect, useRef, useState } from 'react';
import { getCustomerEmailDeliveryAction, retryCustomerEmailAction } from '@/lib/data/customer-email-actions';
import { GuestInvitationRenewal } from './guest-invitation-renewal';

type Delivery = Extract<Awaited<ReturnType<typeof getCustomerEmailDeliveryAction>>, { ok: true }>['delivery'];
export type CustomerEmailDeliveryProps = { companyId: string; dealId: string; referenceId: string; kind: 'contract_invitation' | 'offer_invitation' | 'contract_completed'; userId: string; role: string };
const labels: Record<NonNullable<Delivery['status']>, string> = {
  pending: 'Mejlinbjudan väntar på utskick', processing: 'Ett utskicksförsök pågår', accepted: 'Mejltjänsten har tagit emot inbjudan',
  rejected: 'Mejltjänsten avvisade inbjudan', unknown: 'Utskickets utfall behöver kontrolleras', cancelled: 'Mejlinbjudan har stoppats',
};
export function CustomerEmailDelivery(props: CustomerEmailDeliveryProps) {
  return <DeliveryPanel key={`${props.companyId}:${props.dealId}:${props.referenceId}:${props.kind}:${props.userId}:${props.role}`} {...props}/>;
}
function DeliveryPanel({ companyId, dealId, referenceId, kind, userId, role }: CustomerEmailDeliveryProps) {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [review, setReview] = useState(false), [ack, setAck] = useState(false);
  const [renewalBusy, setRenewalBusy] = useState(false);
  const [renewalRefresh, setRenewalRefresh] = useState(0), [expiredInvitation, setExpiredInvitation] = useState(false);
  const alive = useRef(false), generation = useRef(0), lock = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const completion = kind === 'contract_completed';
  const contract = kind !== 'offer_invitation';
  const statusLabels = completion ? { ...labels, pending: 'Mejlet med färdigsignerat avtal väntar på utskick', accepted: 'Mejltjänsten har tagit emot mejlet med färdigsignerat avtal', rejected: 'Mejltjänsten avvisade mejlet med färdigsignerat avtal', cancelled: 'Mejlet med färdigsignerat avtal har stoppats' } : labels;
  const reviewLabel = completion ? 'Granska nytt försök för färdigsignerat avtal' : 'Granska nytt utskicksförsök';
  const allowed = (contract ? ['owner','admin','finance'] : ['owner','admin','sales','finance','viewer']).includes(role);
  const writable = (contract ? ['owner','admin'] : ['owner','admin','sales']).includes(role);
  function valid(value: Delivery) {
    return value.companyId === companyId && value.dealId === dealId && value.referenceId === referenceId && value.kind === kind && value.actorUserId === userId && value.actorRole === role;
  }
  async function refresh() {
    const request = ++generation.current; setLoading(true); setDelivery(null); setError(''); setReview(false); setAck(false); setRenewalRefresh(value => value + 1);
    try {
      const result = await getCustomerEmailDeliveryAction({ companyId, dealId, referenceId, kind });
      if (!alive.current || generation.current !== request) return;
      if (!result.ok) { setError(result.message); return; }
      if (!valid(result.delivery)) { setError('Mejlinbjudan kunde inte verifieras för aktuellt företag, konto och underlag.'); return; }
      setDelivery(result.delivery);
    } catch { if (alive.current && generation.current === request) setError('Mejlstatus kunde inte hämtas. Uppdatera status för att försöka igen.'); }
    finally { if (alive.current && generation.current === request) setLoading(false); }
  }
  useEffect(() => { alive.current = true; if (allowed) void refresh(); else setLoading(false); return () => { alive.current = false; ++generation.current; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);
  const canRetry = writable && !expiredInvitation && delivery?.status === 'pending' && delivery.transport === 'configured';
  async function retry() {
    if (lock.current || renewalBusy || !canRetry || !review || !ack || loading || busy) return;
    lock.current = true; const request = generation.current; setBusy(true); setError(''); setNotice('');
    try {
      const result = await retryCustomerEmailAction({ companyId, dealId, referenceId, kind, acknowledged: true });
      if (!alive.current || generation.current !== request) return;
      setReview(false); setAck(false); setDelivery(null);
      if (!result.ok) { setError(result.message); return; }
      if (!valid(result.delivery)) { setError('Mejlstatus efter försöket kunde inte verifieras för aktuellt företag och underlag. Uppdatera status.'); return; }
      setDelivery(result.delivery); setNotice('Mejlstatus har uppdaterats. Se aktuell status ovan.');
    } catch {
      if (alive.current && generation.current === request) { setDelivery(null); setReview(false); setAck(false); setError('Försökets utfall kunde inte bekräftas. Uppdatera mejlstatus innan du överväger ett nytt försök.'); }
    } finally { lock.current = false; if (alive.current && generation.current === request) setBusy(false); }
  }
  if (!allowed) return null;
  return <section className="contract-delivery-panel" aria-label={completion ? 'Kundens mejl med färdigsignerat avtal' : 'Kundens mejlinbjudan'}>
    <div className="contract-delivery-heading"><h5>{completion ? 'Mejl med färdigsignerat avtal' : contract ? 'Mejlinbjudan till kunden' : 'Offertens mejlinbjudan'}</h5><button className="text-link" type="button" disabled={loading || busy || renewalBusy} onClick={() => void refresh()}>{completion ? 'Uppdatera färdigmejlets status' : 'Uppdatera mejlinbjudans status'}</button></div>
    {loading && <p role="status">{completion ? 'Kontrollerar mejlet med färdigsignerat avtal…' : 'Kontrollerar mejlinbjudan…'}</p>}{error && <p role="alert">{error}</p>}
    {delivery && <><p className="contract-delivery-status">{delivery.status ? statusLabels[delivery.status] : completion ? 'Inget mejl med färdigsignerat avtal är registrerat' : 'Ingen mejlinbjudan är registrerad'}</p><p style={{overflowWrap: 'anywhere'}}>Mottagare: {delivery.recipientEmail}</p>
      {delivery.status === 'accepted' && <p>Mejlet har accepterats för utskick. Leverans till kundens inkorg är ännu inte bekräftad.</p>}
      {delivery.status === 'pending' && <p>{delivery.transport === 'paused' ? `${contract ? 'Avtalsmejl' : 'Offertmejl'} är pausade. ${completion ? 'Mejlet med färdigsignerat avtal' : 'Inbjudan'} har inte bekräftats skickad.` : delivery.transport === 'unconfigured' ? `Mejlinställningarna behöver kontrolleras. ${completion ? 'Mejlet med färdigsignerat avtal' : 'Inbjudan'} har inte bekräftats skickad.` : 'Mejlet väntar. Ett registrerat ärende betyder inte att kunden har fått ett mejl.'}</p>}
      {delivery.status === 'unknown' && <p>Kontakta Trafexa för kontroll hos mejltjänsten innan ett nytt utskick övervägs.</p>}
      <p>{contract ? 'Avtalets underskrifter' : 'Kundens offertsvar'} och mejlets utskicksstatus visas separat. Uppdatering av status skickar inget mejl.</p>
      {canRetry && !review && <button type="button" className="button button-outline" disabled={busy || loading || renewalBusy} onClick={() => { setReview(true); setAck(false); setError(''); setNotice(''); }}>{reviewLabel}</button>}
      {canRetry && review && <section className="customer-email-retry-review" aria-label={completion ? 'Granska nytt mejlförsök för färdigsignerat avtal' : 'Granska nytt mejlförsök'}><h5 ref={heading} tabIndex={-1}>{completion ? 'Kontrollera mottagaren av det färdigsignerade avtalet' : 'Kontrollera mottagaren före nytt försök'}</h5><p>{delivery.recipientEmail}</p><p>{completion ? 'Försöket gäller samma sparade mejl med det färdigsignerade avtalet. Mottagaren och dokumentet ändras inte.' : 'Försöket gäller samma sparade mejlinbjudan. Mottagaren och underlaget ändras inte.'}</p><label><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)}/><span>{completion ? 'Jag har granskat mottagaren och vill försöka skicka det väntande mejlet med färdigsignerat avtal igen.' : 'Jag har granskat mottagaren och vill försöka skicka den väntande mejlinbjudan igen.'}</span></label><div><button className="button button-green" type="button" disabled={!ack || busy || loading || renewalBusy} onClick={() => void retry()}>{busy ? 'Kontrollerar utskicksförsöket…' : 'Försök skicka mejlet igen'}</button><button className="button button-outline" type="button" disabled={busy} onClick={() => { setReview(false); setAck(false); }}>Avbryt utskicksförsök</button></div></section>}
    </>}{notice && <p role="status">{notice}</p>}
    <GuestInvitationRenewal companyId={companyId} dealId={dealId} referenceId={referenceId} kind={kind} userId={userId} role={role} refreshVersion={renewalRefresh} parentBusy={busy || loading} onBusyChange={setRenewalBusy} onRenewed={() => void refresh()} onExpiredChange={setExpiredInvitation}/>
  </section>;
}
