'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { createOfferVersionAction, listDealOffersAction, type OfferSummary } from '@/lib/data/offer-actions';
import { archiveOfferAction } from '@/lib/data/offer-archive-actions';

const DealerOfferReviews = dynamic(() => import('./dealer-offer-reviews').then(module => module.DealerOfferReviews), { loading: () => <p role="status">Hämtar kundgranskningen…</p> });

export type DealOffersProps = { dealId: string; canCreate: boolean; canArchive?: boolean; companyId?: string; demo?: boolean; demoOffers?: OfferSummary[] };
const emptyDemoOffers: OfferSummary[] = [];

function localDateAfter(days: number): string {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function money(value: string) { const amount = BigInt(value); return `${(amount / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${(amount % BigInt(100)).toString().padStart(2, '0')} kr`; }

export function DealOffers({ dealId, canCreate, canArchive = false, companyId, demo = false, demoOffers = emptyDemoOffers }: DealOffersProps) {
  const fieldId = useId();
  const [offers, setOffers] = useState<OfferSummary[]>(demo ? demoOffers : []);
  const [resolvedCompany, setResolvedCompany] = useState(companyId);
  const [nextVersion, setNextVersion] = useState<number | undefined>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [lastOffer, setLastOffer] = useState<string>();
  const [terms, setTerms] = useState('');
  const [validUntil, setValidUntil] = useState(() => localDateAfter(30));
  const [grossConfirmed, setGrossConfirmed] = useState(false);
  const retry = useRef<{ body: string; submission: string } | undefined>(undefined);
  const archiveRequests = useRef(new Map<string, string>());
  const [archived, setArchived] = useState<Record<string, string>>({});
  const scope = useRef({ dealId, companyId, demo });
  scope.current = { dealId, companyId, demo };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (demo) { setOffers(demoOffers); setLoading(false); return; }
    setLoading(true); setError(''); setMessage(''); setOffers([]); setArchived({}); setLastOffer(undefined); setResolvedCompany(companyId); setNextVersion(undefined); setGrossConfirmed(false);
    listDealOffersAction(dealId, companyId).then((result) => {
      if (cancelled) return;
      if (result.ok) { setOffers(result.offers ?? []); setResolvedCompany(result.companyId); setNextVersion(result.nextBeforeVersion); }
      else setError(result.message);
    }).catch(() => { if (!cancelled) setError('Offertversionerna kunde inte hämtas. Försök igen.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, dealId, companyId, demo, demoOffers]);

  function refresh(older = false) {
    if (demo) return;
    startTransition(async () => {
      try {
        const result = await listDealOffersAction(dealId, resolvedCompany, older ? nextVersion : undefined);
        if (!result.ok) { setError(result.message); return; }
        setOffers((current) => older ? [...current, ...(result.offers ?? [])].filter((offer, index, all) => all.findIndex((row) => row.id === offer.id) === index) : result.offers ?? []);
        setResolvedCompany(result.companyId); setNextVersion(result.nextBeforeVersion); setError('');
      } catch { setError('Offertversionerna kunde inte hämtas. Försök igen.'); }
    });
  }

  function submit(form: FormData) {
    if (demo || !canCreate || !resolvedCompany || !grossConfirmed) return;
    form.set('deal_id', dealId); form.set('company_id', resolvedCompany);
    const body = JSON.stringify([dealId, resolvedCompany, form.get('terms'), form.get('valid_until'), form.get('gross_confirmed')]);
    if (retry.current?.body !== body) retry.current = { body, submission: crypto.randomUUID() };
    form.set('submission_id', retry.current.submission);
    startTransition(async () => {
      setError(''); setMessage('');
      try {
        const result = await createOfferVersionAction(form);
        if (!result.ok) { setError(result.message); return; }
        setMessage(result.message); setLastOffer(result.offerId); setGrossConfirmed(false); retry.current = undefined;
        try {
          const list = await listDealOffersAction(dealId, resolvedCompany);
          if (list.ok) { setOffers(list.offers ?? []); setNextVersion(list.nextBeforeVersion); }
          else setError(list.message);
        } catch { setError('Offerten är sparad, men versionslistan kunde inte uppdateras. Hämta den sparade offerten eller uppdatera listan.'); }
      } catch { setError('Sparandet kunde inte bekräftas. Försök igen med samma underlag; en bekräftad offert skapas inte dubbelt.'); }
    });
  }

  function archiveOffer(offerId: string) {
    if (demo || !canArchive || !resolvedCompany || pending || loading) return;
    const company = resolvedCompany;
    const startedScope = scope.current;
    const requestKey = `${company}/${offerId}`;
    let submissionId = archiveRequests.current.get(requestKey);
    if (!submissionId) {
      submissionId = crypto.randomUUID();
      archiveRequests.current.set(requestKey, submissionId);
    }
    const currentScope = () => scope.current.dealId === startedScope.dealId && scope.current.companyId === startedScope.companyId && scope.current.demo === startedScope.demo;
    startTransition(async () => {
      setError(''); setMessage('');
      try {
        const result = await archiveOfferAction({ offerId, companyId: company, submissionId });
        if (!currentScope()) return;
        if (!result.ok || !result.documentId || result.offerId !== offerId || result.companyId !== company || result.status !== 'archived') {
          setError(result.message || 'Arkiveringen kunde inte bekräftas. Försök igen med samma offertversion.');
          return;
        }
        setArchived((current) => ({ ...current, [offerId]: result.documentId! }));
        setMessage(result.message);
      } catch {
        if (currentScope()) setError('Arkiveringen kunde inte bekräftas. Försök igen med samma offertversion.');
      }
    });
  }

  return <details style={{ marginTop: 16 }} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary id={`${fieldId}-heading`}><strong>Offertversioner</strong></summary>
    {open && <section aria-labelledby={`${fieldId}-heading`} style={{ paddingTop: 12 }}>
    <p className="muted">Sparade versioner behåller kund, fordon, pris, momsmodell och villkor från när offerten skapades.</p>
    {demo && <p className="muted">Demoläge · läsvisning. Offertversioner och PDF-filer skapas först i ett inloggat företagskonto.</p>}
    {loading && <p role="status">Hämtar offertversioner…</p>}
    {!loading && !offers.length && <p className="muted">Inga offertversioner har sparats för affären.</p>}
    {!!offers.length && <ul style={{ paddingLeft: 20 }}>{offers.map((offer) => <li key={offer.id} style={{ marginBottom: 10 }}>
      <strong>Version {offer.version}</strong> · Totalpris inklusive eventuell moms: {money(offer.salePriceOre)} · Giltig till {offer.validUntil} · {offer.vatScheme === 'standard' ? 'Standardmoms' : offer.vatScheme === 'vmb' ? 'VMB' : 'Moms ej klassificerad'}{' '}
      {demo ? <span className="muted">PDF visas i företagskontot</span> : <a href={`/api/offers/${offer.id}/pdf`} download>Hämta PDF</a>}
      {!demo && canArchive && <span style={{ display: 'block', marginTop: 6 }}>
        {archived[offer.id] ? <a href={`/api/documents/${archived[offer.id]}/pdf`} download>Hämta arkiverad PDF</a> : <button type="button" className="button button-outline button-small" disabled={pending || loading || !resolvedCompany} onClick={() => archiveOffer(offer.id)}>Spara i dokumentarkivet</button>}
      </span>}
    </li>)}</ul>}
    {!demo && <button type="button" className="button button-outline button-small" disabled={pending || loading} onClick={() => refresh()}>Uppdatera versioner</button>}
    {!demo && nextVersion && <button type="button" className="button button-outline button-small" disabled={pending || loading} onClick={() => refresh(true)}>Visa äldre versioner</button>}
    {!demo && canCreate && <form onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      submit(new FormData(form));
    }} className="workspace-form" style={{ marginTop: 16 }}>
      <label htmlFor={`${fieldId}-date`}>Giltig till
      <input id={`${fieldId}-date`} name="valid_until" type="date" min={localDateAfter(0)} max={localDateAfter(90)} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} required disabled={pending} /></label>
      <label htmlFor={`${fieldId}-terms`}>Villkor · högst 2000 tecken
      <textarea id={`${fieldId}-terms`} name="terms" maxLength={2000} rows={3} value={terms} onChange={(event) => setTerms(event.target.value)} disabled={pending} /></label>
      <label htmlFor={`${fieldId}-gross`} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <input id={`${fieldId}-gross`} type="checkbox" name="gross_confirmed" value="true" required checked={grossConfirmed} onChange={(event) => setGrossConfirmed(event.target.checked)} disabled={pending} style={{ width: 'auto', marginTop: 2 }} />
        <span>Jag bekräftar att affärspriset är totalpris inklusive eventuell moms. Vid standardmoms används 25 %. Vid VMB och ej klassificerad moms redovisas moms inte separat.</span>
      </label>
      <p className="muted">Offerten innebär ingen signering eller kreditprövning och skickas inte till kunden.</p>
      <button type="submit" className="button button-green" disabled={pending || loading || !resolvedCompany || !grossConfirmed}>{pending ? 'Arbetar…' : 'Skapa ny offertversion'}</button>
    </form>}
    {!demo && !canCreate && <p className="muted">Din roll har läsbehörighet för offerterna.</p>}
    {!demo && canArchive && <p className="muted">Arkiveringen sparar den här offertversionen i företagets privata dokumentarkiv. Offerten är inte signerad.</p>}
    {message && <p role="status">{message}{lastOffer && !offers.some((offer) => offer.id === lastOffer) && <> <a href={`/api/offers/${lastOffer}/pdf`} download>Hämta den sparade offerten</a></>}</p>}
    {error && <p role="alert">{error}</p>}
    {resolvedCompany && <DealerOfferReviews key={`${resolvedCompany}:${dealId}:${canCreate}:${lastOffer ?? ''}`} companyId={resolvedCompany} dealId={dealId} canEdit={canCreate} demo={demo}/>}
    </section>}
  </details>;
}
