'use client';

import { useEffect, useRef, useState } from 'react';
import { listAdvertisingBillingAction, getPlatformAdvertisingBillingAction, saveAdvertisingChannelRateAction, reconcileAdvertisingBillingAction, lockAdvertisingBillingPeriodAction } from '@/lib/advertising/billing-actions';
import type { AdvertisingBillingPage } from '@/lib/advertising/billing-types';
import type { AdvertisingChannel } from '@/lib/advertising/database.types';
import { formatOre, kronorToOre } from '@/lib/calculations/vehicle-calculation';

const channels: AdvertisingChannel[] = ['blocket', 'wayke'];
const names = { blocket: 'Blocket', wayke: 'Wayke' };
const date = (value: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
function previousMonth() { const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit' }).formatToParts(new Date()); const year = Number(parts.find(p => p.type === 'year')!.value), month = Number(parts.find(p => p.type === 'month')!.value); return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`; }
type Review = { kind: 'rate' | 'reconcile'; channel: AdvertisingChannel; unitPriceOre: string; reason: string; confirmed: boolean } | { kind: 'lock'; confirmed: boolean; coverageConfirmed: boolean };
type Props = { companyId: string; userId: string; role?: string; superadmin?: boolean; onDenied?: (message: string) => void };

export function AdvertisingBillingPanel(props: Props) { return <Billing key={`${props.companyId}:${props.userId}:${props.role}:${props.superadmin}`} {...props}/>; }
function Billing({ companyId, userId, role = 'platform_admin', superadmin = false, onDenied }: Props) {
  const [month, setMonth] = useState(previousMonth);
  const [page, setPage] = useState<AdvertisingBillingPage | null>(null);
  const [channel, setChannel] = useState<AdvertisingChannel>('blocket');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0), alive = useRef(true), inFlight = useRef(false);
  const requests = useRef(new Map<string, string>());
  const deniedCallback = useRef(onDenied); deniedCallback.current = onDenied;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++generation.current; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review?.kind]);
  function failure(result: { code?: string; message: string }) {
    setError(result.message); setReview(null);
    if (result.code === 'access_denied' || result.code === 'unauthenticated') {
      ++generation.current; setPage(null); setDenied(true); setPrice(''); setReason(''); setNotice(''); deniedCallback.current?.(result.message);
    }
  }
  function scoped(result: AdvertisingBillingPage) { return result.companyId === companyId && result.actorUserId === userId && result.actorRole === (superadmin ? 'platform_admin' : role) && result.month === month; }
  useEffect(() => {
    const request = ++generation.current; setPage(null); setReview(null);
    if (denied || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { setLoading(false); return; }
    setLoading(true); setError('');
    void (superadmin ? getPlatformAdvertisingBillingAction : listAdvertisingBillingAction)({ companyId, month }).then(result => {
      if (!alive.current || generation.current !== request) return;
      if (!result.ok) { failure(result); return; }
      if (!scoped(result.page)) { failure({ code: 'access_denied', message: 'Företaget eller administratörsåtkomsten har ändrats. Läs in sidan igen.' }); return; }
      setPage(result.page);
    }).catch(() => { if (alive.current && generation.current === request) setError('Prisunderlaget kunde inte läsas in. Försök igen.'); })
      .finally(() => { if (alive.current && generation.current === request) setLoading(false); });
    return () => { ++generation.current; };
  }, [companyId, userId, role, superadmin, month, refresh, denied]);
  function prepare(kind: 'rate' | 'reconcile') {
    setError(''); setNotice('');
    try {
      const unitPriceOre = kronorToOre(price);
      if (unitPriceOre === null) throw new Error('Ange det överenskomna priset.');
      if (kind === 'reconcile' && reason.trim().length < 5) throw new Error('Beskriv varför detta pris gäller för publiceringarna (minst fem tecken).');
      setReview({ kind, channel, unitPriceOre, reason: reason.trim(), confirmed: false });
    } catch (value) { setError(value instanceof Error ? value.message : 'Kontrollera priset.'); }
  }
  async function confirm() {
    if (!superadmin || !page || !review?.confirmed || inFlight.current || denied || loading || (review.kind === 'lock' && page.coverage === 'partial' && !review.coverageConfirmed)) return;
    const revision = generation.current;
    const input = review.kind === 'rate'
      ? { companyId, channel: review.channel, unitPriceOre: review.unitPriceOre, expectedVersion: page.rates.find(rate => rate.channel === review.channel)?.version ?? 0 }
      : review.kind === 'reconcile'
        ? { companyId, month, channel: review.channel, unitPriceOre: review.unitPriceOre, expectedReviewToken: page.reviewToken, reason: review.reason, reviewAcknowledged: true as const }
        : { companyId, month, expectedReviewToken: page.reviewToken, reviewAcknowledged: true as const, partialCoverageAcknowledged: review.kind === 'lock' && review.coverageConfirmed };
    const fingerprint = `${review.kind}:${JSON.stringify(input)}`;
    if (!requests.current.has(fingerprint)) requests.current.set(fingerprint, crypto.randomUUID());
    const requestId = requests.current.get(fingerprint)!;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = review.kind === 'rate'
        ? await saveAdvertisingChannelRateAction({ ...input, requestId } as Parameters<typeof saveAdvertisingChannelRateAction>[0])
        : review.kind === 'reconcile'
          ? await reconcileAdvertisingBillingAction({ ...input, requestId } as Parameters<typeof reconcileAdvertisingBillingAction>[0])
          : await lockAdvertisingBillingPeriodAction({ ...input, requestId } as Parameters<typeof lockAdvertisingBillingPeriodAction>[0]);
      if (!alive.current || generation.current !== revision) return;
      if (!result.ok) { failure(result); if (result.code === 'conflict') { setPage(null); setRefresh(value => value + 1); } return; }
      setReview(null); setPrice(''); setReason(''); setPage(null);
      setNotice(review.kind === 'rate' ? 'Det nya kanalpriset är sparat för kommande publiceringar.' : review.kind === 'reconcile' ? 'Priset för de granskade publiceringarna är sparat.' : 'Månadsunderlaget är låst. Ingen faktura har skickats.');
      setRefresh(value => value + 1);
    } catch { if (alive.current && generation.current === revision) setError('Åtgärdens resultat kunde inte verifieras. Läs in underlaget igen innan du försöker på nytt.'); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="surface" style={{ marginTop: 24 }} aria-label="Kanalpriser och månadsavstämning"><div className="panel-heading"><h2>Kanalpriser och månadsavstämning</h2></div><div style={{ padding: 20, minWidth: 0 }}>
    <p>Debitering per unik publicerad annons och kanal. Alla belopp är i SEK exklusive moms. Underlaget är ingen faktura.</p>
    <label style={{ display: 'grid', gap: 6, maxWidth: 240 }}>Avstämningsmånad<input type="month" value={month} required disabled={busy || denied} onChange={event => { ++generation.current; setPage(null); setReview(null); setPrice(''); setReason(''); setNotice(''); setMonth(event.target.value); }}/></label>
    <button className="button button-outline" style={{ marginTop: 12 }} disabled={loading || busy || denied || !month} onClick={() => { setPage(null); setReview(null); setNotice(''); setRefresh(value => value + 1); }}>Uppdatera prisunderlag</button>
    {loading && <p role="status">Läser in priser och månadsunderlag…</p>}{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {page && <>
      <h3>Gällande kanalpriser</h3><p>Nya priser gäller kommande publiceringar från när priset sparas. Tidigare publiceringar ändras inte.</p>
      <div className="table-scroll"><table className="data-table"><caption className="sr-only">Aktuella kanalpriser exklusive moms</caption><thead><tr><th scope="col">Kanal</th><th scope="col">Styckpris exkl. moms</th><th scope="col">Gäller från</th></tr></thead><tbody>{channels.map(key => { const rate = page.rates.find(row => row.channel === key); return <tr key={key}><th scope="row">{names[key]}</th><td>{rate ? formatOre(rate.unitPriceOre) : 'Pris saknas'}</td><td>{rate ? date(rate.effectiveAt) : '—'}</td></tr>; })}</tbody></table></div>
      {superadmin && !review && <div className="workspace-form" style={{ marginTop: 20 }}><label>Kanal<select value={channel} disabled={busy} onChange={event => setChannel(event.target.value as AdvertisingChannel)}>{channels.map(key => <option key={key} value={key}>{names[key]}</option>)}</select></label><label>Överenskommet styckpris, kronor exkl. moms<input value={price} inputMode="decimal" maxLength={24} placeholder="Exempel: 149,50" disabled={busy} onChange={event => setPrice(event.target.value)}/></label><button type="button" className="button button-outline" disabled={busy} onClick={() => prepare('rate')}>Granska nytt kanalpris</button>
        {!page.locked && page.unpricedCount > 0 && <><h4>Prissätt tidigare publiceringar</h4><p>Det angivna priset gäller bara publiceringar utan pris för vald kanal och månad. Granska er överenskommelse innan du sparar.</p><label>Motivering till priset<textarea maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)}/></label><button type="button" className="button button-outline" disabled={busy || !page.items.some(item => item.channel === channel && item.unitPriceOre === null)} onClick={() => prepare('reconcile')}>Granska pris för publiceringar utan pris</button></>}
      </div>}
      <h3 style={{ marginTop: 24 }}>Månadsunderlag för {page.month}</h3>
      <dl className="detail-list"><div><dt>Unika publiceringar</dt><dd>{page.locked?.count ?? page.count}</dd></div><div><dt>Publiceringar utan pris</dt><dd>{page.locked ? 0 : page.unpricedCount}</dd></div><div><dt>Summa exklusive moms</dt><dd>{page.locked ? formatOre(page.locked.totalOre) : page.totalOre === null ? 'Kan inte beräknas – priser saknas' : formatOre(page.totalOre)}</dd></div><div><dt>Underlagets status</dt><dd>{page.locked ? 'Låst' : 'Öppet för granskning'}</dd></div></dl>
      {page.coverage === 'partial' && <p className="form-privacy">Ofullständig historik: registreringen började {date(page.trackingStartedAt)}. Tidigare publiceringar kan saknas.</p>}
      {page.legacyPublishedJobs > 0 && <p>{page.legacyPublishedJobs} äldre publicerade jobb saknar verifierat publiceringsunderlag och ingår inte.</p>}
      {Date.parse(page.periodEnd) <= Date.parse(page.trackingStartedAt) && <p>Hela månaden ligger före registreringens start. Underlaget kan inte låsas.</p>}
      {!page.ended && <p>Månaden pågår eller har ännu inte börjat. Underlaget kan låsas först när månaden är avslutad enligt svensk tid.</p>}
      {page.locked && <p>Låst {date(page.locked.lockedAt)}: {page.locked.count} publiceringar, {formatOre(page.locked.totalOre)} exklusive moms. Det låsta underlaget ändras inte.</p>}
      {page.locked && <p><a className="text-link" href={`/api/advertising/billing/${encodeURIComponent(page.month)}/csv${superadmin ? `?companyId=${encodeURIComponent(companyId)}` : ''}`}>Hämta låst månadsunderlag som CSV</a></p>}
      {page.hasChangesSinceLock && <p role="alert">Nya uppgifter har tillkommit efter låsningen. Det låsta underlaget måste stämmas av separat innan fakturering.</p>}
      <div className="table-scroll"><table className="data-table"><caption>Publiceringar i prisunderlaget för {page.month}</caption><thead><tr><th scope="col">Annons-ID</th><th scope="col">Kanal</th><th scope="col">Publicerad</th><th scope="col">Pris exkl. moms</th><th scope="col">Prisgrund</th></tr></thead><tbody>{(page.locked?.items ?? page.items).map(item => <tr key={item.publicationId}><th scope="row" style={{ overflowWrap: 'anywhere' }}>{item.listingId}</th><td>{names[item.channel]}</td><td>{date(item.publishedAt)}</td><td>{item.unitPriceOre === null ? 'Pris saknas' : formatOre(item.unitPriceOre)}</td><td>{item.priceSource === 'review' ? 'Granskat pris' : item.priceSource === 'rate' ? 'Kanalpris vid publicering' : 'Ej prissatt'}</td></tr>)}</tbody></table></div>
      {!(page.locked?.items ?? page.items).length && <p>Inga verifierade publiceringar för vald månad.</p>}
      {superadmin && !page.locked && !review && <button type="button" className="button button-green" style={{ marginTop: 16 }} disabled={!page.ended || page.unpricedCount > 0 || busy || Date.parse(page.periodEnd) <= Date.parse(page.trackingStartedAt)} onClick={() => { setError(''); setNotice(''); setReview({ kind: 'lock', confirmed: false, coverageConfirmed: false }); }}>Granska och lås månadsunderlag</button>}
      {review && <section className="workspace-form surface" style={{ padding: 18, marginTop: 20 }} aria-label="Granska ändring"><h3 ref={heading} tabIndex={-1}>{review.kind === 'lock' ? 'Granska låsning av månadsunderlag' : review.kind === 'rate' ? 'Granska nytt kanalpris' : 'Granska pris för tidigare publiceringar'}</h3>
        {review.kind === 'lock' ? <p>{page.month}: {page.count} publiceringar, {page.totalOre === null ? 'Pris saknas' : formatOre(page.totalOre)} exklusive moms. Ett låst underlag kan inte ändras. Ingen faktura skickas.</p> : <p>{names[review.channel]}: {formatOre(review.unitPriceOre)} exklusive moms per unik publicerad annons.{review.kind === 'rate' ? ' Gäller kommande publiceringar från när priset sparas.' : ` Gäller ${page.items.filter(item => item.channel === review.channel && item.unitPriceOre === null).length} publiceringar utan pris under ${page.month}.`} {review.kind === 'reconcile' && <>Motivering: {review.reason}</>}</p>}
        <label style={{ display: 'flex', alignItems: 'start', gap: 10 }}><input type="checkbox" checked={review.confirmed} disabled={busy} style={{ width: 'auto' }} onChange={event => setReview({ ...review, confirmed: event.target.checked })}/><span>Jag har granskat företaget, kanalen, perioden och prisöverenskommelsen.</span></label>
        {review.kind === 'lock' && page.coverage === 'partial' && <label style={{ display: 'flex', alignItems: 'start', gap: 10 }}><input type="checkbox" checked={review.coverageConfirmed} disabled={busy} style={{ width: 'auto' }} onChange={event => setReview({ ...review, coverageConfirmed: event.target.checked })}/><span>Jag har granskat den ofullständiga historiken och godkänner att låsa det registrerade underlaget.</span></label>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" className="button button-green" disabled={busy || !review.confirmed || (review.kind === 'lock' && page.coverage === 'partial' && !review.coverageConfirmed)} onClick={() => void confirm()}>{review.kind === 'lock' ? 'Bekräfta och lås underlaget' : 'Bekräfta och spara priset'}</button><button type="button" className="button button-outline" disabled={busy} onClick={() => setReview(null)}>Avbryt granskning</button></div>
      </section>}
    </>}
  </div></section>;
}
