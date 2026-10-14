'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { listMyOfferReviewsAction, respondOfferReviewAction } from '@/lib/data/offer-review-actions';
import { formatOre } from '@/lib/calculations/vehicle-calculation';
import type { CustomerOfferReview, RespondOfferReviewInput } from '@/lib/offer-review/types';

const statuses = { pending: 'Väntar på ditt svar', accepted: 'Accepterad', declined: 'Avböjd', withdrawn: 'Återkallad av handlaren', superseded: 'Ersatt av ny version', expired: 'Giltighetstiden har gått ut', unavailable: 'Inte tillgänglig för svar' };
function money(value: string) { const amount = BigInt(value); return `${(amount / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${(amount % BigInt(100)).toString().padStart(2, '0')} kr`; }
export function CustomerOfferReviews({ userId }: { userId: string }) { return <CustomerReviewList key={userId} />; }
function CustomerReviewList() {
  const [reviews, setReviews] = useState<CustomerOfferReview[]>([]), [pageKey, setPageKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [decision, setDecision] = useState<Omit<RespondOfferReviewInput, 'requestId'> | null>(null);
  const alive = useRef(true), generation = useRef(0), retry = useRef<{ payload: string; requestId: string } | null>(null);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; generation.current++; }; }, []);
  function denied(code: string) { if (code === 'unauthenticated' || code === 'access_denied') { setReviews([]); setPageKey(null); setDecision(null); retry.current = null; } }
  async function load(older = false) {
    const request = ++generation.current; setLoading(true); setError('');
    try {
      const result = await listMyOfferReviewsAction(older && pageKey ? { pageKey } : {});
      if (!alive.current || request !== generation.current) return;
      if (!result.ok) { denied(result.code); setError(result.message); return; }
      setReviews(current => older ? [...current, ...result.reviews].filter((review, index, all) => all.findIndex(item => item.id === review.id) === index) : result.reviews); setPageKey(result.nextPageKey);
    } catch { if (alive.current && request === generation.current) setError('Offerterna kunde inte hämtas. Försök igen.'); }
    finally { if (alive.current && request === generation.current) setLoading(false); }
  }
  async function submit() {
    if (!decision || busy) return;
    const payload = JSON.stringify(decision);
    if (retry.current?.payload !== payload) retry.current = { payload, requestId: crypto.randomUUID() };
    const request = ++generation.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await respondOfferReviewAction({ ...decision, requestId: retry.current.requestId });
      if (!alive.current || request !== generation.current) return;
      if (!result.ok) { denied(result.code); setError(result.message); return; }
      setDecision(null); retry.current = null; setMessage('Ditt svar är sparat.'); await load();
    } catch { if (alive.current && request === generation.current) setError('Svaret kunde inte bekräftas. Försök igen med samma granskade svar.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section aria-label="Mina offerter" style={{ overflowWrap: 'anywhere', display: 'flex', flexDirection: 'column', gap: 12 }}>
    <p>Här ser du offertversioner som en handlare har tillgängliggjort för din verifierade e-postadress.</p>
    <p className="muted">Ditt svar gäller den visade offerten och villkoren. Köpeavtal och leverans hanteras separat med handlaren.</p>
    {loading ? <p role="status">Hämtar dina offerter…</p> : null}
    {!loading && !reviews.length && !error ? <p>Du har inga tillgängliga offerter ännu. Be handlaren kontrollera e-postadressen i den sparade offertversionen.</p> : null}
    {reviews.map(review => <CustomerReviewCard key={review.id} review={review} busy={busy || loading || !!decision} onReview={input => { setDecision(input); setError(''); }} />)}
    {decision ? <section aria-label="Bekräfta ditt offertsvar" className="workspace-form" style={{ marginTop: 20 }}><h3>Granska ditt svar</h3><p>Du vill <strong>{decision.decision === 'accepted' ? 'acceptera' : 'avböja'}</strong> offertversion {reviews.find(review => review.id === decision.reviewId)?.offerVersion} som <strong>{decision.responderName}</strong>.</p>{decision.reason ? <p>Anledning: {decision.reason}</p> : null}<p>Svaret sparas tillsammans med offertversionen och kan inte ändras här.</p><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button type="button" className="button button-green" disabled={busy} onClick={() => void submit()}>{busy ? 'Sparar…' : decision.decision === 'accepted' ? 'Bekräfta accept' : 'Bekräfta avböjande'}</button><button type="button" className="button button-outline" disabled={busy} onClick={() => setDecision(null)}>Tillbaka och ändra</button></div></section> : null}
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}><button type="button" className="button button-outline" disabled={busy || loading} onClick={() => { setDecision(null); void load(); }}>Uppdatera offerter</button>{pageKey ? <button type="button" className="button button-outline" disabled={busy || loading || !!decision} onClick={() => void load(true)}>Visa fler offerter</button> : null}</div>
  </section>;
}
function CustomerReviewCard({ review, busy, onReview }: { review: CustomerOfferReview; busy: boolean; onReview: (input: Omit<RespondOfferReviewInput, 'requestId'>) => void }) {
  const field = useId(), snapshot = review.snapshot;
  const [name, setName] = useState(''), [acknowledged, setAcknowledged] = useState(false), [reason, setReason] = useState('');
  const fuel = { petrol: 'Bensin', diesel: 'Diesel', electric: 'El', hybrid: 'Hybrid', other: 'Övrigt' };
  function prepare(decision: 'accepted' | 'declined') { if (!acknowledged || name.trim().length < 2 || (decision === 'declined' && reason.trim().length < 2) || busy) return; onReview({ reviewId: review.id, expectedVersion: review.version, decision, responderName: name.trim(), reason: decision === 'declined' ? reason.trim() : null, ackVersion: '2026-10-14' }); }
  return <article aria-labelledby={`${field}-heading`} style={{ border: '1px solid var(--border, #d9e0e6)', borderRadius: 16, padding: 20, marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <h2 id={`${field}-heading`}>{snapshot.vehicle.make} {snapshot.vehicle.model} · Version {review.offerVersion}</h2>
    <p><strong>{statuses[review.status]}</strong></p>
    <dl style={{ display: 'grid', gap: 8, marginBottom: 20 }}><dt style={{ fontWeight: 600 }}>Handlare</dt><dd style={{ margin: '0 0 8px' }}>{snapshot.company.name} · Organisationsnummer {snapshot.company.organisation_number}</dd><dt style={{ fontWeight: 600 }}>Kund</dt><dd style={{ margin: '0 0 8px' }}>{snapshot.customer.name} · {review.recipientEmail}{snapshot.customer.phone ? <><br />{snapshot.customer.phone}</> : null}{snapshot.customer.address ? <><br />{snapshot.customer.address}</> : null}</dd><dt style={{ fontWeight: 600 }}>Fordon</dt><dd style={{ margin: '0 0 8px' }}>{snapshot.vehicle.registration_number} · {snapshot.vehicle.model_year} · {snapshot.vehicle.mileage_km.toLocaleString('sv-SE')} km<br />{fuel[snapshot.vehicle.fuel]} · {snapshot.vehicle.gearbox === 'automatic' ? 'Automat' : 'Manuell'}{snapshot.vehicle.vin ? <><br />Chassinummer: {snapshot.vehicle.vin}</> : null}</dd><dt style={{ fontWeight: 600 }}>Totalpris inklusive eventuell moms</dt><dd style={{ margin: '0 0 8px' }}><strong>{money(snapshot.sale_price_ore)}</strong></dd><dt style={{ fontWeight: 600 }}>Momsmodell</dt><dd style={{ margin: '0 0 8px' }}>{snapshot.stock.vat_scheme === 'standard' ? <>Standardmoms 25 %<br />Pris exklusive moms: {money(snapshot.vat.net_price_ore!)}<br />Moms: {money(snapshot.vat.amount_ore!)}</> : snapshot.stock.vat_scheme === 'vmb' ? 'Vinstmarginalbeskattning (VMB). Moms redovisas inte separat.' : 'Momsmodellen är inte klassificerad.'}</dd><dt style={{ fontWeight: 600 }}>Giltig till</dt><dd style={{ margin: '0 0 8px' }}>{snapshot.valid_until}</dd><dt style={{ fontWeight: 600 }}>Offerten skapades</dt><dd style={{ margin: '0 0 8px' }}>{new Date(snapshot.issued_at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}</dd></dl>
    {snapshot.trade_in?<section aria-label="Inbyte i offerten" style={{minWidth:0}}><h3>Inbyte i offerten</h3><p>{snapshot.trade_in.registration} · {snapshot.trade_in.make} {snapshot.trade_in.model}<br/>Modellår {snapshot.trade_in.model_year} · {snapshot.trade_in.mileage_km} km · Underlagsversion {snapshot.trade_in.version}</p><p>Inbytesvärde: {formatOre(snapshot.trade_in.value_ore)}<br/>Kvarvarande skuld enligt underlaget: {snapshot.trade_in.debt_ore===null?'Okänd':formatOre(snapshot.trade_in.debt_ore)}<br/>Nettoinbyte: {snapshot.trade_in.net_trade_in_ore===null?'Kan inte beräknas':formatOre(snapshot.trade_in.net_trade_in_ore)}<br/>{snapshot.trade_in.amount_to_pay_ore!==null&&BigInt(snapshot.trade_in.amount_to_pay_ore)<0n?'Att betala till dig enligt underlaget':'Att betala av dig enligt underlaget'}: <strong>{snapshot.trade_in.amount_to_pay_ore===null?'Kan inte beräknas':formatOre((BigInt(snapshot.trade_in.amount_to_pay_ore)<0n?-BigInt(snapshot.trade_in.amount_to_pay_ore):BigInt(snapshot.trade_in.amount_to_pay_ore)).toString())}</strong></p><p className="muted">Skulden är registrerad enligt underlaget och inte verifierad hos kreditgivaren. Beloppen innebär ingen genomförd betalning. Inbytet och bilens moms redovisas var för sig.</p></section>:null}
    <h3>Villkor</h3><p style={{ whiteSpace: 'pre-wrap' }}>{snapshot.terms || 'Inga ytterligare villkor angivna.'}</p>
    {review.responderName ? <p>Svar från {review.responderName}{review.decidedAt ? ` · ${new Date(review.decidedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}` : ''}</p> : null}{review.reason ? <p>Anledning: {review.reason}</p> : null}
    {review.status === 'pending' ? <div className="workspace-form"><label htmlFor={`${field}-name`}>Ditt fullständiga namn<input id={`${field}-name`} value={name} maxLength={160} disabled={busy} onChange={event => setName(event.target.value)} autoComplete="name" /></label><label htmlFor={`${field}-ack`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start' }}><input id={`${field}-ack`} type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} style={{ width: 'auto', flexShrink: 0 }} /><span>Jag har läst denna offertversion, totalpriset, momsmodellen, giltighetstiden och villkoren.{snapshot.trade_in?' Jag har även granskat inbytesbilen, skuldens belopp och mellanskillnaden i denna version.':''}</span></label><button type="button" className="button button-green" disabled={busy || !acknowledged || name.trim().length < 2 || snapshot.stock.vat_scheme === 'unknown'} onClick={() => prepare('accepted')}>Granska accept</button><label htmlFor={`${field}-reason`}>Anledning om du avböjer<input id={`${field}-reason`} value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label><button type="button" className="button button-outline" disabled={busy || !acknowledged || name.trim().length < 2 || reason.trim().length < 2} onClick={() => prepare('declined')}>Granska avböjande</button></div> : null}
  </article>;
}
