'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createAdvertisingReductionAction, getPlatformAdvertisingCorrectionsAction, listAdvertisingCorrectionsAction } from '@/lib/advertising/correction-actions';
import type { AdvertisingCorrectionsPage } from '@/lib/advertising/correction-types';
import { formatOre, kronorToOre } from '@/lib/calculations/vehicle-calculation';

type Props = { companyId: string; userId: string; role: string; superadmin?: boolean; month: string; originalId: string | null; onDenied?: (message: string) => void };
type Review = { publicationId: string; amountOre: string; reason: string; reviewToken: string; confirmed: boolean };
const names = { blocket: 'Blocket', wayke: 'Wayke' };
const date = (value: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export function AdvertisingBillingCorrectionsPanel(props: Props) {
  return <Corrections key={`${props.companyId}:${props.userId}:${props.role}:${props.superadmin}:${props.month}:${props.originalId}`} {...props}/>;
}
function Corrections({ companyId, userId, role, superadmin = false, month, originalId, onDenied }: Props) {
  const [page, setPage] = useState<AdvertisingCorrectionsPage | null>(null);
  const [publicationId, setPublicationId] = useState('');
  const [amount, setAmount] = useState('');
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
  useEffect(() => { if (review) heading.current?.focus(); }, [review !== null]);
  const remaining = useMemo(() => {
    const totals = new Map<string, bigint>();
    for (const item of page?.original?.items ?? []) totals.set(item.publicationId, BigInt(item.unitPriceOre!));
    for (const adjustment of page?.adjustments ?? []) totals.set(adjustment.publicationId, (totals.get(adjustment.publicationId) ?? 0n) - BigInt(adjustment.amountOre));
    return totals;
  }, [page]);
  function failure(result: { code?: string; message: string }) {
    setError(result.message);
    if (result.code === 'access_denied' || result.code === 'unauthenticated') {
      ++generation.current; setPage(null); setReview(null); setAmount(''); setReason(''); setPublicationId(''); setNotice(''); setDenied(true); deniedCallback.current?.(result.message);
    }
  }
  function scoped(value: AdvertisingCorrectionsPage) {
    return value.companyId === companyId && value.actorUserId === userId && value.actorRole === (superadmin ? 'platform_admin' : role) && value.month === month && (value.original?.id ?? null) === originalId;
  }
  useEffect(() => {
    const request = ++generation.current; setPage(null); setReview(null);
    if (denied) { setLoading(false); return; }
    setLoading(true); setError('');
    void (superadmin ? getPlatformAdvertisingCorrectionsAction : listAdvertisingCorrectionsAction)({ companyId, month }).then(result => {
      if (!alive.current || generation.current !== request) return;
      if (!result.ok) { failure(result); return; }
      if (!scoped(result.page)) { failure({ code: 'access_denied', message: 'Företaget, månadsunderlaget eller din behörighet har ändrats. Läs in sidan igen.' }); return; }
      setPage(result.page);
    }).catch(() => { if (alive.current && generation.current === request) setError('Rättelseunderlaget kunde inte verifieras. Försök igen.'); })
      .finally(() => { if (alive.current && generation.current === request) setLoading(false); });
    return () => { ++generation.current; };
  }, [companyId, userId, role, superadmin, month, originalId, refresh, denied]);
  function prepare() {
    if (!superadmin || !page?.original || busy || denied) return;
    setError(''); setNotice('');
    try {
      const amountOre = kronorToOre(amount);
      if (amountOre === null || BigInt(amountOre) <= 0n) throw new Error('Ange en reduktion större än noll.');
      if (!remaining.has(publicationId)) throw new Error('Välj en publicering ur det låsta originalet.');
      if (BigInt(amountOre) > remaining.get(publicationId)!) throw new Error('Reduktionen får inte överstiga publiceringens återstående belopp.');
      if (reason.trim().length < 5) throw new Error('Beskriv varför beloppet ska reduceras (minst fem tecken).');
      setReview({ publicationId, amountOre, reason: reason.trim(), reviewToken: page.reviewToken, confirmed: false });
    } catch (value) { setError(value instanceof Error ? value.message : 'Kontrollera uppgifterna.'); }
  }
  async function confirm() {
    if (!superadmin || !page?.original || !review?.confirmed || loading || denied || inFlight.current) return;
    const request = generation.current;
    const input = { companyId, month, publicationId: review.publicationId, amountOre: review.amountOre, reason: review.reason, expectedReviewToken: review.reviewToken, reviewAcknowledged: true as const };
    const fingerprint = JSON.stringify(input);
    if (!requests.current.has(fingerprint)) requests.current.set(fingerprint, crypto.randomUUID());
    const requestId = requests.current.get(fingerprint)!;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await createAdvertisingReductionAction({ ...input, requestId });
      if (!alive.current || generation.current !== request) return;
      if (!result.ok) {
        failure(result);
        if (result.code === 'conflict') { setReview(null); setPage(null); setNotice('Underlaget har ändrats. Granska de senaste uppgifterna innan du gör en ny rättelse.'); setRefresh(value => value + 1); }
        return;
      }
      if (!scoped(result.page) || result.receipt.companyId !== companyId || result.receipt.actorUserId !== userId || result.receipt.requestId !== requestId) {
        failure({ code: 'access_denied', message: 'Rättelsen kunde inte verifieras för aktuellt företag och användare. Läs in sidan igen.' }); return;
      }
      // The receipt is historical. Only a fresh authorized read may restore the view.
      setPage(null); setReview(null); setAmount(''); setReason(''); setPublicationId('');
      setNotice('Reduktionen är sparad som ett separat rättelseunderlag. Originalet är oförändrat. Ingen kreditfaktura har skapats.');
      setRefresh(value => value + 1);
    } catch { if (alive.current && generation.current === request) setError('Åtgärdens resultat är okänt. Försök samma bekräftelse igen för att kontrollera den sparade begäran.'); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  const selected = page?.original?.items.find(item => item.publicationId === (review?.publicationId ?? publicationId));
  return <section aria-label="Rättelser av låst månadsunderlag" className="surface" style={{ marginTop: 24, padding: 20, minWidth: 0 }}>
    <h3>Rättelser av låst månadsunderlag</h3>
    <p>Separata reduktioner i SEK exklusive moms. Det låsta originalet bevaras. Rättelseunderlaget är ingen kreditfaktura och ändrar inga betalningar.</p>
    <button type="button" className="button button-outline" disabled={loading || busy || denied} onClick={() => { setPage(null); setReview(null); setNotice(''); setRefresh(value => value + 1); }}>Uppdatera rättelseunderlag</button>
    {loading && <p role="status">Verifierar rättelseunderlag…</p>}{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {page && !page.original && <p>Månaden har inget låst original. Ett rättelseunderlag kan skapas först efter att månadsunderlaget har låsts.</p>}
    {page?.original && <>
      <h4>Belopp för {page.month}</h4><dl className="detail-list"><div><dt>Låst original, exkl. moms</dt><dd>{formatOre(page.original.totalOre)}</dd></div><div><dt>Sammanlagda reduktioner, exkl. moms</dt><dd>{formatOre(page.reductionTotalOre)}</dd></div><div><dt>Återstående belopp, exkl. moms</dt><dd>{page.netTotalOre === null ? 'Kan inte verifieras' : formatOre(page.netTotalOre)}</dd></div></dl>
      <p><a className="text-link" href={`/api/advertising/billing/${encodeURIComponent(month)}/corrections/csv${superadmin ? `?companyId=${encodeURIComponent(companyId)}` : ''}`}>Hämta rättelseunderlag som CSV</a></p>
      <div className="table-scroll"><table className="data-table"><caption>Originalets publiceringar och återstående belopp</caption><thead><tr><th scope="col">Annons-ID</th><th scope="col">Kanal</th><th scope="col">Original, exkl. moms</th><th scope="col">Återstår, exkl. moms</th></tr></thead><tbody>{page.original.items.map(item => <tr key={item.publicationId}><th scope="row" style={{ overflowWrap: 'anywhere' }}>{item.listingId}</th><td>{names[item.channel]}</td><td>{formatOre(item.unitPriceOre!)}</td><td>{formatOre(remaining.get(item.publicationId)!.toString())}</td></tr>)}</tbody></table></div>
      {!page.original.items.length && <p>Det låsta originalet saknar publiceringar. Det finns inget belopp att reducera.</p>}
      {superadmin && !review && page.original.items.some(item => remaining.get(item.publicationId)! > 0n) && <div className="workspace-form" style={{ marginTop: 20 }}>
        <label>Publicering att rätta<select value={publicationId} disabled={busy} onChange={event => { setPublicationId(event.target.value); setAmount(''); setError(''); }}><option value="">Välj publicering</option>{page.original.items.map(item => <option key={item.publicationId} value={item.publicationId} disabled={remaining.get(item.publicationId)! <= 0n}>{names[item.channel]} · {item.listingId} · återstår {formatOre(remaining.get(item.publicationId)!.toString())}</option>)}</select></label>
        <label>Reduktion, kronor exkl. moms<input inputMode="decimal" maxLength={24} value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} placeholder="Exempel: 49,50"/></label>
        <label>Motivering till reduktionen<textarea value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)}/></label>
        <button type="button" className="button button-outline" disabled={busy} onClick={prepare}>Granska reduktionen</button>
      </div>}
      {review && <section aria-label="Granska rättelse" className="workspace-form surface" style={{ padding: 18, marginTop: 20 }}><h4 tabIndex={-1} ref={heading}>Granska reduktionen för {month}</h4><p>{selected ? `${names[selected.channel]} · ${selected.listingId}` : 'Publiceringen kunde inte verifieras'}<br/>Reduktion: <strong>{formatOre(review.amountOre)} exklusive moms</strong><br/>Återstår efter denna reduktion: {formatOre(((remaining.get(review.publicationId) ?? 0n) - BigInt(review.amountOre)).toString())} exklusive moms.</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>Motivering: {review.reason}</p><p>Originalet bevaras. Rättelsen blir en separat oföränderlig post. Ingen kreditfaktura skickas.</p>
        <label style={{ display: 'flex', alignItems: 'start', gap: 10 }}><input type="checkbox" style={{ width: 'auto' }} checked={review.confirmed} disabled={busy} onChange={event => setReview({ ...review, confirmed: event.target.checked })}/><span>Jag har granskat företaget, månaden, originalpubliceringen, det återstående beloppet och motiveringen.</span></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}><button type="button" className="button button-green" disabled={busy || !review.confirmed} onClick={() => void confirm()}>Bekräfta och spara reduktionen</button><button type="button" className="button button-outline" disabled={busy} onClick={() => { setReview(null); setError(''); }}>Ändra reduktionen</button></div>
      </section>}
      <h4 style={{ marginTop: 24 }}>Sparade rättelser</h4>{page.adjustments.length ? <ol style={{ paddingLeft: 20 }}>{page.adjustments.map(adjustment => { const item = page.original!.items.find(row => row.publicationId === adjustment.publicationId); return <li key={adjustment.id} style={{ marginBlock: 16, overflowWrap: 'anywhere' }}><strong>Reduktion {formatOre(adjustment.amountOre)} exklusive moms</strong><p>Rättelsereferens: {adjustment.id}</p><p>{item ? `${names[item.channel]} · ${item.listingId}` : adjustment.publicationId}<br/>{date(adjustment.createdAt)} · {adjustment.createdBy}</p><p style={{ whiteSpace: 'pre-wrap' }}>{adjustment.reason}</p></li>; })}</ol> : <p>Inga reduktioner har registrerats för detta original.</p>}
    </>}
  </section>;
}
