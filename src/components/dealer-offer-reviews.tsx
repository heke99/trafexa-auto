'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { listDealOfferReviewsAction, publishOfferReviewAction, withdrawOfferReviewAction } from '@/lib/data/offer-review-actions';
import { CustomerEmailDelivery } from './customer-email-delivery';
import type { OfferReview, DealerReviewPage } from '@/lib/offer-review/types';

const statuses = { pending: 'Väntar på kundens svar', accepted: 'Accepterad', declined: 'Avböjd', withdrawn: 'Återkallad', superseded: 'Ersatt av ny version', expired: 'Giltighetstiden har gått ut', unavailable: 'Inte tillgänglig' };
export type DealerOfferReviewsProps = { companyId: string; dealId: string; canEdit: boolean; userId?: string; role?: string; demo?: boolean };
export function DealerOfferReviews(props: DealerOfferReviewsProps) { return <DealerReviewPanel key={`${props.companyId}/${props.userId}/${props.role}/${props.dealId}/${props.canEdit}/${props.demo}`} {...props} />; }
function DealerReviewPanel({ companyId, dealId, canEdit, userId, role, demo = false }: DealerOfferReviewsProps) {
  const label = useId();
  const [offers, setOffers] = useState<NonNullable<DealerReviewPage['latestOffer']>[]>([]), [reviews, setReviews] = useState<OfferReview[]>([]);
  const [loading, setLoading] = useState(!demo), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState<{ kind: 'publish'; offer: NonNullable<DealerReviewPage['latestOffer']> } | { kind: 'withdraw'; review: OfferReview } | null>(null);
  const alive = useRef(true), operation = useRef(0), retry = useRef<{ payload: string; requestId: string } | null>(null);
  useEffect(() => { alive.current = true; if (!demo) void load(); return () => { alive.current = false; operation.current++; }; }, []); // Keyed by full scope.
  function fail(message: string, code?: string) { setError(message); if (code === 'access_denied' || code === 'unauthenticated') { setDenied(true); setOffers([]); setReviews([]); setConfirmation(null); setReason(''); retry.current = null; } }
  async function load() {
    const generation = ++operation.current; setLoading(true); setError('');
    try {
      const reviewList = await listDealOfferReviewsAction({ companyId, dealId });
      if (!alive.current || generation !== operation.current) return;
      if (!reviewList.ok) { fail(reviewList.message, reviewList.code); return; }
      setOffers(reviewList.latestOffer ? [reviewList.latestOffer] : []); setReviews(reviewList.reviews); setDenied(false);
    } catch { if (alive.current && generation === operation.current) setError('Kundgranskningen kunde inte hämtas. Försök igen.'); }
    finally { if (alive.current && generation === operation.current) setLoading(false); }
  }
  async function submit() {
    if (!confirmation || busy || denied || demo || !canEdit) return;
    const current = confirmation;
    const payload = JSON.stringify(current.kind === 'publish' ? [companyId, dealId, current.offer.offerId] : [companyId, dealId, current.review.id, current.review.version, reason.trim()]);
    if (retry.current?.payload !== payload) retry.current = { payload, requestId: crypto.randomUUID() };
    const requestId = retry.current.requestId, generation = ++operation.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = current.kind === 'publish' ? await publishOfferReviewAction({ companyId, dealId, offerId: current.offer.offerId, requestId }) : await withdrawOfferReviewAction({ companyId, dealId, reviewId: current.review.id, expectedVersion: current.review.version, reason: reason.trim(), requestId });
      if (!alive.current || generation !== operation.current) return;
      if (!result.ok) { fail(result.message, result.code); return; }
      retry.current = null; setConfirmation(null); setReason(''); setMessage(current.kind === 'publish' ? 'Offertversionen är tillgänglig för kunden. Kontrollera mejlinbjudans status nedan.' : 'Kundgranskningen är återkallad.');
      await load();
    } catch { if (alive.current && generation === operation.current) setError('Ändringen kunde inte bekräftas. Försök igen med samma granskade underlag.'); }
    finally { if (alive.current) setBusy(false); }
  }
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const latest = offers[0], expired = !!latest && latest.validUntil < today, alreadyPublished = latest && reviews.some(review => review.offerId === latest.offerId);
  return <section aria-labelledby={`${label}-title`} style={{ marginTop: 24, overflowWrap: 'anywhere', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
    <h3 id={`${label}-title`}>Kundens offertgranskning</h3>
    <p className="muted">Gör en sparad offertversion tillgänglig via en personlig mejllänk. Kunden granskar och godkänner utan konto eller lösenord.</p>
    {demo ? <p>Demoläge · kundgranskning visas i ditt företagskonto.</p> : <>
      {loading ? <p role="status">Hämtar kundgranskningar…</p> : null}
      {!denied && !loading && !offers.length ? <p>Spara en offertversion för att tillgängliggöra den för kunden.</p> : null}
      {!denied && canEdit && latest && !alreadyPublished ? <button type="button" className="button button-green" disabled={busy || loading || !latest.recipientEmail || expired || latest.vatScheme === 'unknown'} onClick={() => { setConfirmation({ kind: 'publish', offer: latest }); setError(''); }}>Granska innan tillgängliggörande</button> : null}
      {!denied && latest && !latest.recipientEmail ? <p>Den sparade offertversionen saknar kundens e-postadress. Skapa en ny version med rätt kunduppgifter.</p> : null}
      {!denied && expired ? <p>Offertens giltighetstid har gått ut. Skapa en ny offertversion.</p> : null}
      {!denied && latest?.vatScheme === 'unknown' ? <p>Momsmodellen behöver klassificeras och en ny offertversion sparas före kundgranskning.</p> : null}
      {!denied && reviews.length ? <ul style={{ paddingLeft: 20 }}>{reviews.map(review => <li key={review.id} style={{ marginBottom: 12 }}><strong>Version {review.offerVersion} · {statuses[review.status]}</strong><br />{review.recipientEmail}{review.responderName ? <p>Svar från {review.responderName}{review.decidedAt ? ` · ${new Date(review.decidedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}` : ''}</p> : null}{review.reason ? <p>Anledning: {review.reason}</p> : null}{userId && role ? <CustomerEmailDelivery companyId={companyId} dealId={dealId} referenceId={review.id} kind="offer_invitation" userId={userId} role={role}/>:null}{canEdit && review.status === 'pending' ? <button type="button" className="button button-outline button-small" disabled={busy || loading} onClick={() => { setConfirmation({ kind: 'withdraw', review }); setReason(''); setError(''); }}>Återkalla kundgranskning</button> : null}</li>)}</ul> : null}
      {!denied && reviews.length ? <p>Kundens personliga länk skickas via mejl. Kontrollera mejlinbjudans status vid offertversionen.</p> : null}
      {!canEdit && !denied ? <p className="muted">Din roll har läsbehörighet för kundens svar.</p> : null}
      {confirmation && !denied ? <section aria-label="Granska kundgranskningen" className="workspace-form" style={{ marginTop: 16 }}><h4>{confirmation.kind === 'publish' ? 'Bekräfta offertversion och mottagare' : 'Bekräfta återkallelse'}</h4>
        {confirmation.kind === 'publish' ? <><p>Version {confirmation.offer.offerVersion} · Giltig till {confirmation.offer.validUntil}<br />Mottagare: <strong>{confirmation.offer.recipientEmail}</strong></p><p>Kundens personliga mejllänk ger tillgång till just denna offertversion. Inget konto eller lösenord behövs. Kontrollera utskicksstatus efter tillgängliggörandet.</p></> : <><p>Version {confirmation.review.offerVersion} · {confirmation.review.recipientEmail}</p><label htmlFor={`${label}-reason`}>Anledning till återkallelsen<input id={`${label}-reason`} value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label></>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button type="button" className="button button-green" disabled={busy || (confirmation.kind === 'withdraw' && reason.trim().length < 2)} onClick={() => void submit()}>{busy ? 'Arbetar…' : confirmation.kind === 'publish' ? 'Bekräfta tillgängliggörande' : 'Bekräfta återkallelse'}</button><button type="button" className="button button-outline" disabled={busy} onClick={() => setConfirmation(null)}>Avbryt</button></div>
      </section> : null}
      <button type="button" className="button button-outline button-small" disabled={busy || loading} onClick={() => { setConfirmation(null); void load(); }}>Uppdatera kundgranskningar</button>
    </>}
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}
  </section>;
}
