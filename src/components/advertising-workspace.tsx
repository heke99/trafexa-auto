'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { createAdvertisingListingAction, getAdvertisingSendQuoteAction, getStockAdvertisingAction, listAdvertisingStockAction, listAdvertisingWorkspaceAction, markAdvertisingListingReadyAction, saveAdvertisingListingAction, sendAdvertisingListingAction } from '@/lib/advertising/actions';
import { ChannelConnections, channelNames, type AdvertisingChannel } from './channel-connections';
import { VehiclePhotoGallery } from '@/components/vehicle-photo-gallery';
import type { AdvertisingWorkspacePage, AdvertisingStockPage, AdvertisingPhoto } from '@/lib/advertising/database.types';

type WorkspacePage = AdvertisingWorkspacePage & { ok: true };
type StockPage = AdvertisingStockPage & { ok: true };
type Listing = WorkspacePage['listings'][number];
type Editor = { stockId: string; listing: Listing | null; title: string; description: string; photoIds: string[]; includeRegistrationNumber: boolean };
type SendQuote = Extract<Awaited<ReturnType<typeof getAdvertisingSendQuoteAction>>, { ok: true }>['quote'];
type Review = { kind: 'ready' | 'send'; listing: Listing; channels: AdvertisingChannel[]; confirmed: boolean; quote?: SendQuote; confirmationQuote?: SendQuote };
const AdvertisingBillingPanel = dynamic(() => import('./advertising-billing-panel').then(module => module.AdvertisingBillingPanel), { loading: () => <p role="status">Läser in prisunderlag…</p> });
const AdvertisingUsagePanel = dynamic(() => import('./advertising-usage-panel').then(module => module.AdvertisingUsagePanel), { loading: () => <p role="status">Läser in annonsstatistik…</p> });
const money = (ore: string) => { const amount = BigInt(ore); return `${new Intl.NumberFormat('sv-SE').format(amount / BigInt(100))},${String(amount % BigInt(100)).padStart(2, '0')} kr`; };
const jobLabel = (status: string) => ({ queued: 'Köad för leverans', dispatching: 'Leverans pågår', published: 'Publicerad', submitted: 'Inskickad – publicering ej verifierad', retryable: 'Leverans behöver nytt försök', failed: 'Leverans misslyckades', rejected: 'Avvisad av kanal', outcome_unknown: 'Utfallet behöver avstämmas', unavailable: 'Kanalanslutning krävs' }[status] ?? status);
const dateLabel = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(value));

export function AdvertisingWorkspace({ companyId, role, userId, demo = false }: { companyId: string; role: string; userId: string; demo?: boolean }) {
  const [page, setPage] = useState<WorkspacePage | null>(null);
  const [stock, setStock] = useState<StockPage | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [photos, setPhotos] = useState<AdvertisingPhoto[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [channelBusy, setChannelBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const requests = useRef(new Map<string, string>());
  const selectedStock = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewId = useId();
  const actorRole = page?.actorRole ?? role;
  const canEdit = !demo && !denied && ['owner', 'admin', 'sales'].includes(actorRole);
  const busy = pending || channelBusy;
  const blocketSupported = (listing: Listing) => listing.snapshot.photos.every(photo => photo.contentType === 'image/jpeg' || photo.contentType === 'image/png');
  const eligible = (channel: AdvertisingChannel) => page?.channels.some(connection => connection.channel === channel && connection.status === 'verified' && connection.dispatcherAvailable === true) ?? false;
  useEffect(() => { heading.current?.focus(); }, [review?.kind, review?.confirmed, review?.listing.id]);

  function failure(result: { code: string; message: string }) {
    setError(result.message);
    if (['access_denied', 'unauthenticated'].includes(result.code)) {
      ++generation.current; setDenied(true); setPage(null); setStock(null); setEditor(null); setPhotos([]); setReview(null); setNotice(null); selectedStock.current = null;
    }
  }
  function identity(result: { companyId: string; actorUserId: string }) {
    if (result.companyId !== companyId || result.actorUserId !== userId) { failure({ code: 'access_denied', message: 'Företaget eller användarsessionen har ändrats. Läs in arbetsytan på nytt.' }); return false; }
    return true;
  }
  async function readSelected(requestGeneration: number, stockId: string) {
    const result = await getStockAdvertisingAction({ companyId, stockItemId: stockId });
    if (generation.current !== requestGeneration || selectedStock.current !== stockId) return false;
    if (!result.ok) { setEditor(null); failure(result); return false; }
    if (!identity(result)) return false;
    setPage(previous => previous ? { ...previous, actorRole: result.actorRole } : previous);
    const listing = result.listing;
    const choice = stock?.stock.find(item => item.id === stockId);
    setEditor({ stockId, listing, title: listing?.snapshot.title ?? (choice ? `${choice.make} ${choice.model}`.slice(0, 160) : ''), description: listing?.snapshot.description ?? '', photoIds: listing?.snapshot.photos.map(photo => photo.id) ?? [], includeRegistrationNumber: listing?.snapshot.includeRegistrationNumber ?? false });
    return true;
  }
  async function readCurrent(requestGeneration: number, append: 'listings' | 'jobs' | null = null, previous?: WorkspacePage | null, includeStock = false) {
    const result = await listAdvertisingWorkspaceAction({ companyId, pageKey: append === 'listings' ? previous?.nextPageKey : null, jobsPageKey: append === 'jobs' ? previous?.nextJobsPageKey : null, limit: 50 });
    if (generation.current !== requestGeneration) return false;
    if (!result.ok) { setPage(null); setEditor(null); failure(result); return false; }
    if (!identity(result)) return false;
    setPage(current => append && current ? { ...result,
      listings: append === 'listings' ? [...current.listings, ...result.listings.filter(listing => !current.listings.some(item => item.id === listing.id))] : current.listings,
      jobs: append === 'jobs' ? [...current.jobs, ...result.jobs.filter(job => !current.jobs.some(item => item.id === job.id))] : current.jobs,
      nextPageKey: append === 'listings' ? result.nextPageKey : current.nextPageKey,
      nextJobsPageKey: append === 'jobs' ? result.nextJobsPageKey : current.nextJobsPageKey,
    } : result);
    if (includeStock) {
      const choices = await listAdvertisingStockAction({ companyId, limit: 50 });
      if (generation.current !== requestGeneration) return false;
      if (!choices.ok) { setStock(null); setPage(null); setEditor(null); failure(choices); return false; }
      if (!identity(choices)) return false;
      setStock(choices);
      setPage(previous => previous ? { ...previous, actorRole: choices.actorRole } : previous);
    }
    return true;
  }
  function load(append: 'listings' | 'jobs' | null = null) {
    if (demo || denied || inFlight.current || channelBusy) return;
    const requestGeneration = ++generation.current;
    inFlight.current = true; setReview(null); setError(null); setNotice(null);
    startTransition(async () => {
      try { const loaded = await readCurrent(requestGeneration, append, page, !append); if (loaded && !append && selectedStock.current) await readSelected(requestGeneration, selectedStock.current); }
      catch { if (generation.current === requestGeneration) { setPage(null); setStock(null); setEditor(null); setError('Annonskontot kunde inte verifieras. Uppdatera för att läsa in aktuell data.'); } }
      finally { if (generation.current === requestGeneration) inFlight.current = false; }
    });
  }
  useEffect(() => {
    const requestGeneration = ++generation.current;
    setPage(null); setStock(null); setEditor(null); setPhotos([]); setReview(null); setDenied(false); setError(null); setNotice(null); selectedStock.current = null;
    if (demo) return () => { ++generation.current; };
    inFlight.current = true;
    startTransition(async () => {
      try { await readCurrent(requestGeneration, null, null, true); }
      catch { if (generation.current === requestGeneration) setError('Annonskontot kunde inte verifieras. Uppdatera listan.'); }
      finally { if (generation.current === requestGeneration) inFlight.current = false; }
    });
    return () => { ++generation.current; };
  }, [companyId, role, userId, demo]);
  function chooseStock(stockId: string) {
    if (busy || denied || demo || inFlight.current) return;
    const requestGeneration = ++generation.current;
    selectedStock.current = stockId || null; setReview(null); setEditor(null); setPhotos([]); setError(null); setNotice(null);
    if (!stockId) return;
    inFlight.current = true;
    startTransition(async () => {
      try { await readSelected(requestGeneration, stockId); }
      catch { if (generation.current === requestGeneration) setError('Bilens annonsunderlag kunde inte läsas in. Välj bilen igen.'); }
      finally { if (generation.current === requestGeneration) inFlight.current = false; }
    });
  }
  function moreStock() {
    if (!stock?.nextPageKey || busy || denied || inFlight.current) return;
    const requestGeneration = ++generation.current;
    inFlight.current = true; setReview(null); setError(null);
    startTransition(async () => {
      try {
        const result = await listAdvertisingStockAction({ companyId, pageKey: stock.nextPageKey, limit: 50 });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { setStock(null); setEditor(null); failure(result); return; }
        if (!identity(result)) return;
        setStock(previous => previous ? { ...result, stock: [...previous.stock, ...result.stock.filter(choice => !previous.stock.some(item => item.id === choice.id))] } : result);
      } catch { if (generation.current === requestGeneration) { setStock(null); setEditor(null); setError('Lagerbilarna kunde inte verifieras. Uppdatera arbetsytan.'); } }
      finally { if (generation.current === requestGeneration) inFlight.current = false; }
    });
  }
  function nonce(payload: object) { const fingerprint = JSON.stringify(payload); if (!requests.current.has(fingerprint)) requests.current.set(fingerprint, crypto.randomUUID()); return requests.current.get(fingerprint)!; }
  async function reloadAfterReceipt(requestGeneration: number) {
    setPage(null); setEditor(null);
    const loaded = await readCurrent(requestGeneration, null, null, true);
    if (!loaded) return false;
    if (selectedStock.current) return readSelected(requestGeneration, selectedStock.current);
    return true;
  }
  function saveDraft() {
    if (!editor || !canEdit || busy || inFlight.current || !editor.title.trim() || editor.photoIds.length > 20) return;
    const selected = editor;
    const payload = { companyId, stockItemId: selected.stockId, title: selected.title.trim(), description: selected.description, photoIds: selected.photoIds, includeRegistrationNumber: selected.includeRegistrationNumber };
    const requestId = nonce({ kind: selected.listing ? 'save' : 'create', ...payload, listingId: selected.listing?.id, expectedVersion: selected.listing?.version });
    const requestGeneration = ++generation.current;
    inFlight.current = true; setError(null); setNotice(null); setReview(null);
    startTransition(async () => {
      let received = false;
      try {
        const result = selected.listing ? await saveAdvertisingListingAction({ ...payload, listingId: selected.listing.id, expectedVersion: selected.listing.version, requestId }) : await createAdvertisingListingAction({ ...payload, requestId });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { failure(result); return; }
        received = true;
        if (await reloadAfterReceipt(requestGeneration)) setNotice('Annonsutkastet har sparats. Den aktuella versionen har lästs in på nytt.');
      } catch {
        if (generation.current === requestGeneration) { if (received) { setPage(null); setEditor(null); setError('Utkastet har sparats, men aktuell version kunde inte verifieras. Uppdatera annonskontot.'); } else setError('Svaret kunde inte verifieras. Spara igen med samma uppgifter och samma begäran.'); }
      } finally { if (generation.current === requestGeneration) inFlight.current = false; }
    });
  }
  function quoteMatches(result: Extract<Awaited<ReturnType<typeof getAdvertisingSendQuoteAction>>, { ok: true }>, listing: Listing, channels: AdvertisingChannel[]) {
    if (!identity(result)) return false;
    const quote = result.quote;
    if (result.actorRole !== actorRole || quote.companyId !== companyId || quote.actorUserId !== userId || quote.listingId !== listing.id || quote.listingVersion !== listing.version || JSON.stringify(quote.channels) !== JSON.stringify([...channels].sort())) {
      failure({ code: 'access_denied', message: 'Företaget, annonsversionen eller behörigheten har ändrats. Läs in annonskontot på nytt.' }); return false;
    }
    return true;
  }
  function openSend(listing: Listing) {
    if (!canEdit || busy || inFlight.current) return;
    const requestGeneration = ++generation.current;
    inFlight.current = true; setError(null); setNotice(null);
    setReview({ kind: 'send', listing, channels: [], confirmed: false });
    startTransition(async () => {
      try {
        const channels: AdvertisingChannel[] = ['blocket', 'wayke'];
        const result = await getAdvertisingSendQuoteAction({ companyId, listingId: listing.id, expectedVersion: listing.version, channels });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { setReview(null); failure(result); return; }
        if (!quoteMatches(result, listing, channels)) return;
        setReview({ kind: 'send', listing, channels: [], confirmed: false, quote: result.quote });
      } catch { if (generation.current === requestGeneration) { setReview(null); setError('Kanalpriserna kunde inte verifieras. Förbered kanalutskicket på nytt.'); } }
      finally { if (generation.current === requestGeneration) inFlight.current = false; }
    });
  }
  function prepareConfirmation() {
    if (!review || busy || inFlight.current) return;
    if (review.kind === 'ready') { setReview({ ...review, confirmed: true }); return; }
    if (!review.channels.length || !review.quote || review.channels.some(channel => review.quote!.items.find(item => item.channel === channel)?.chargeOre == null)) return;
    const selected = review;
    const channels = [...selected.channels].sort();
    const requestGeneration = ++generation.current;
    inFlight.current = true; setError(null);
    startTransition(async () => {
      try {
        const result = await getAdvertisingSendQuoteAction({ companyId, listingId: selected.listing.id, expectedVersion: selected.listing.version, channels });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { setReview(null); failure(result); return; }
        if (!quoteMatches(result, selected.listing, channels)) return;
        if (result.quote.totalOre === null) { setReview(null); setError('Pris saknas för en vald kanal. Förbered kanalutskicket på nytt när priset är registrerat.'); return; }
        setReview({ ...selected, confirmed: true, confirmationQuote: result.quote });
      } catch { if (generation.current === requestGeneration) setError('Priset kunde inte verifieras. Fortsätt till bekräftelse igen för att läsa aktuella priser.'); }
      finally { if (generation.current === requestGeneration) inFlight.current = false; }
    });
  }
  function commitReview() {
    if (!review?.confirmed || !canEdit || busy || inFlight.current || (review.kind === 'send' && (!review.confirmationQuote || review.confirmationQuote.totalOre === null || !review.channels.length || (review.channels.includes('blocket') && !blocketSupported(review.listing))))) return;
    const selected = review;
    const payload = { companyId, listingId: selected.listing.id, expectedVersion: selected.listing.version };
    const channels = [...selected.channels].sort();
    const expectedQuoteToken = selected.confirmationQuote?.reviewToken;
    const requestId = nonce({ kind: selected.kind, ...payload, channels, expectedQuoteToken });
    const requestGeneration = ++generation.current;
    inFlight.current = true; setError(null); setNotice(null);
    startTransition(async () => {
      let received = false;
      try {
        const result = selected.kind === 'ready' ? await markAdvertisingListingReadyAction({ ...payload, requestId }) : await sendAdvertisingListingAction({ ...payload, channels, expectedQuoteToken: expectedQuoteToken!, requestId });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { if (selected.kind === 'send' && result.code === 'conflict') { setReview(null); setError('Priset eller annonsunderlaget har ändrats. Förbered kanalutskicket på nytt och granska priset igen.'); } else failure(result); return; }
        received = true; setReview(null);
        if (await reloadAfterReceipt(requestGeneration)) setNotice(selected.kind === 'ready' ? 'Annonsversionen är klar för granskning inför kanalutskick.' : `Utskicket har registrerats med ${money(selected.confirmationQuote!.totalOre!)} exklusive moms i granskat prisunderlag. Avgift registreras först för verifierad unik publicering. Se jobbstatusen nedan; köad betyder inte publicerad.`);
      } catch {
        if (generation.current === requestGeneration) { if (received) { setPage(null); setEditor(null); setError('Åtgärden har registrerats, men aktuell status kunde inte verifieras. Uppdatera annonskontot.'); } else setError('Svaret kunde inte verifieras. Bekräfta igen med samma annonsversion, kanaler och begäran.'); }
      } finally { if (generation.current === requestGeneration) inFlight.current = false; }
    });
  }
  const dirty = editor?.listing && (editor.title !== editor.listing.snapshot.title || editor.description !== editor.listing.snapshot.description || editor.includeRegistrationNumber !== editor.listing.snapshot.includeRegistrationNumber || JSON.stringify(editor.photoIds) !== JSON.stringify(editor.listing.snapshot.photos.map(photo => photo.id)));
  if (demo) return <section className="surface"><div className="empty-state"><h2>Annonskonto</h2><p>Demonstration med exempeldata. Företagets annonser och kanalanslutningar visas i det inloggade företagskontot.</p></div></section>;
  return <section aria-label="Annonskonto"><div className="surface"><div className="panel-heading"><h2>Företagets annonser</h2><button type="button" className="text-link" disabled={busy || denied} onClick={() => load()}>Uppdatera annonskonto</button></div>
    {!denied && page && ['owner', 'admin', 'finance'].includes(actorRole) && <button type="button" className="text-link" aria-expanded={showUsage} onClick={() => setShowUsage(value => !value)}>{showUsage ? 'Dölj statistik och faktureringsunderlag' : 'Visa statistik och faktureringsunderlag'}</button>}
    <p className="settings-note">Skapa annonsunderlag från lagrets biluppgifter och bilder. Ett sparat utkast eller köat leveransjobb är ingen publicerad annons.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}{pending && <p role="status">Verifierar annonskontot…</p>}
    {!denied && page && <><div className="table-scroll"><table className="data-table"><caption className="sr-only">Annonsutkast och färdiga annonsversioner</caption><thead><tr><th scope="col">Annons</th><th scope="col">Pris från lager</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Åtgärd</th></tr></thead><tbody>{page.listings.map(listing => <tr key={listing.id}><td><strong>{listing.snapshot.title}</strong></td><td>{money(listing.snapshot.priceGrossOre)}</td><td>{listing.version}</td><td>{listing.status === 'ready' ? 'Klar annonsversion' : 'Utkast'}</td><td><button type="button" className="text-link" disabled={busy} onClick={() => chooseStock(listing.stockId)}>Visa annons<span className="sr-only"> {listing.snapshot.title}</span></button></td></tr>)}</tbody></table></div>{!page.listings.length && <p className="quiet-empty">Inga annonsutkast ännu. Välj en lagerbil för att skapa underlaget.</p>}<div className="table-footer"><span>{page.listings.length} annonser inlästa</span>{page.nextPageKey && <button type="button" className="text-link" disabled={busy} onClick={() => load('listings')}>Läs in fler annonser</button>}</div></>}
    {!denied && stock && <div className="workspace-form" style={{ padding: 20 }}><label>Välj lagerbil<select value={editor?.stockId ?? ''} disabled={busy} onChange={event => chooseStock(event.target.value)}><option value="">Välj en bil från företagets lager</option>{stock.stock.map(choice => <option key={choice.id} value={choice.id}>{choice.make} {choice.model} · {choice.year} · {money(choice.priceGrossOre)}</option>)}</select></label>{stock.nextPageKey && <button type="button" className="text-link" disabled={busy} onClick={moreStock}>Läs in fler lagerbilar</button>}</div>}
  </div>
    {!denied && page && showUsage && ['owner', 'admin', 'finance'].includes(actorRole) && <><AdvertisingUsagePanel key={`${companyId}:${userId}:${actorRole}`} companyId={companyId} userId={userId} role={actorRole} onDenied={message => failure({ code: 'access_denied', message })}/><AdvertisingBillingPanel companyId={companyId} userId={userId} role={actorRole} onDenied={message => failure({ code: 'access_denied', message })}/></>}
    {!denied && editor && <section className="surface" style={{ marginTop: 24 }} aria-label="Annonseditor"><div className="panel-heading"><h2>{editor.listing ? `Annonsversion ${editor.listing.version}` : 'Nytt annonsutkast'}</h2></div><form className="workspace-form" style={{ padding: 20 }} onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) saveDraft(); }}>
      <label>Annonstitel<input type="text" required maxLength={160} value={editor.title} disabled={busy || !canEdit} onChange={event => { setEditor({ ...editor, title: event.target.value }); setReview(null); }}/></label><label>Annonsbeskrivning<textarea rows={5} maxLength={5000} value={editor.description} disabled={busy || !canEdit} onChange={event => { setEditor({ ...editor, description: event.target.value }); setReview(null); }}/></label>
      <p>Annonspris från fordonslagret: <strong>{editor.listing ? money(editor.listing.snapshot.priceGrossOre) : stock?.stock.find(choice => choice.id === editor.stockId) ? money(stock.stock.find(choice => choice.id === editor.stockId)!.priceGrossOre) : 'Läses från lagret vid sparande'}</strong></p><p className="form-privacy">Priset hämtas från bilens försäljningspris vid sparande. Ändra priset i fordonslagret. Annonsen innehåller inte interna inköpspriser, kostnader eller kunduppgifter.</p>
      <label className="auth-checkbox"><input type="checkbox" checked={editor.includeRegistrationNumber} disabled={busy || !canEdit} onChange={event => { setEditor({ ...editor, includeRegistrationNumber: event.target.checked }); setReview(null); }}/><span>Ta med registreringsnummer i annonsen</span></label><p className="form-privacy">Registreringsnumret delas bara när du väljer det här. VIN ingår aldrig i annonsunderlaget.</p>
      <VehiclePhotoGallery key={editor.stockId} companyId={companyId} stockId={editor.stockId} canEdit={false} onPhotosChange={setPhotos}/>
      <fieldset disabled={busy || !canEdit} style={{ border: 0, padding: 0 }}><legend>Välj annonsbilder · högst 20</legend>{photos.filter(photo => photo.status === 'active').map((photo, index) => <label className="auth-checkbox" key={photo.id}><input type="checkbox" checked={editor.photoIds.includes(photo.id)} disabled={!editor.photoIds.includes(photo.id) && editor.photoIds.length >= 20} onChange={event => { setEditor({ ...editor, photoIds: event.target.checked ? [...editor.photoIds, photo.id] : editor.photoIds.filter(id => id !== photo.id) }); setReview(null); }}/><span>Bild {index + 1} · {photo.contentType === 'image/jpeg' ? 'JPEG' : photo.contentType === 'image/png' ? 'PNG' : 'WebP'}{editor.photoIds[0] === photo.id && ' · huvudbild'}</span></label>)}</fieldset><p className="form-privacy">{editor.photoIds.length} bilder valda. Den först valda bilden är huvudbild. Ta bort och välj bilder igen för att ändra ordningen.</p>{canEdit && editor.photoIds.length > 0 && <button type="button" className="text-link" disabled={busy} onClick={() => { setEditor({ ...editor, photoIds: [] }); setReview(null); }}>Rensa bildval</button>}
      {canEdit ? <button type="submit" className="button button-green" disabled={busy}>{editor.listing ? 'Spara ny utkastversion' : 'Skapa annonsutkast'}</button> : <p className="settings-note">Din roll har läsbehörighet för annonserna.</p>}
      {dirty && <p className="form-privacy">Spara ändringarna som en ny utkastversion före granskning.</p>}
      {editor.listing && <div className="table-controls" style={{ flexWrap: 'wrap' }}>{canEdit && editor.listing.status === 'draft' && <button type="button" className="button button-outline" disabled={busy || !!dirty || !editor.listing.snapshot.photos.length} onClick={() => { if (editor.listing) setReview({ kind: 'ready', listing: editor.listing, channels: [], confirmed: false }); }}>Granska annonsversion</button>}{canEdit && editor.listing.status === 'ready' && <button type="button" className="button button-green" disabled={busy || !!dirty} onClick={() => { if (editor.listing) openSend(editor.listing); }}>Förbered kanalutskick</button>}</div>}
    </form></section>}
    {!denied && review && <section className="surface" style={{ marginTop: 24 }} aria-labelledby={reviewId}><div className="panel-heading"><h2 id={reviewId} ref={heading} tabIndex={-1}>{review.confirmed ? 'Bekräfta annonsversionen' : 'Granska annonsversionen'}</h2></div><div className="dialog-content"><SnapshotPreview listing={review.listing}/>
      {review.kind === 'send' && <>
        <p>Annonsavgift i SEK exklusive moms per första verifierade unika publicering och kanal. Uppdateringar och nya leveransförsök ger ingen ny avgift.</p>
        {!review.quote && <p role="status">Verifierar kanalpriser…</p>}
        <fieldset disabled={busy || review.confirmed} style={{ border: 0, padding: 0 }}><legend>Välj annonskanaler</legend>{(['blocket', 'wayke'] as const).map(channel => {
          const item = (review.confirmed ? review.confirmationQuote : review.quote)?.items.find(item => item.channel === channel);
          const status = !eligible(channel) ? page?.channels.some(item => item.channel === channel && item.status === 'verified') ? ' · leverans ej aktiverad' : ' · anslutning krävs' : '';
          const mediaStatus = channel === 'blocket' && !blocketSupported(review.listing) ? ' · vald WebP-bild stöds inte' : '';
          return <div key={channel} style={{ marginBottom: 12 }}><label className="auth-checkbox"><input type="checkbox" aria-label={`${channelNames[channel]}${status}${mediaStatus}`} aria-describedby={`${reviewId}-${channel}-price`} checked={review.channels.includes(channel)} disabled={!eligible(channel) || !item || item.chargeOre === null || !!mediaStatus} onChange={event => setReview({ ...review, channels: event.target.checked ? [...review.channels, channel] : review.channels.filter(item => item !== channel), confirmationQuote: undefined })}/><span>{channelNames[channel]}{status}{mediaStatus}</span></label>
            <p id={`${reviewId}-${channel}-price`} className="settings-note" style={{ marginLeft: 30 }}>{!item ? review.confirmed ? 'Ej vald kanal' : 'Pris verifieras' : item.chargeOre === null ? 'Pris saknas · kanalen kan inte väljas' : item.alreadyPublished ? 'Ingen ny avgift · publiceringen är redan registrerad' : `${money(item.chargeOre)} exkl. moms per unik publicering`}</p></div>;
        })}</fieldset>
        {!(['blocket', 'wayke'] as const).some(eligible) && <p className="notice">Ingen kanal är klar för leverans. <a href="#advertising-connections">Anslut kanal</a> och invänta verifierad anslutning.</p>}
        {!blocketSupported(review.listing) && <p className="form-privacy">Blocket kräver JPEG eller PNG. Välj sådana bilder för ett framtida Blocket-utskick; inga bilder konverteras automatiskt.</p>}
        <p>Valda kanaler: {review.channels.map(channel => channelNames[channel]).join(', ') || 'Ingen vald'}</p>
        <p><strong>Summa för valda kanaler: {review.confirmed ? money(review.confirmationQuote!.totalOre!) : money(review.channels.reduce((sum, channel) => sum + BigInt(review.quote?.items.find(item => item.channel === channel)?.chargeOre ?? '0'), BigInt(0)).toString())} exkl. moms</strong></p>
        {review.confirmed && <p role="status">Aktuella priser har lästs in för dina valda kanaler. Granska beloppen ovan innan du bekräftar kanalutskicket.</p>}
        <p className="form-privacy">Utskicket gäller exakt den granskade versionen och de granskade priserna. Ingen avgift registreras för ett enbart köat, avvisat eller okänt leveransutfall. Ett köat jobb är inte bevis på publicering.</p>
      </>}

      <div className="table-controls" style={{ flexWrap: 'wrap' }}><button type="button" className="button button-green" disabled={busy || (review.kind === 'send' && !review.channels.length)} onClick={() => review.confirmed ? commitReview() : prepareConfirmation()}>{review.confirmed ? review.kind === 'ready' ? 'Markera annonsversion klar' : 'Bekräfta kanalutskick' : 'Fortsätt till bekräftelse'}</button>{review.confirmed && <button type="button" className="button button-outline" disabled={busy} onClick={() => setReview({ ...review, confirmed: false, confirmationQuote: undefined })}>Tillbaka till granskning</button>}<button type="button" className="text-link" disabled={busy} onClick={() => setReview(null)}>Avbryt</button></div>
    </div></section>}
    {!denied && page && <><section className="surface" style={{ marginTop: 24 }} aria-label="Annonsleveranser"><div className="panel-heading"><h2>Jobbhistorik</h2></div><div className="table-scroll"><table className="data-table"><caption className="sr-only">Faktiska jobb för kanalleverans</caption><thead><tr><th scope="col">Kanal</th><th scope="col">Annonsversion</th><th scope="col">Status</th><th scope="col">Registrerat</th><th scope="col">Annonslänk</th></tr></thead><tbody>{page.jobs.map(job => <tr key={job.id}><td>{channelNames[job.channel]}</td><td>{job.listingVersion}</td><td>{jobLabel(job.status)}</td><td>{dateLabel(job.createdAt)}</td><td>{job.status === 'published' && job.providerUrl ? <a href={job.providerUrl} target="_blank" rel="noopener noreferrer">Visa på {channelNames[job.channel]}</a> : '—'}</td></tr>)}</tbody></table></div>{!page.jobs.length && <p className="quiet-empty">Inga leveransjobb registrerade.</p>}<div className="table-footer"><span>{page.jobs.length} jobb inlästa</span>{page.nextJobsPageKey && <button type="button" className="text-link" disabled={busy} onClick={() => load('jobs')}>Läs in fler jobb</button>}</div></section>
      <ChannelConnections companyId={companyId} role={actorRole} userId={userId} connections={page.channels} disabled={pending || denied} onBusyChange={setChannelBusy} onDenied={message => failure({ code: 'access_denied', message })} onSaved={async () => { const requestGeneration = ++generation.current; setReview(null); setPage(null); setEditor(null); return readCurrent(requestGeneration, null, null, true); }}/></>}
  </section>;
}

function SnapshotPreview({ listing }: { listing: Listing }) {
  return <section aria-label="Låst annonsunderlag"><h3>{listing.snapshot.title}</h3><p>Version {listing.version} · {listing.status === 'ready' ? 'Klar annonsversion' : 'Utkast'}</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{listing.snapshot.description || 'Ingen beskrivning'}</p><dl className="detail-list"><div><dt>Fordon</dt><dd>{listing.snapshot.make} {listing.snapshot.model}</dd></div><div><dt>Årsmodell</dt><dd>{listing.snapshot.year}</dd></div><div><dt>Miltal</dt><dd>{new Intl.NumberFormat('sv-SE').format(listing.snapshot.mileageKm / 10)} mil</dd></div><div><dt>Pris inklusive eventuell moms</dt><dd>{money(listing.snapshot.priceGrossOre)}</dd></div><div><dt>Registreringsnummer</dt><dd>{listing.snapshot.includeRegistrationNumber ? listing.snapshot.registrationNumber ?? 'Saknas i underlaget' : 'Delas inte'}</dd></div><div><dt>Valda bilder</dt><dd>{listing.snapshot.photos.length} av högst 20</dd></div></dl><div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{listing.snapshot.photos.map((photo, index) => <figure key={photo.id} style={{ margin: 0 }}><img src={`/api/vehicle-photos/${photo.id}`} width={144} height={108} alt={`${listing.snapshot.make} ${listing.snapshot.model}, annonsbild ${index + 1}`} style={{ objectFit: 'cover' }}/><figcaption>Bild {index + 1}{index === 0 && ' · huvudbild'}</figcaption></figure>)}</div></section>;
}
