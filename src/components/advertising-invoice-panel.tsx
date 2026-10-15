'use client';

import { useEffect, useRef, useState } from 'react';
import { createAdvertisingInvoiceDraftAction, getPlatformAdvertisingInvoicePageAction, listAdvertisingInvoicePageAction, saveAdvertisingBuyerProfileAction, savePlatformAdvertisingBuyerProfileAction, saveAdvertisingSellerProfileAction, getAdvertisingInvoiceDraftAction, getPlatformAdvertisingInvoiceDraftAction } from '@/lib/advertising/invoice-actions';
import type { AdvertisingInvoicePage, AdvertisingInvoiceProfile } from '@/lib/advertising/invoice-types';
import { formatOre } from '@/lib/calculations/vehicle-calculation';

type Props = { companyId: string; userId: string; role: string; superadmin?: boolean; month: string; onDenied?: (message: string) => void };
type Fields = AdvertisingInvoiceProfile['fields'];
type Review = { kind: 'buyer' | 'seller'; fields: Fields; expectedVersion: number; confirmed: boolean } | { kind: 'draft'; buyerVersion: number; sellerVersion: number; reviewToken: string; confirmed: boolean };
const labels: Record<keyof Fields, string> = { legalName: 'Juridiskt företagsnamn', organisationNumber: 'Organisationsnummer', invoiceEmail: 'Fakturaepost', addressLine1: 'Postadress', addressLine2: 'Adressrad 2', postalCode: 'Postnummer', city: 'Ort', countryCode: 'Landkod', reference: 'Fakturareferens' };
const contactKeys: (keyof Fields)[] = ['invoiceEmail', 'addressLine1', 'addressLine2', 'postalCode', 'city', 'countryCode', 'reference'];
const allKeys: (keyof Fields)[] = ['legalName', 'organisationNumber', ...contactKeys];
const date = (value: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const missingLabel = (field: string) => { const key = field.replace(/^(buyer|seller)[.:]/, ''); const label = key === 'vatTreatment' ? 'Momshantering' : labels[key as keyof Fields] ?? 'Uppgift behöver kompletteras'; return `${field.startsWith('buyer.') ? 'Köpare: ' : field.startsWith('seller.') ? 'Säljare: ' : ''}${label}`; };
function Missing({ fields }: { fields: string[] }) { return fields.length ? <p className="form-privacy">Behöver kompletteras: {fields.map(missingLabel).join(', ')}.</p> : <p>Faktureringsuppgifter kompletta.</p>; }
function Profile({ profile }: { profile: Pick<AdvertisingInvoiceProfile, 'version' | 'fields' | 'missingFields'> & { updatedAt?: string | null } }) { return <><p>Version {profile.version}{profile.updatedAt ? ` · ${date(profile.updatedAt)}` : profile.version === 0 ? ' · Ej sparad' : ''}</p><dl className="detail-list">{allKeys.map(key => <div key={key}><dt>{labels[key]}</dt><dd style={{ overflowWrap: 'anywhere' }}>{profile.fields[key] || 'Ej angivet'}</dd></div>)}</dl><Missing fields={profile.missingFields}/></>; }

export function AdvertisingInvoicePanel(props: Props) { return <Invoices key={`${props.companyId}:${props.userId}:${props.role}:${props.superadmin}:${props.month}`} {...props}/>; }
function Invoices({ companyId, userId, role, superadmin = false, month, onDenied }: Props) {
  const [page, setPage] = useState<AdvertisingInvoicePage | null>(null);
  const [editor, setEditor] = useState<{ kind: 'buyer' | 'seller'; fields: Fields } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  const [refresh, setRefresh] = useState(0), [beforeVersion, setBeforeVersion] = useState<number | null>(null);
  const [selected, setSelected] = useState<Extract<Awaited<ReturnType<typeof getAdvertisingInvoiceDraftAction>>, { ok: true }> | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const generation = useRef(0), selectedGeneration = useRef(0), alive = useRef(true), inFlight = useRef(false);
  const requests = useRef(new Map<string, string>()), deniedCallback = useRef(onDenied), heading = useRef<HTMLHeadingElement>(null); deniedCallback.current = onDenied;
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++generation.current; ++selectedGeneration.current; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review?.kind]);
  function failure(result: { code?: string; message: string }) {
    setError(result.message);
    if (result.code === 'access_denied' || result.code === 'unauthenticated') {
      ++generation.current; ++selectedGeneration.current; setPage(null); setSelected(null); setSelectedLoading(false); setEditor(null); setReview(null); setNotice(''); setDenied(true); deniedCallback.current?.(result.message);
    }
  }
  function scoped(value: AdvertisingInvoicePage) { return value.companyId === companyId && value.actorUserId === userId && value.actorRole === (superadmin ? 'platform_admin' : role) && value.month === month; }
  useEffect(() => {
    const request = ++generation.current; ++selectedGeneration.current; setPage(null); setSelected(null); setSelectedLoading(false); setReview(null); setEditor(null);
    if (denied) { setLoading(false); return; }
    setLoading(true); setError('');
    void (superadmin ? getPlatformAdvertisingInvoicePageAction : listAdvertisingInvoicePageAction)({ companyId, month, beforeVersion }).then(result => {
      if (!alive.current || generation.current !== request) return;
      if (!result.ok) { failure(result); return; }
      if (!scoped(result.page)) { failure({ code: 'access_denied', message: 'Företaget, perioden eller din behörighet har ändrats. Läs in sidan igen.' }); return; }
      setPage(result.page);
    }).catch(() => { if (alive.current && generation.current === request) setError('Faktureringsuppgifterna kunde inte verifieras. Försök igen.'); })
      .finally(() => { if (alive.current && generation.current === request) setLoading(false); });
    return () => { ++generation.current; ++selectedGeneration.current; };
  }, [companyId, userId, role, superadmin, month, beforeVersion, refresh, denied]);
  function prepareProfile() {
    if (!editor || !page) return;
    const fields = Object.fromEntries(allKeys.map(key => [key, editor.fields[key]?.trim() || null])) as Fields;
    if (fields.countryCode) fields.countryCode = fields.countryCode.toUpperCase();
    if (fields.invoiceEmail) fields.invoiceEmail = fields.invoiceEmail.toLowerCase();
    setError(''); setNotice(''); setReview({ kind: editor.kind, fields, expectedVersion: (editor.kind === 'buyer' ? page.buyerProfile : page.sellerProfile).version, confirmed: false });
  }
  async function confirm() {
    if (!page || !review?.confirmed || loading || denied || inFlight.current) return;
    if ((review.kind === 'buyer' && !page.canEditBuyer) || (review.kind === 'seller' && !page.canEditSeller) || (review.kind === 'draft' && !superadmin)) return;
    const request = generation.current;
    const input = review.kind === 'draft'
      ? { companyId, month, expectedBuyerVersion: review.buyerVersion, expectedSellerVersion: review.sellerVersion, expectedReviewToken: review.reviewToken, reviewAcknowledged: true as const }
      : review.kind === 'seller' ? { fields: review.fields, expectedVersion: review.expectedVersion }
        : { companyId, fields: Object.fromEntries(contactKeys.map(key => [key, review.fields[key]])), expectedVersion: review.expectedVersion };
    const fingerprint = `${review.kind}:${JSON.stringify(input)}`;
    if (!requests.current.has(fingerprint)) requests.current.set(fingerprint, crypto.randomUUID());
    const requestId = requests.current.get(fingerprint)!;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = review.kind === 'draft'
        ? await createAdvertisingInvoiceDraftAction({ ...input, requestId } as Parameters<typeof createAdvertisingInvoiceDraftAction>[0])
        : review.kind === 'seller'
          ? await saveAdvertisingSellerProfileAction({ ...input, requestId } as Parameters<typeof saveAdvertisingSellerProfileAction>[0])
          : await (superadmin ? savePlatformAdvertisingBuyerProfileAction : saveAdvertisingBuyerProfileAction)({ ...input, requestId } as Parameters<typeof saveAdvertisingBuyerProfileAction>[0]);
      if (!alive.current || generation.current !== request) return;
      if (!result.ok) {
        failure(result);
        if (result.code === 'conflict') { setEditor(null); setReview(null); setPage(null); setNotice('Underlaget har ändrats. Granska de senaste uppgifterna innan du sparar igen.'); setRefresh(value => value + 1); }
        return;
      }
      if (result.receipt.actorUserId !== userId || result.receipt.requestId !== requestId || result.receipt.companyId !== (review.kind === 'seller' ? null : companyId)) {
        failure({ code: 'access_denied', message: 'Kvittot kunde inte verifieras för aktuellt företag och användare.' }); return;
      }
      // No historical receipt or locally edited fields may restore private data.
      ++selectedGeneration.current; setSelected(null); setSelectedLoading(false); setReview(null); setEditor(null); setPage(null);
      setNotice(review.kind === 'draft' ? 'Ett oföränderligt fakturautkast är sparat. Ingen faktura har utfärdats eller skickats.' : 'Faktureringsuppgifterna är sparade i en ny version. Tidigare utkast och PDF:er är oförändrade.');
      setRefresh(value => value + 1);
    } catch { if (alive.current && generation.current === request) setError('Åtgärdens resultat är okänt. Försök samma bekräftelse igen för att kontrollera den sparade begäran.'); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function showDraft(id: string) {
    if (!page || busy || denied) return;
    const request = ++selectedGeneration.current, scope = generation.current; setSelected(null); setSelectedLoading(true); setError('');
    try {
      const result = await (superadmin ? getPlatformAdvertisingInvoiceDraftAction : getAdvertisingInvoiceDraftAction)({ companyId, id });
      if (!alive.current || request !== selectedGeneration.current || scope !== generation.current) return;
      if (!result.ok) { failure(result); return; }
      if (result.draft.companyId !== companyId || result.draft.id !== id || result.draft.month !== month) { failure({ code: 'access_denied', message: 'Utkastet kunde inte verifieras för aktuellt företag och period.' }); return; }
      setSelected(result);
    } catch { if (alive.current && request === selectedGeneration.current && scope === generation.current) setError('Utkastet kunde inte verifieras. Försök igen.'); }
    finally { if (alive.current && request === selectedGeneration.current && scope === generation.current) setSelectedLoading(false); }
  }
  return <section className="surface" style={{ padding: 20, marginTop: 24, minWidth: 0 }} aria-label="Faktureringsuppgifter och fakturautkast">
    <h3>Faktureringsuppgifter och fakturautkast</h3><p>Utkast för annonseringsavgifter i SEK exklusive moms. Moms, fakturanummer, betalningsvillkor och förfallodatum är ännu inte fastställda. Ingen faktura utfärdas, skickas eller betalas här.</p>
    <button type="button" className="button button-outline" disabled={loading || busy || denied} onClick={() => { setPage(null); setEditor(null); setReview(null); setSelected(null); ++selectedGeneration.current; setNotice(''); setRefresh(value => value + 1); }}>Uppdatera faktureringsuppgifter</button>
    {loading && <p role="status">Verifierar faktureringsuppgifter…</p>}{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {page && <>
      <section aria-label="Köparens faktureringsuppgifter"><h4>Köparens faktureringsuppgifter</h4><Profile profile={page.buyerProfile}/>{page.canEditBuyer && !editor && !review && <button type="button" className="button button-outline" disabled={busy} onClick={() => setEditor({ kind: 'buyer', fields: { ...page.buyerProfile.fields } })}>Ändra köparens faktureringsuppgifter</button>}</section>
      <section aria-label="Trafexas säljaruppgifter" style={{ marginTop: 24 }}><h4>Trafexas säljaruppgifter</h4><Profile profile={page.sellerProfile}/>{page.canEditSeller && !editor && !review && <button type="button" className="button button-outline" disabled={busy} onClick={() => setEditor({ kind: 'seller', fields: { ...page.sellerProfile.fields } })}>Ändra Trafexas säljaruppgifter</button>}</section>
      {editor && !review && <section className="workspace-form surface" style={{ padding: 18, marginTop: 20 }} aria-label="Redigera faktureringsuppgifter"><h4>{editor.kind === 'buyer' ? 'Ändra köparens uppgifter' : 'Ändra säljarens uppgifter'}</h4><p>Ofullständiga uppgifter får sparas. Ange en riktig postadress och välj land uttryckligen. En e-postadress ersätter inte postadressen.</p>{editor.kind === 'seller' && <button type="button" className="button button-outline" disabled={busy} onClick={() => setEditor({ ...editor, fields: { ...editor.fields, legalName: 'Trafexa Nordic AB', organisationNumber: '5568554884', invoiceEmail: 'info@trafexa.com' } })}>Fyll i Trafexas bekräftade bolagsuppgifter</button>}
        {allKeys.map(key => <label key={key}>{labels[key]}{key === 'countryCode' ? ' (två bokstäver, exempel SE)' : key === 'organisationNumber' ? ' (10 siffror)' : ''}<input value={editor.fields[key] ?? ''} type={key === 'invoiceEmail' ? 'email' : 'text'} readOnly={editor.kind === 'buyer' && (key === 'legalName' || key === 'organisationNumber')} disabled={busy} maxLength={key === 'countryCode' ? 2 : key === 'invoiceEmail' ? 254 : key === 'organisationNumber' ? 10 : key === 'postalCode' ? 32 : key === 'city' ? 80 : 160} onChange={event => setEditor({ ...editor, fields: { ...editor.fields, [key]: event.target.value } })}/></label>)}<div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}><button type="button" className="button button-outline" disabled={busy} onClick={prepareProfile}>Granska faktureringsuppgifterna</button><button type="button" className="button button-outline" disabled={busy} onClick={() => setEditor(null)}>Avbryt ändring</button></div>
      </section>}
      <h4 style={{ marginTop: 24 }}>Aktuellt underlag för {month}</h4>{page.basis.original ? <><dl className="detail-list"><div><dt>Låst original, exkl. moms</dt><dd>{formatOre(page.basis.original.totalOre)}</dd></div><div><dt>Reduktioner, exkl. moms</dt><dd>{formatOre(page.basis.reductionTotalOre)}</dd></div><div><dt>Återstående underlag, exkl. moms</dt><dd>{page.basis.netTotalOre === null ? 'Kan inte verifieras' : formatOre(page.basis.netTotalOre)}</dd></div></dl><p>Moms: ej fastställd. Belopp inklusive moms: kan inte beräknas.</p>{superadmin && !review && !editor && <button type="button" className="button button-green" disabled={busy} onClick={() => { setNotice(''); setError(''); setReview({ kind: 'draft', buyerVersion: page.buyerProfile.version, sellerVersion: page.sellerProfile.version, reviewToken: page.reviewToken, confirmed: false }); }}>Granska nytt fakturautkast</button>}</> : <p>Månaden har inget låst underlag. Faktureringsuppgifterna kan kompletteras nu; ett fakturautkast kan skapas efter att månaden har låsts.</p>}
      {review && <section aria-label="Granska fakturaunderlag" className="workspace-form surface" style={{ padding: 18, marginTop: 20 }}><h4 tabIndex={-1} ref={heading}>{review.kind === 'draft' ? `Granska fakturautkast för ${month}` : 'Granska faktureringsuppgifterna'}</h4>
        {review.kind === 'draft' ? <><p>Köparuppgifter version {review.buyerVersion} · Säljaruppgifter version {review.sellerVersion}<br/>Återstående underlag: {page.basis.netTotalOre === null ? 'Kan inte verifieras' : formatOre(page.basis.netTotalOre)} exklusive moms.</p><Missing fields={page.buyerProfile.missingFields.map(field => `buyer.${field}`)}/><Missing fields={page.sellerProfile.missingFields.map(field => `seller.${field}`)}/><p>Dokumentet sparas som UTKAST / EJ UTFÄRDAD. Moms och betalningsvillkor är inte fastställda.</p></> : <dl className="detail-list">{allKeys.map(key => <div key={key}><dt>{labels[key]}</dt><dd style={{ overflowWrap: 'anywhere' }}>{review.fields[key] || 'Ej angivet'}</dd></div>)}</dl>}
        <label style={{ display: 'flex', alignItems: 'start', gap: 10 }}><input type="checkbox" style={{ width: 'auto' }} checked={review.confirmed} disabled={busy} onChange={event => setReview({ ...review, confirmed: event.target.checked })}/><span>{review.kind === 'draft' ? 'Jag har granskat företaget, perioden, originalet, rättelserna och uppgiftsversionerna. Jag förstår att detta endast är ett utkast.' : 'Jag har granskat uppgifterna och eventuella kompletteringar som återstår.'}</span></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}><button type="button" className="button button-green" disabled={busy || !review.confirmed} onClick={() => void confirm()}>{review.kind === 'draft' ? 'Bekräfta och spara fakturautkast' : 'Bekräfta och spara uppgifterna'}</button><button type="button" className="button button-outline" disabled={busy} onClick={() => setReview(null)}>Avbryt granskning</button></div>
      </section>}
      <h4 style={{ marginTop: 24 }}>Sparade fakturautkast</h4>{page.drafts.length ? <ol style={{ paddingLeft: 20 }}>{page.drafts.map(draft => <li key={draft.id} style={{ marginBlock: 16, overflowWrap: 'anywhere' }}><strong>Utkast version {draft.version} · Ej utfärdad</strong><p>{date(draft.createdAt)}<br/>Utkastreferens: {draft.id}</p>{draft.isOutdated && <p className="form-privacy">Inaktuellt underlag: uppgifter eller rättelser har ändrats. Det sparade dokumentet är oförändrat.</p>}<Missing fields={draft.missingFields}/><button type="button" className="text-link" disabled={busy || selectedLoading} onClick={() => void showDraft(draft.id)}>Visa sparat utkast version {draft.version}</button></li>)}</ol> : <p>Inga fakturautkast har sparats för denna månad.</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{beforeVersion !== null && <button type="button" className="button button-outline" disabled={busy || loading} onClick={() => setBeforeVersion(null)}>Visa senaste utkasten</button>}{page.nextBeforeVersion !== null && <button type="button" className="button button-outline" disabled={busy || loading} onClick={() => setBeforeVersion(page.nextBeforeVersion)}>Visa äldre fakturautkast</button>}</div>
      {selectedLoading && <p role="status">Verifierar valt fakturautkast…</p>}
      {selected && <section aria-label="Valt fakturautkast" className="surface" style={{ padding: 18, marginTop: 20 }}><h4>UTKAST / EJ UTFÄRDAD · Version {selected.draft.version}</h4>{selected.isOutdated && <p className="form-privacy">Detta utkast bygger på äldre uppgifter. Originalets PDF ändras inte.</p>}<p>Utkastreferens: {selected.draft.id}</p><dl className="detail-list"><div><dt>Original i utkastet, exkl. moms</dt><dd>{selected.draft.snapshot.basis.original ? formatOre(selected.draft.snapshot.basis.original.totalOre) : 'Kan inte verifieras'}</dd></div><div><dt>Reduktioner i utkastet, exkl. moms</dt><dd>{formatOre(selected.draft.snapshot.basis.reductionTotalOre)}</dd></div><div><dt>Återstående belopp i utkastet, exkl. moms</dt><dd>{selected.draft.snapshot.basis.netTotalOre === null ? 'Kan inte verifieras' : formatOre(selected.draft.snapshot.basis.netTotalOre)}</dd></div></dl><p>Moms: ej fastställd. Belopp inklusive moms: kan inte beräknas.</p><h5>Köpare i sparat utkast</h5><Profile profile={selected.draft.snapshot.buyerProfile}/><h5>Säljare i sparat utkast</h5><Profile profile={selected.draft.snapshot.sellerProfile}/><Missing fields={selected.draft.snapshot.missingFields}/><a className="text-link" href={`/api/advertising/invoices/${encodeURIComponent(selected.draft.id)}/pdf${superadmin ? `?companyId=${encodeURIComponent(companyId)}` : ''}`}>Hämta PDF av sparat utkast version {selected.draft.version}</a></section>}
    </>}
  </section>;
}
