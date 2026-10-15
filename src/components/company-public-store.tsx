'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { getCompanyPublicStoreAction, publishCompanyPublicStoreAction, unpublishCompanyPublicStoreAction } from '@/lib/public-dealer-store/actions';
import { getCompanyStoreProfileAction } from '@/lib/data/company-store-profile-actions';
import { listAdvertisingWorkspaceAction } from '@/lib/advertising/actions';
import type { CompanyStoreProfilePage } from '@/lib/company-store-profile/types';
import type { AdvertisingListing } from '@/lib/advertising/database.types';

type Props = { companyId: string; userId: string; role: string; demo?: boolean };
type Store = import('@/lib/public-dealer-store/types').PublicStoreState;
type Review = { kind: 'publish'; slug: string; expectedVersion: number; profile: CompanyStoreProfilePage; listings: AdvertisingListing[] } | { kind: 'unpublish'; slug: string; expectedVersion: number };
const reservedSlugs = new Set(['api','admin','dashboard','login','register','settings','onboarding','privacy','terms','demo','invitations','butik','butiker','stores','trafexa','www','support','help','auth','account','billing']);
const slugValid = (value: string) => /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(value) && !reservedSlugs.has(value);
const money = (value: string) => { const n = BigInt(value); return `${(n / BigInt(100)).toLocaleString('sv-SE')},${(n % BigInt(100)).toString().padStart(2, '0')} kr`; };
function failureMessage(value: { message?: string; error?: string }) { return value.message ?? value.error ?? 'Uppgifterna kunde inte verifieras.'; }

export function CompanyPublicStore(props: Props) { return <PublicStorePanel key={`${props.companyId}:${props.userId}:${props.role}:${!!props.demo}`} {...props}/>; }
function PublicStorePanel({ companyId, userId, role, demo = false }: Props) {
  const [open, setOpen] = useState(false), [loaded, setLoaded] = useState(false), [sourcesReady, setSourcesReady] = useState(false), [store, setStore] = useState<Store | null>(null), [profile, setProfile] = useState<CompanyStoreProfilePage | null>(null);
  const [listings, setListings] = useState<AdvertisingListing[]>([]), [cursor, setCursor] = useState<string | null>(null), [selection, setSelection] = useState<string[]>([]), [slug, setSlug] = useState('');
  const [review, setReview] = useState<Review | null>(null), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const live = useRef(true), generation = useRef(0), lock = useRef(false), nonces = useRef(new Map<string, string>()), heading = useRef<HTMLHeadingElement>(null), id = useId();
  const allowed = !demo && ['owner', 'admin'].includes(role) && !denied;
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);
  function clear() { setLoaded(false); setSourcesReady(false); setStore(null); setProfile(null); setListings([]); setCursor(null); setSelection([]); setSlug(''); setReview(null); setAck(false); }
  function fail(result: { code: string; message?: string; error?: string }) {
    setError(failureMessage(result));
    if (['access_denied', 'unauthenticated'].includes(result.code)) { clear(); setDenied(true); nonces.current.clear(); }
    else if (result.code === 'conflict') { clear(); setNotice('Läs in aktuellt underlag och granska publiceringen på nytt.'); }
  }
  async function read(token: number) {
    const [managerRead, profileRead, advertisingRead] = await Promise.allSettled([getCompanyPublicStoreAction({ companyId }), getCompanyStoreProfileAction({ companyId }), listAdvertisingWorkspaceAction({ companyId, pageKey: null, limit: 50 })]);
    if (!live.current || generation.current !== token) return false;
    const unavailable = { ok: false as const, code: 'unavailable', message: 'Underlaget kunde inte läsas in.' };
    const current = managerRead.status === 'fulfilled' ? managerRead.value : unavailable;
    const details = profileRead.status === 'fulfilled' ? profileRead.value : unavailable;
    const ads = advertisingRead.status === 'fulfilled' ? advertisingRead.value : unavailable;
    if (!current.ok) { clear(); fail(current); return false; }
    for (const dependency of [details, ads]) if (!dependency.ok && ['access_denied', 'unauthenticated'].includes(dependency.code)) { clear(); fail(dependency); return false; }
    if (current.companyId !== companyId || current.actorUserId !== userId || !['owner', 'admin'].includes(current.actorRole) || details.ok && (details.companyId !== companyId || details.actorId !== userId || !['owner', 'admin'].includes(details.role)) || ads.ok && (ads.companyId !== companyId || ads.actorUserId !== userId || !['owner', 'admin'].includes(ads.actorRole))) { fail({ code: 'access_denied', message: 'Butikens aktuella åtkomst kunde inte verifieras.' }); return false; }
    setStore(current.store); setSlug(current.store?.slug ?? ''); setProfile(details.ok ? details : null); setListings(ads.ok ? ads.listings : []); setCursor(ads.ok ? ads.nextPageKey : null); setSelection([]); setLoaded(true); setSourcesReady(details.ok && ads.ok);
    if (!details.ok || !ads.ok) { setProfile(null); setListings([]); setCursor(null); setError('Profilen eller annonserna kunde inte verifieras. Ny publicering är spärrad. Butikens aktuella status är verifierad och en publicerad butik kan avpubliceras.'); }
    return true;
  }

  async function load(more = false) {
    if (!allowed || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setReview(null); setAck(false); const token = ++generation.current;
    try {
      if (!more) { clear(); await read(token); }
      else {
        const ads = await listAdvertisingWorkspaceAction({ companyId, pageKey: cursor, limit: 50 });
        if (!live.current || generation.current !== token) return;
        if (!ads.ok) { setSourcesReady(false); setProfile(null); setListings([]); setSelection([]); fail(ads); return; }
        if (ads.companyId !== companyId || ads.actorUserId !== userId || !['owner', 'admin'].includes(ads.actorRole)) { fail({ code: 'access_denied', message: 'Annonsernas åtkomst kunde inte verifieras.' }); return; }
        setListings(old => [...old, ...ads.listings.filter(ad => !old.some(value => value.id === ad.id))]); setCursor(ads.nextPageKey);
      }
    } catch { if (live.current && generation.current === token) { clear(); setError('Butiksunderlaget kunde inte verifieras. Läs in på nytt.'); } }
    finally { if (live.current && generation.current === token) { lock.current = false; setBusy(false); } }
  }
  function startReview(value: Review) { setReview(value); setAck(false); setError(''); setNotice(''); }
  async function save() {
    if (!allowed || lock.current || !review || !ack) return;
    const frozen = review, payload = frozen.kind === 'publish' ? { companyId, slug: frozen.slug, expectedVersion: frozen.expectedVersion, profileVersion: frozen.profile.profile!.version, listings: frozen.listings.map(ad => ({ listingId: ad.id, version: ad.version })), acknowledged: true as const } : { companyId, expectedVersion: frozen.expectedVersion, acknowledged: true as const };
    const fingerprint = JSON.stringify({ kind: frozen.kind, ...payload }); if (!nonces.current.has(fingerprint)) nonces.current.set(fingerprint, crypto.randomUUID());
    const requestId = nonces.current.get(fingerprint)!, token = ++generation.current; lock.current = true; setBusy(true); setError(''); setNotice(''); let received = false;
    try {
      const result = frozen.kind === 'publish' ? await publishCompanyPublicStoreAction({ companyId, slug: frozen.slug, expectedVersion: frozen.expectedVersion, profileVersion: frozen.profile.profile!.version, listings: frozen.listings.map(ad => ({ listingId: ad.id, version: ad.version })), acknowledged: true, requestId }) : await unpublishCompanyPublicStoreAction({ companyId, expectedVersion: frozen.expectedVersion, acknowledged: true, requestId });
      if (!live.current || generation.current !== token) return;
      if (!result.ok) { fail(result); return; }
      if (result.receipt.companyId !== companyId || result.receipt.actorUserId !== userId || result.receipt.requestId !== requestId) { clear(); setError('Kvittot kunde inte verifieras. Läs in aktuell butik.'); return; }
      received = true; clear(); if (await read(token) && live.current && generation.current === token) setNotice('Åtgärden har registrerats. Butikens aktuella status har lästs in på nytt.');
    } catch { if (live.current && generation.current === token) { if (received) { clear(); setError('Åtgärden är registrerad men aktuell status kunde inte verifieras. Uppdatera butiken.'); } else setError('Resultatet är okänt. Försök igen med samma granskning och begäran.'); } }
    finally { if (live.current && generation.current === token) { lock.current = false; setBusy(false); } }
  }
  if (!['owner', 'admin'].includes(role)) return null;
  if (demo) return <section className="surface" style={{ marginTop: 24, padding: 20 }}><h2>Publik handlarbutik</h2><p>Publicera uttryckligt granskad butiksinformation och valda annonser på Trafexa. Ingen publicering sker i demo.</p></section>;
  const ready = listings.filter(ad => ad.status === 'ready');
  return <section className="surface" aria-label="Publik handlarbutik" style={{ marginTop: 24, padding: 20, overflowWrap: 'anywhere' }}>
    <div className="panel-heading"><h2>Publik handlarbutik</h2><button type="button" className="button button-outline" disabled={busy || denied} aria-expanded={open} onClick={() => { if (open) { setOpen(false); clear(); } else { setOpen(true); void load(); } }}>{open ? 'Stäng publik butik' : 'Hantera publik butik'}</button></div>
    <p>Välj vilken butiksprofil och vilka färdiga annonser som ska visas öppet på Trafexa. Ändringar i privata uppgifter publiceras inte automatiskt. Detta skickar inget till Blocket eller Wayke.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">Verifierar butiksunderlaget…</p>}
    {open && !denied && <><button type="button" className="text-link" disabled={busy} onClick={() => void load()}>Uppdatera butiksunderlag</button>{loaded && <><p>Aktuell status: <strong>{store?.status === 'published' ? 'Publicerad' : store ? 'Avpublicerad' : 'Inte publicerad'}</strong></p>{store?.status === 'published' && <p><a href={`/handlare/${store.slug}`} target="_blank" rel="noreferrer">Öppna den publika butiken</a> · <a href={`/api/public-stores/${store.slug}`}>Publika butiksuppgifter som JSON</a></p>}{store && <p>Senast valda annonser: {store.selectedListings.length}. Välj uttryckligen vilka annonser som ska ingå i nästa publicering.</p>}
      {!review && <><label htmlFor={`${id}-slug`}>Butikens adressnamn</label><input id={`${id}-slug`} value={slug} disabled={busy || !!store} maxLength={64} onChange={e => setSlug(e.target.value)}/><p>Adressen blir /handlare/{slug || 'ditt-adressnamn'}. Adressnamnet låses vid första publiceringen.</p>{sourcesReady && profile?.profile && profile.identityValid ? <><h3>Profilversion {profile.profile.version}: {profile.profile.fields.displayName}</h3><p>{profile.legalName} · {profile.organisationNumber}</p><p>Profilens offentliga kontaktuppgifter visas i granskningen.</p><fieldset disabled={busy}><legend>Välj färdiga annonser (högst 50)</legend>{ready.map(ad => <label key={ad.id} style={{ display: 'block', marginBlock: 8 }}><input type="checkbox" checked={selection.includes(ad.id)} disabled={!selection.includes(ad.id) && selection.length >= 50} onChange={e => setSelection(old => e.target.checked ? [...old, ad.id] : old.filter(value => value !== ad.id))}/>{ad.snapshot.title} · {money(ad.snapshot.priceGrossOre)} · version {ad.version}</label>)}{!ready.length && <p>Inga färdiga annonser i den inlästa listan. Butiken kan publiceras utan annonser.</p>}</fieldset>{cursor && <button type="button" className="text-link" disabled={busy} onClick={() => void load(true)}>Läs in fler annonser</button>}<button type="button" className="button button-green" disabled={busy || !slugValid(slug)} onClick={() => startReview({ kind: 'publish', slug, expectedVersion: store?.version ?? 0, profile, listings: ready.filter(ad => selection.includes(ad.id)) })}>Granska publicering</button></> : <p>{sourcesReady ? 'En komplett butiksprofil och ett giltigt organisationsnummer krävs före publicering.' : 'Läs in och verifiera profil och annonser före ny publicering.'}</p>}{store?.status === 'published' && <button type="button" className="button button-outline" disabled={busy} onClick={() => startReview({ kind: 'unpublish', slug: store.slug, expectedVersion: store.version })}>Granska avpublicering</button>}</>}
      {review && <section aria-labelledby={`${id}-review`}><h3 id={`${id}-review`} tabIndex={-1} ref={heading}>{review.kind === 'publish' ? 'Bekräfta publik butik' : 'Bekräfta avpublicering'}</h3><p>/handlare/{review.slug}</p>{review.kind === 'publish' ? <><h4>{review.profile.profile!.fields.displayName}</h4><p>{review.profile.legalName} · Organisationsnummer {review.profile.organisationNumber}</p><dl>{Object.entries(review.profile.profile!.fields).filter(([key]) => key !== 'displayName').map(([key,value]) => <div key={key}><dt>{{addressLine1:'Gatuadress',addressLine2:'Extra adressrad',postalCode:'Postnummer',city:'Ort',countryCode:'Land',publicEmail:'Offentlig e-post',publicPhone:'Offentlig telefon',websiteUrl:'Webbplats',logoUrl:'Logotyplänk',description:'Presentation',openingHoursText:'Öppettider'}[key]}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{value ?? 'Ingen uppgift'}</dd></div>)}</dl><h4>{review.listings.length} valda annonser</h4>{review.listings.map(ad => <article key={ad.id}><h4>{ad.snapshot.title}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{ad.snapshot.description}</p><p>{ad.snapshot.make} {ad.snapshot.model} · {ad.snapshot.year} · {ad.snapshot.mileageKm} km · {ad.snapshot.fuel} · {ad.snapshot.transmission}</p><p>{money(ad.snapshot.priceGrossOre)} · version {ad.version} · {ad.snapshot.photos.length} valda bilder</p>{ad.snapshot.includeRegistrationNumber && <p>Registreringsnummer: {ad.snapshot.registrationNumber}</p>}</article>)}<p>Samtliga granskade kontaktuppgifter, valda annonser och deras valda bilder blir offentliga. Endast annonser som fortfarande kan visas offentligt återges. Ingen betalning eller extern annonsörsanslutning aktiveras.</p></> : <p>Butiken, dess offentliga JSON och bilder blir otillgängliga via Trafexa. Redan hämtade kopior hos andra kan finnas kvar.</p>}<label><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)}/>{review.kind === 'publish' ? 'Jag har granskat exakt profil och valda annonser och godkänner att de visas offentligt.' : 'Jag har granskat och vill avpublicera butiken.'}</label><div className="table-controls" style={{ flexWrap: 'wrap' }}><button type="button" className="button button-green" disabled={busy || !ack} onClick={() => void save()}>{review.kind === 'publish' ? 'Publicera butiken på Trafexa' : 'Avpublicera butiken'}</button><button type="button" className="text-link" disabled={busy} onClick={() => { setReview(null); setAck(false); }}>Tillbaka till urval</button></div></section>}
    </>}</>}
  </section>;
}
