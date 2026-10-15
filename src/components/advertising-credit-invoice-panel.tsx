'use client';

import { useEffect, useRef, useState } from 'react';
import { configureAdvertisingCreditSeriesAction, getPlatformAdvertisingCreditPageAction, issueAdvertisingCreditInvoiceAction, listAdvertisingCreditPageAction } from '@/lib/advertising/credit-actions';
import type { AdvertisingCreditPage } from '@/lib/advertising/credit-types';
import { formatOre } from '@/lib/calculations/vehicle-calculation';

type Props = { companyId: string; userId: string; role: string; superadmin?: boolean; originalInvoiceId: string; onDenied?: (message: string) => void };
type SeriesFields = { prefix: string; firstNumber: string; sellerRegisteredSeat: string; reason: string };
type Review = { kind: 'series'; fields: SeriesFields; year: number; originalSourceHash: string; confirmed: boolean } | { kind: 'credit'; reason: string; originalSourceHash: string; seriesId: string; seriesReviewToken: string; reviewToken: string; confirmed: boolean };
const blockers: Record<string, string> = {
  'credit.exists': 'Originalfakturan har redan krediterats i sin helhet.',
  'credit.zeroAmount': 'Originalfakturan har nollbelopp och kan inte krediteras.',
  'credit.adminOnly': 'Endast Trafexas superadmin får utfärda kreditfakturor.',
  'credit.dateBeforeOriginal': 'Kreditdatum får inte vara tidigare än originalfakturans datum.',
  'series.unconfigured': 'En nummerserie behöver konfigureras för säljarbolaget och kreditåret.',
  'series.exhausted': 'Nummerserien är förbrukad. Kreditfakturan kan inte utfärdas.',
};
const creditAmount = (value: string) => formatOre(value === '0' ? '0' : `-${value}`);
const acknowledgement = 'Jag har granskat originalfakturan, kreditfakturans nummer och datum, hela beloppet inklusive moms och motiveringen och vill kreditera fakturan i sin helhet.';

export function AdvertisingCreditInvoicePanel(props: Props) {
  return <Credit key={`${props.companyId}:${props.userId}:${props.role}:${props.superadmin}:${props.originalInvoiceId}`} {...props}/>;
}
function Credit({ companyId, userId, role, superadmin = false, originalInvoiceId, onDenied }: Props) {
  const [page, setPage] = useState<AdvertisingCreditPage | null>(null);
  const [editor, setEditor] = useState<SeriesFields | null>(null), [reason, setReason] = useState(''), [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), generation = useRef(0), inFlight = useRef(false), requests = useRef(new Map<string, string>()), deniedCallback = useRef(onDenied), heading = useRef<HTMLHeadingElement>(null);
  deniedCallback.current = onDenied;
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++generation.current; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review?.kind]);
  function failure(result: { code?: string; message: string }) {
    setError(result.message);
    if (result.code === 'access_denied' || result.code === 'unauthenticated') { ++generation.current; setPage(null); setEditor(null); setReview(null); setReason(''); setNotice(''); setDenied(true); deniedCallback.current?.(result.message); }
  }
  useEffect(() => {
    const scope = ++generation.current; setPage(null); setReview(null); setEditor(null); setReason('');
    if (denied) { setLoading(false); return; }
    setLoading(true); setError('');
    void (superadmin ? getPlatformAdvertisingCreditPageAction : listAdvertisingCreditPageAction)({ companyId, originalInvoiceId }).then(result => {
      if (!alive.current || generation.current !== scope) return;
      if (!result.ok) { failure(result); return; }
      const value = result.page;
      if (value.companyId !== companyId || value.actorUserId !== userId || value.actorRole !== (superadmin ? 'platform_admin' : role) || value.originalInvoice.id !== originalInvoiceId || value.originalInvoice.companyId !== companyId || (value.credit && (value.credit.originalInvoiceId !== originalInvoiceId || value.credit.companyId !== companyId))) { failure({ code: 'access_denied', message: 'Krediteringen kunde inte verifieras för aktuellt företag, originalfaktura och behörighet.' }); return; }
      setPage(value);
    }).catch(() => { if (alive.current && generation.current === scope) setError('Krediteringen kunde inte verifieras. Försök igen.'); }).finally(() => { if (alive.current && generation.current === scope) setLoading(false); });
    return () => { ++generation.current; };
  }, [companyId, userId, role, superadmin, originalInvoiceId, refresh, denied]);
  function prepareSeries() {
    if (!superadmin || !page?.canConfigureSeries || !editor) return;
    const fields = { prefix: editor.prefix.trim().toUpperCase(), firstNumber: editor.firstNumber.trim(), sellerRegisteredSeat: editor.sellerRegisteredSeat.trim(), reason: editor.reason.trim() };
    if (!/^[A-Z0-9]{2,12}$/.test(fields.prefix) || !/^[1-9][0-9]{0,8}$/.test(fields.firstNumber) || !fields.sellerRegisteredSeat || !fields.reason) { setError('Ange prefix med 2–12 stora bokstäver eller siffror, startnummer 1–999999999, registrerat säte och motivering.'); return; }
    setError(''); setReview({ kind: 'series', fields, year: page.currentYear, originalSourceHash: page.originalInvoice.sourceHash, confirmed: false });
  }
  function prepareCredit() {
    if (!superadmin || !page?.canCredit || !page.preview || !page.series) return;
    const value = reason.trim();
    if (!value || value.length > 500) { setError('Ange en motivering med högst 500 tecken.'); return; }
    setError(''); setNotice(''); setReview({ kind: 'credit', reason: value, originalSourceHash: page.originalInvoice.sourceHash, seriesId: page.series.id, seriesReviewToken: page.preview.seriesReviewToken, reviewToken: page.preview.reviewToken, confirmed: false });
  }
  async function confirm() {
    if (!superadmin || !page || !review?.confirmed || loading || denied || inFlight.current || (review.kind === 'series' ? !page.canConfigureSeries : !page.canCredit)) return;
    const scope = generation.current;
    const input = review.kind === 'series' ? { companyId, originalInvoiceId, expectedOriginalSourceHash: review.originalSourceHash, year: review.year, ...review.fields, reviewAcknowledged: true as const } : { companyId, originalInvoiceId, expectedOriginalSourceHash: review.originalSourceHash, expectedSeriesId: review.seriesId, expectedSeriesReviewToken: review.seriesReviewToken, expectedReviewToken: review.reviewToken, reason: review.reason, reviewAcknowledged: true as const };
    const fingerprint = `${review.kind}:${JSON.stringify(input)}`;
    if (!requests.current.has(fingerprint)) requests.current.set(fingerprint, crypto.randomUUID());
    const requestId = requests.current.get(fingerprint)!;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = review.kind === 'series' ? await configureAdvertisingCreditSeriesAction({ ...input, requestId } as Parameters<typeof configureAdvertisingCreditSeriesAction>[0]) : await issueAdvertisingCreditInvoiceAction({ ...input, requestId } as Parameters<typeof issueAdvertisingCreditInvoiceAction>[0]);
      if (!alive.current || generation.current !== scope) return;
      if (!result.ok) { failure(result); if (result.code === 'conflict') { setPage(null); setReview(null); setEditor(null); setNotice('Nummer, datum eller kreditering har ändrats. Granska de senaste uppgifterna innan du fortsätter.'); setRefresh(value => value + 1); } return; }
      const receipt = result.receipt;
      if (receipt.companyId !== companyId || receipt.actorUserId !== userId || receipt.requestId !== requestId || receipt.originalInvoiceId !== originalInvoiceId || receipt.originalSourceHash !== review.originalSourceHash) { failure({ code: 'access_denied', message: 'Kvittot kunde inte verifieras för aktuellt företag och originalfaktura.' }); return; }
      setPage(null); setReview(null); setEditor(null); setReason(''); setNotice(review.kind === 'series' ? 'Nummerserien är konfigurerad. Granska kreditfakturan innan den utfärdas.' : 'Kreditfakturan är utfärdad och bevarad. Originalfakturan finns kvar.'); setRefresh(value => value + 1);
    } catch { if (alive.current && generation.current === scope) setError('Åtgärdens resultat är okänt. Försök samma bekräftelse igen för att kontrollera den sparade begäran.'); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  const original = page?.originalInvoice, amounts = original?.snapshot;
  return <section className="surface" aria-label="Kreditering av faktura" style={{ padding: 18, marginTop: 20, minWidth: 0 }}>
    <h4>Kreditering av faktura</h4><p>En helkreditering vänder originalfakturans exakta belopp och moms. Originalet och kreditfakturan bevaras med egna nummer. Återbetalning och utskick hanteras separat.</p>
    <button type="button" className="button button-outline" disabled={loading || busy || denied} onClick={() => { setPage(null); setReview(null); setEditor(null); setNotice(''); setRefresh(value => value + 1); }}>Uppdatera kreditering</button>
    {loading && <p role="status">Verifierar kreditering…</p>}{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {page && original && amounts && <><p>Originalfaktura: <strong>{original.invoiceNumber}</strong><br/>Fakturadatum: {original.invoiceDate}<br/>Originalets köpare: {amounts.assessment.snapshot.draft.snapshot.buyerProfile.fields.legalName}<br/>Säljare: {amounts.assessment.snapshot.draft.snapshot.sellerProfile.fields.legalName}</p>
      <dl className="detail-list"><div><dt>Kreditering exklusive moms</dt><dd>{creditAmount(amounts.netTotalOre)}</dd></div><div><dt>Krediterad moms</dt><dd>{creditAmount(amounts.vatTotalOre)}</dd></div><div><dt>Kreditering inklusive moms</dt><dd>{creditAmount(amounts.grossTotalOre)}</dd></div></dl>
      {page.blockers.length > 0 && <ul>{page.blockers.map(value => <li key={value}>{blockers[value] ?? 'En uppgift behöver kontrolleras innan kreditering.'}</li>)}</ul>}
      {page.credit ? <section aria-label="Utfärdad kreditfaktura"><h5>Kreditfaktura {page.credit.creditNumber} · Utfärdad</h5><p>Kreditdatum: {page.credit.creditDate}<br/>Avser hela originalfaktura {original.invoiceNumber}</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>Motivering: {page.credit.snapshot.reason}</p><a className="text-link" href={`/api/advertising/credits/${encodeURIComponent(page.credit.id)}/pdf${superadmin ? `?companyId=${encodeURIComponent(companyId)}` : ''}`}>Hämta PDF av kreditfaktura {page.credit.creditNumber}</a></section> : <>
        {superadmin && page.canConfigureSeries && !editor && !review && <button type="button" className="button button-outline" disabled={busy} onClick={() => setEditor({ prefix: '', firstNumber: '', sellerRegisteredSeat: '', reason: '' })}>Konfigurera nummerserie för kreditåret</button>}
        {editor && !review && <section className="workspace-form" aria-label="Nummerserie för kreditåret"><h5>Konfigurera nummerserie för {page.currentYear}</h5><p>Serien är gemensam för säljarbolagets fakturor och kreditfakturor. Kontrollera numren mot övriga faktureringssystem.</p><label>Prefix för kreditårets fakturanummer<input value={editor.prefix} maxLength={12} disabled={busy} onChange={event => setEditor({ ...editor, prefix: event.target.value })}/></label><label>Första löpnummer för kreditåret<input inputMode="numeric" value={editor.firstNumber} maxLength={9} disabled={busy} onChange={event => setEditor({ ...editor, firstNumber: event.target.value })}/></label><label>Säljarbolagets registrerade säte för kreditåret<input value={editor.sellerRegisteredSeat} maxLength={160} disabled={busy} onChange={event => setEditor({ ...editor, sellerRegisteredSeat: event.target.value })}/></label><label>Motivering till kreditårets nummerserie<textarea value={editor.reason} maxLength={500} disabled={busy} onChange={event => setEditor({ ...editor, reason: event.target.value })}/></label><button type="button" className="button button-outline" disabled={busy} onClick={prepareSeries}>Granska kreditårets nummerserie</button><button type="button" className="button button-outline" disabled={busy} onClick={() => setEditor(null)}>Avbryt konfiguration</button></section>}
        {page.preview && <section aria-label="Förhandsgranskning av kreditfaktura"><h5>Förhandsgranskning av kreditfaktura</h5><p>Kreditfakturanummer: {page.preview.creditNumber}<br/>Kreditdatum: {page.preview.creditDate}<br/>Hänvisning: {original.invoiceNumber}, {original.invoiceDate}</p></section>}
        {superadmin && page.canCredit && !review && <div className="workspace-form"><label>Motivering till helkreditering<textarea value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)}/></label><button type="button" className="button button-outline" disabled={busy} onClick={prepareCredit}>Granska helkreditering</button></div>}
        {review && <section className="workspace-form surface" aria-label="Slutgranskning av kreditering" style={{ padding: 18, marginTop: 20 }}><h5 ref={heading} tabIndex={-1}>{review.kind === 'series' ? 'Granska kreditårets nummerseriekonfiguration' : 'Bekräfta helkreditering'}</h5>{review.kind === 'series' ? <p>År: {review.year}<br/>Prefix: {review.fields.prefix}<br/>Första löpnummer: {review.fields.firstNumber}<br/>Registrerat säte: {review.fields.sellerRegisteredSeat}<br/>Motivering: {review.fields.reason}</p> : <><p>Kreditfaktura {page.preview?.creditNumber} · {page.preview?.creditDate}<br/>Originalfaktura {original.invoiceNumber} · {original.invoiceDate}<br/>Hela beloppet inklusive moms: {creditAmount(amounts.grossTotalOre)}</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>Motivering: {review.reason}</p></>}
          <label style={{ display: 'flex', alignItems: 'start', gap: 10 }}><input type="checkbox" style={{ width: 'auto' }} checked={review.confirmed} disabled={busy} onChange={event => setReview({ ...review, confirmed: event.target.checked })}/><span>{review.kind === 'series' ? 'Jag har granskat säljarbolaget, året, prefixet, startnumret och sätet. Serien och numren kolliderar inte med bolagets övriga faktureringssystem.' : acknowledgement}</span></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}><button type="button" className="button button-green" disabled={busy || !review.confirmed} onClick={() => void confirm()}>{review.kind === 'series' ? 'Bekräfta kreditårets nummerserie' : 'Utfärda kreditfakturan'}</button><button type="button" className="button button-outline" disabled={busy} onClick={() => setReview(null)}>Avbryt granskning av kreditering</button></div>
        </section>}
      </>}
    </>}
  </section>;
}
