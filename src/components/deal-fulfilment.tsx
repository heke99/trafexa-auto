'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { getDealFulfilmentAction, mutateDealFulfilmentAction } from '@/lib/deal-fulfilment/actions';
import type { FulfilmentMutation, FulfilmentPage } from '@/lib/deal-fulfilment/types';

const reasons = { accepted_offer_required: 'En accepterad offert behövs.', contract_required: 'Båda parter behöver signera avtalet.', original_required: 'Det signerade originalet behöver arkiveras.', trade_in_settlement_unsupported: 'Inbytesaffärer kräver separat avstämning av inbyte, skuld och eventuell utbetalning. Leveransstödet kan ännu inte avsluta dessa affärer.', deal_unavailable: 'Affären kan inte avslutas i sitt aktuella läge.' };
function money(value: string) { return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(Number(value) / 100); }
export function DealFulfilment(props: { companyId: string; userId: string; role: string; dealId: string; demo?: boolean; onDelivered?: () => void }) {
  if (!['owner', 'admin', 'finance'].includes(props.role)) return null;
  return <FulfilmentPanel key={`${props.companyId}:${props.userId}:${props.role}:${props.dealId}:${!!props.demo}`} {...props} />;
}
function FulfilmentPanel({ companyId, dealId, role, demo, onDelivered }: { companyId: string; userId: string; role: string; dealId: string; demo?: boolean; onDelivered?: () => void }) {
  const prefix = useId(), alive = useRef(false), lock = useRef(false), retries = useRef(new Map<string, string>());
  const [open, setOpen] = useState(false), [page, setPage] = useState<FulfilmentPage | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [review, setReview] = useState<Omit<FulfilmentMutation, 'requestId'> | null>(null), [blocked, setBlocked] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load() {
    if (lock.current || demo) return;
    lock.current = true; setBusy(true); setError(''); setReview(null);
    try { const result = await getDealFulfilmentAction({ companyId, dealId }); if (!alive.current) return; if (result.ok) { setPage(result.page); setBlocked(false); } else { setPage(null); setError(result.message); } }
    catch { if (alive.current) { setPage(null); setError('Avstämningen kunde inte hämtas. Försök igen.'); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!page || busy || blocked || role === 'finance' || !event.currentTarget.reportValidity()) return;
    const values = new FormData(event.currentTarget), raw = String(values.get('amount') ?? '').trim().replace(',', '.');
    if (!/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(raw)) { setError('Ange ett belopp med högst två decimaler.'); return; }
    const [whole, fraction = ''] = raw.split('.'), amountOre = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
    if (BigInt(amountOre) <= 0n || BigInt(amountOre) > 999999999999n) { setError('Beloppet är ogiltigt.'); return; }
    setError(''); setReview({ companyId, dealId, expectedVersion: page.version, operation: 'payment', amountOre, bankReference: String(values.get('reference')).trim(), bookedOn: String(values.get('date')), reason: String(values.get('reason')).trim() });
  }
  async function confirm() {
    if (!review || lock.current || blocked || demo || role === 'finance') return;
    const fingerprint = JSON.stringify(review); let requestId = retries.current.get(fingerprint);
    if (!requestId) { requestId = crypto.randomUUID(); retries.current.set(fingerprint, requestId); }
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await mutateDealFulfilmentAction({ ...review, requestId }); if (!alive.current) return;
      if (!result.ok) { setError(result.message); if (['conflict', 'access_denied', 'unauthenticated'].includes(result.code)) { setPage(null); setReview(null); setBlocked(true); } return; }
      setPage(result.page); setReview(null); retries.current.clear(); if (result.page.delivery) onDelivered?.();
    } catch { if (alive.current) setError('Resultatet kunde inte bekräftas. Försök igen med samma granskade begäran.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const reversalTarget = review?.operation === 'reverse' ? page?.entries.find(entry => entry.id === review.reversalOf && !entry.reversalOf) : null;
  return <section aria-label="Betalning och leverans"><button type="button" className="button button-outline button-small" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !page) void load(); }}>Betalning och leverans</button>
    {open ? <div className="stack"><p className="muted small">Manuell avstämning mot handlarens eget bankunderlag. Uppgifterna är inte bankverifierade och inga pengar överförs.</p>
      {demo ? <p>Avstämning sparas inte i demon.</p> : null}{error ? <p role="alert">{error}</p> : null}{busy ? <p role="status">Arbetar…</p> : null}
      {!demo ? <button type="button" className="button button-outline button-small" disabled={busy} onClick={() => void load()}>Läs in aktuell avstämning</button> : null}
      {page ? <><p>Manuellt registrerat: <strong>{money(page.registeredOre)}</strong>{page.source ? <> av {money(page.source.amountDueOre)}</> : null}</p>
        {page.blockedReason ? <p>{reasons[page.blockedReason]}</p> : null}
        {page.delivery ? <p role="status">Leverans registrerad {new Date(page.delivery.deliveredAt).toLocaleDateString('sv-SE')}. Bilen är såld och affären avslutad. {page.delivery.note}</p> : null}
        {page.delivery ? <p className="inline-note">Kontrollera och avpublicera bilens annonser hos externa annonskanaler. Registrerad leverans tar inte automatiskt bort annonser hos Blocket eller Wayke.</p> : null}
        {page.entries.length ? <ul>{page.entries.map(entry => <li key={entry.id} style={{ overflowWrap: 'anywhere' }}>{entry.reversalOf ? 'Återföring' : 'Inbetalning'}: {money(entry.amountOre)} · {entry.bankReference} · {entry.bookedOn} · {entry.actorLabel}. {entry.reason}
          {!page.delivery && role !== 'finance' && !entry.reversalOf && !page.entries.some(x => x.reversalOf === entry.id) ? <form onSubmit={event => { event.preventDefault(); if (!busy && !blocked) { const data = new FormData(event.currentTarget); setReview({ companyId, dealId, expectedVersion: page.version, operation: 'reverse', reversalOf: entry.id, reason: String(data.get('reason')).trim() }); } }}><label>Varför ska posten återföras?<input name="reason" required minLength={2} maxLength={300} disabled={busy || blocked} /></label><button type="submit" className="button button-outline button-small" disabled={busy || blocked}>Granska återföring</button></form> : null}</li>)}</ul> : <p>Inga manuella betalningsposter.</p>}
        {role === 'finance' ? <p className="muted">Din roll kan läsa avstämningen. Ägare eller administratör registrerar ändringar och leverans.</p> : !page.delivery && page.source && !review ? <><form onSubmit={prepare}>
          <label htmlFor={`${prefix}-amount`}>Inbetalt belopp, kr</label><input id={`${prefix}-amount`} name="amount" inputMode="decimal" required disabled={busy || blocked} />
          <label htmlFor={`${prefix}-reference`}>Unik referens från bankunderlaget</label><input id={`${prefix}-reference`} name="reference" minLength={2} maxLength={300} required disabled={busy || blocked} />
          <label htmlFor={`${prefix}-date`}>Bokföringsdatum</label><input id={`${prefix}-date`} name="date" type="date" min="2000-01-01" max={page.businessDate} defaultValue={page.businessDate} required disabled={busy || blocked} />
          <label htmlFor={`${prefix}-reason`}>Anteckning om avstämningen</label><input id={`${prefix}-reason`} name="reason" minLength={2} maxLength={300} required disabled={busy || blocked} />
          <button type="submit" className="button button-green" disabled={busy || blocked}>Granska inbetalning</button>
        </form>{page.canDeliver ? <form onSubmit={event => { event.preventDefault(); if (!busy && !blocked) { const data = new FormData(event.currentTarget); setReview({ companyId, dealId, expectedVersion: page.version, operation: 'deliver', reason: String(data.get('reason')).trim() }); } }}><label>Leveransanteckning<input name="reason" minLength={2} maxLength={300} required disabled={busy || blocked} /></label><button type="submit" className="button button-green" disabled={busy || blocked}>Granska leverans</button></form> : <p>Leverans kräver full manuellt avstämd betalning, accepterad offert, signerat arkiverat avtal och att bilen är reserverad till denna affär.</p>}</> : null}
      </> : null}
      {review ? <div role="region" aria-label="Granska avstämning"><h3>Granska {review.operation === 'payment' ? 'inbetalning' : review.operation === 'reverse' ? 'återföring' : 'leverans'}</h3><p>{reversalTarget ? <>Återför {money(reversalTarget.amountOre)} · {reversalTarget.bankReference} · {reversalTarget.bookedOn}</> : <>{review.amountOre ? money(review.amountOre) : ''} {review.bankReference} {review.bookedOn}</>}</p><p>{review.reason}</p>{review.operation === 'deliver' ? <p>Bekräftelsen markerar bilen som såld, avslutar affären och frigör dess reservation. Den kan inte ångras här. Kontrollera och avpublicera även bilens externa annonser; de tas inte bort automatiskt.</p> : <p>Detta är din manuella registrering utifrån bankunderlaget.</p>}<button type="button" disabled={busy} className="button button-outline" onClick={() => setReview(null)}>Tillbaka</button><button type="button" disabled={busy || blocked || review.operation === 'reverse' && !reversalTarget} className="button button-green" onClick={() => void confirm()}>Bekräfta {review.operation === 'deliver' ? 'leverans' : 'registrering'}</button></div> : null}
    </div> : null}
  </section>;
}
