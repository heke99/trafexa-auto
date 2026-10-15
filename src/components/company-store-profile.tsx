'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { getCompanyStoreProfileAction, getCompanyStoreExportAction, saveCompanyStoreProfileAction, prepareCompanyStoreExportAction } from '@/lib/data/company-store-profile-actions';
import { COMPANY_STORE_ATTESTATION_VERSION, type CompanyStoreFields, type CompanyStoreSourceSnapshot, type CompanyStoreProfilePage, type CompanyStoreScope, type CompanyStoreChannel, type CompanyStorePurpose, type CompanyStoreExport, type CompanyStoreResult } from '@/lib/company-store-profile/types';

export const blankStoreFields = (): CompanyStoreFields => ({ displayName: '', addressLine1: '', addressLine2: null, postalCode: '', city: '', countryCode: 'SE', publicEmail: '', publicPhone: '', websiteUrl: null, logoUrl: null, description: null, openingHoursText: null });
const fieldKeys = Object.keys(blankStoreFields()) as (keyof CompanyStoreFields)[];
export const sameStoreFields = (left: CompanyStoreFields, right: CompanyStoreFields) => fieldKeys.every(key => left[key] === right[key]);
export function normalizeStoreFields(value: CompanyStoreFields): CompanyStoreFields {
  const optional = (text: string | null) => text?.trim() || null;
  const url = (text: string | null) => {
    const raw = text?.trim(); if (!raw) return null;
    const parsed = new URL(raw);
    if (parsed.hostname.split('.').some(label => label.startsWith('xn--')) || /[^\x00-\x7f]/.test(raw.replace(/^https:\/\//i, '').split('/')[0])) throw Error('Internationella domännamn stöds inte ännu. Lämna det frivilliga URL-fältet tomt tills vidare.');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || /[:@]/.test(raw.replace(/^https:\/\//i, '').split('/')[0]) || /[\\\s]/.test(raw)) throw Error('Ange en publik HTTPS-länk utan inloggningsuppgifter, port, frågedel eller fragment.');
    return parsed.href;
  };
  return { displayName: value.displayName.trim(), addressLine1: value.addressLine1.trim(), addressLine2: optional(value.addressLine2), postalCode: value.postalCode.replace(/\s/g, ''), city: value.city.trim(), countryCode: 'SE', publicEmail: value.publicEmail.trim().toLowerCase(), publicPhone: value.publicPhone.trim(), websiteUrl: url(value.websiteUrl), logoUrl: url(value.logoUrl), description: optional(value.description), openingHoursText: optional(value.openingHoursText) };
}
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const channelLabel = { blocket: 'Blocket', wayke: 'Wayke' };
const purposeLabel = { new_store: 'Underlag för ny butik', existing_store: 'Underlag för befintlig butik' };
type Props = { companyId: string; userId: string; role: string; demo?: boolean };
type Review = { kind: 'profile'; expectedVersion: number; fields: CompanyStoreFields } | { kind: 'export'; source: CompanyStoreSourceSnapshot; sourceSha256: string; channel: CompanyStoreChannel; purpose: CompanyStorePurpose };

export function CompanyStoreProfile(props: Props) {
  if (!['owner', 'admin'].includes(props.role)) return null;
  return <ProfilePanel key={`${props.companyId}:${props.userId}:${props.role}:${!!props.demo}`} {...props}/>;
}
function ProfilePanel({ companyId, userId, role, demo = false }: Props) {
  const field = useId();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [page, setPage] = useState<CompanyStoreProfilePage | null>(null);
  const [fields, setFields] = useState<CompanyStoreFields>(blankStoreFields);
  const [editing, setEditing] = useState(false);
  const [editVersion, setEditVersion] = useState(0);
  const [review, setReview] = useState<Review | null>(null), [ack, setAck] = useState(false);
  const [channel, setChannel] = useState<'' | CompanyStoreChannel>(''), [purpose, setPurpose] = useState<'' | CompanyStorePurpose>('');
  const [selected, setSelected] = useState<CompanyStoreExport | null>(null);
  const [readError, setReadError] = useState(''), [writeError, setWriteError] = useState(''), [message, setMessage] = useState('');
  const [writing, setWriting] = useState(false);
  const [, startAction] = useTransition();
  const alive = useRef(false), sequence = useRef(0), locked = useRef(false), requests = useRef(new Map<string, string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const current = phase === 'ready' ? page : null;
  const busy = phase === 'loading' || writing;
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);
  function matchesScope(value: CompanyStoreScope) { return sameId(value.companyId, companyId) && sameId(value.actorId, userId) && value.role === role; }
  function sameSource(left: CompanyStoreSourceSnapshot, right: CompanyStoreSourceSnapshot) { return sameId(left.companyId, right.companyId) && sameId(left.profileId, right.profileId) && left.profileVersion === right.profileVersion && left.legalName === right.legalName && left.organisationNumber === right.organisationNumber && sameStoreFields(left.shop, right.shop); }
  function clearPrivate() { setPage(null); setSelected(null); setFields(blankStoreFields()); setEditing(false); setReview(null); setAck(false); setChannel(''); setPurpose(''); setMessage(''); requests.current.clear(); setPhase('error'); }
  function payload(value: Review) {
    return value.kind === 'profile' ? { companyId, expectedVersion: value.expectedVersion, fields: value.fields, reviewAcknowledged: true } : { companyId, expectedVersion: value.source.profileVersion, expectedSourceSha256: value.sourceSha256, channel: value.channel, purpose: value.purpose, reviewAcknowledged: true, attestationVersion: COMPANY_STORE_ATTESTATION_VERSION };
  }
  function fingerprint(value: Review) { return JSON.stringify([value.kind, payload(value)]); }
  function refresh() {
    if (demo || locked.current) return;
    locked.current = true; const token = ++sequence.current; setPhase('loading'); setReadError(''); setSelected(null);
    startAction(async () => {
      try {
        const result = await getCompanyStoreProfileAction({ companyId });
        if (!alive.current || token !== sequence.current) return;
        if (!result.ok) { if (['access_denied', 'unauthenticated'].includes(result.code)) clearPrivate(); else { setPhase('error'); setPage(null); } setReadError(result.error); return; }
        if (!matchesScope(result) || result.profile && !sameId(result.profile.companyId, companyId) || result.source && (!result.profile || !sameId(result.source.companyId, companyId) || result.source.profileVersion !== result.profile.version || result.source.profileId !== result.profile.id)) { clearPrivate(); setReadError('Butiksprofilens företag eller behörighet kunde inte verifieras. Läs in sidan igen.'); return; }
        if (review && !requests.current.has(fingerprint(review)) && (review.kind === 'profile' ? review.expectedVersion !== (result.profile?.version ?? 0) : review.sourceSha256 !== result.sourceSha256)) { setReview(null); setAck(false); setWriteError('Profilen har ändrats sedan granskningen. Granska den aktuella versionen igen.'); }
        setPage(result); setPhase('ready');
      } catch { if (alive.current && token === sequence.current) { setPage(null); setPhase('error'); setReadError('Butiksprofilen kunde inte hämtas. Dina inmatade uppgifter finns kvar. Försök igen.'); } }
      finally { locked.current = false; }
    });
  }
  function mutate<T>(confirmed: Review, work: (nonce: string) => Promise<CompanyStoreResult<T>>, accept: (value: T, nonce: string) => boolean) {
    if (demo || locked.current || !ack) return;
    const key = fingerprint(confirmed); let nonce = requests.current.get(key);
    if (!nonce) { try { nonce = crypto.randomUUID(); } catch { setWriteError('Webbläsaren kunde inte skapa en säker begäran. Läs in sidan igen.'); return; } requests.current.set(key, nonce); }
    const requestId = nonce, token = ++sequence.current;
    locked.current = true; setWriting(true); setWriteError(''); setMessage('');
    startAction(async () => {
      try {
        const result = await work(requestId);
        if (!alive.current || token !== sequence.current) return;
        if (!result.ok) {
          if (['access_denied', 'unauthenticated'].includes(result.code)) clearPrivate();
          else if (result.code === 'conflict') { setReview(null); setAck(false); setPage(null); setPhase('error'); }
          setWriteError(result.error); return;
        }
        if (!accept(result, requestId)) { clearPrivate(); setWriteError('Kvittot kunde inte verifieras för det granskade underlaget och kontot. Kontrollera aktuell profil.'); return; }
        requests.current.delete(key); setReview(null); setAck(false);
      } catch { if (alive.current && token === sequence.current) setWriteError('Resultatet kunde inte bekräftas. Försök igen med samma granskade uppgifter och begäran, eller kontrollera aktuell profil.'); }
      finally { locked.current = false; if (alive.current && token === sequence.current) setWriting(false); }
    });
  }
  function save() {
    if (review?.kind !== 'profile') return;
    const confirmed = review;
    mutate(confirmed, nonce => saveCompanyStoreProfileAction({ companyId, expectedVersion: confirmed.expectedVersion, fields: confirmed.fields, reviewAcknowledged: true, requestId: nonce }), (result, nonce) => {
      if (!matchesScope(result) || !sameId(result.requestId, nonce) || !sameId(result.profile.companyId, companyId) || result.profile.version !== confirmed.expectedVersion + 1 || !sameStoreFields(result.profile.fields, confirmed.fields) || result.source.profileId !== result.profile.id || result.source.profileVersion !== result.profile.version || !sameId(result.source.companyId, companyId) || !sameStoreFields(result.source.shop, confirmed.fields)) return false;
      setEditing(false); setFields(result.profile.fields); setSelected(null);
      setMessage(`Butiksprofil version ${result.profile.version} är sparad och granskad av företaget. Ingen extern butik eller kanalanslutning har skapats.`);
      if (page && (page.profile?.version ?? 0) <= result.profile.version) { setPage({ ...page, profile: result.profile, source: result.source, sourceSha256: result.sourceSha256, canExport: page.identityValid, reason: page.identityValid ? null : 'invalid_organisation_number' }); setPhase('ready'); }
      else { setPage(null); setPhase('error'); }
      return true;
    });
  }
  function prepareExport() {
    if (review?.kind !== 'export') return;
    const confirmed = review;
    mutate(confirmed, nonce => prepareCompanyStoreExportAction({ companyId, expectedVersion: confirmed.source.profileVersion, expectedSourceSha256: confirmed.sourceSha256, channel: confirmed.channel, purpose: confirmed.purpose, reviewAcknowledged: true, attestationVersion: COMPANY_STORE_ATTESTATION_VERSION, requestId: nonce }), (result, nonce) => {
      const value = result.export;
      if (!matchesScope(result) || !sameId(result.requestId, nonce) || !sameId(value.companyId, companyId) || value.status !== 'prepared' || value.channel !== confirmed.channel || value.purpose !== confirmed.purpose || value.sourceSha256 !== confirmed.sourceSha256 || value.profileVersion !== confirmed.source.profileVersion || value.profileId !== confirmed.source.profileId || !sameSource(value.snapshot, confirmed.source)) return false;
      setSelected(value); setMessage('API-underlaget är förberett i Trafexa – inte skickat.');
      setPage(current => current ? { ...current, exports: [value, ...current.exports.filter(row => row.id !== value.id)].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)).slice(0, 20) } : current);
      return true;
    });
  }
  function readExport(exportId: string) {
    if (demo || locked.current) return;
    locked.current = true; const token = ++sequence.current; setWriting(true); setReadError(''); setSelected(null);
    startAction(async () => {
      try {
        const result = await getCompanyStoreExportAction({ companyId, exportId });
        if (!alive.current || token !== sequence.current) return;
        if (!result.ok) { if (['access_denied', 'unauthenticated'].includes(result.code)) clearPrivate(); setReadError(result.error); return; }
        if (!matchesScope(result) || !sameId(result.export.id, exportId) || !sameId(result.export.companyId, companyId) || !sameId(result.export.snapshot.companyId, companyId)) { clearPrivate(); setReadError('Det sparade API-underlaget kunde inte verifieras.'); return; }
        setSelected(result.export);
      } catch { if (alive.current && token === sequence.current) setReadError('Det sparade API-underlaget kunde inte hämtas. Försök igen.'); }
      finally { locked.current = false; if (alive.current && token === sequence.current) setWriting(false); }
    });
  }
  function prepareProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!current || busy || !event.currentTarget.reportValidity()) return;
    try { setReview({ kind: 'profile', expectedVersion: editVersion, fields: normalizeStoreFields(fields) }); setAck(false); setWriteError(''); setMessage(''); setSelected(null); }
    catch { setWriteError('Kontrollera hemsidans och logotypens HTTPS-länkar.'); }
  }
  return <details id="company-store-profile" className="surface" style={{ marginBottom: 24, padding: 20, minWidth: 0, overflowWrap: 'anywhere' }} onToggle={event => { if (event.currentTarget.open && phase === 'idle') refresh(); }}>
    <summary><strong>Butiksprofil &amp; API-underlag</strong></summary>
    <section aria-labelledby={`${field}-title`} style={{ paddingTop: 18, minWidth: 0 }}><h2 id={`${field}-title`}>Butikens uppgifter</h2><p>Butikens publika kontaktuppgifter är separata från ditt inloggningskonto. En sparad profil eller ett förberett API-underlag innebär ingen skapad butik hos Blocket eller Wayke.</p>
      {demo ? <p className="inline-note">Demonstration i läsläge. Inga butiksprofiler hämtas eller sparas.</p> : null}
      {phase === 'loading' ? <p role="status">Hämtar butiksprofil…</p> : null}{writing ? <p role="status">Behandlar granskad begäran…</p> : null}
      {readError ? <p role="alert">{readError}</p> : null}{writeError ? <p role="alert">{writeError}</p> : null}{message ? <p role="status">{message}</p> : null}
      {current ? <><dl className="detail-list"><div><dt>Juridiskt företagsnamn</dt><dd>{current.legalName}</dd></div><div><dt>Organisationsnummer</dt><dd>{current.organisationNumber}</dd></div></dl><p className="form-privacy">Bolagsuppgifterna hämtas från företagskontot och ändras med hjälp av Trafexa.</p>{!current.identityValid ? <p className="inline-note">Organisationsnumret behöver kontrolleras av Trafexa. Butiksprofilen får sparas, men API-underlag kan inte förberedas innan bolagsuppgifterna har rättats.</p> : null}
        {!editing && !review ? <>{current.profile ? <><p>Profilversion {current.profile.version} · Granskad av företaget · {current.profile.actorLabel}<br/>{new Date(current.profile.createdAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}</p><StoreFieldsSummary fields={current.profile.fields}/></> : <p>Ingen butiksprofil har sparats. Fyll i och granska butikens uppgifter för att fortsätta.</p>}<button type="button" className="button button-outline" disabled={busy} onClick={() => { setFields(current.profile ? { ...current.profile.fields } : blankStoreFields()); setEditVersion(current.profile?.version ?? 0); setEditing(true); setSelected(null); setMessage(''); }}>{current.profile ? 'Redigera butiksprofil' : 'Lägg till butiksprofil'}</button></> : null}
        {editing && (current.profile?.version ?? 0) !== editVersion ? <p role="alert">Profilen har ändrats sedan du började redigera. Dina inmatade uppgifter finns kvar. Sparandet får inte skriva över den senare versionen.</p> : null}
        {editing && !review ? <form onSubmit={prepareProfile} className="workspace-form" style={{ marginTop: 18 }}><StoreFieldsEditor fields={fields} disabled={busy} onChange={setFields}/><button className="button button-green" type="submit" disabled={busy}>Granska butiksprofil</button><button className="text-link" type="button" disabled={busy} onClick={() => setEditing(false)}>Avbryt redigering</button></form> : null}
        {!editing && !review && current.profile ? <section aria-label="Förbered API-underlag" style={{ marginTop: 24 }}><h3>Granskat API-underlag</h3><p>Underlaget följer Trafexas överföringsformat. Det är inte Blockets eller Waykes API-schema och skickas inte till någon kanal här.</p><div className="workspace-form"><label>Kanal för API-underlaget<select value={channel} disabled={busy || !current.canExport} onChange={event => setChannel(event.target.value as typeof channel)}><option value="">Välj kanal</option><option value="blocket">Blocket</option><option value="wayke">Wayke</option></select></label><label>Syfte med API-underlaget<select value={purpose} disabled={busy || !current.canExport} onChange={event => setPurpose(event.target.value as typeof purpose)}><option value="">Välj syfte</option><option value="new_store">Underlag för ny butik</option><option value="existing_store">Underlag för befintlig butik</option></select></label><button type="button" className="button button-outline" disabled={busy || !channel || !purpose || !current.canExport || !current.source || !current.sourceSha256} onClick={() => { if (current.source && current.sourceSha256 && channel && purpose) { setReview({ kind: 'export', source: current.source, sourceSha256: current.sourceSha256, channel, purpose }); setAck(false); setWriteError(''); setSelected(null); } }}>Granska API-underlag</button></div></section> : null}
      </> : null}
      {review ? <section className="workspace-form surface" aria-labelledby={`${field}-review`} style={{ padding: 18, marginTop: 20, minWidth: 0 }}><h3 id={`${field}-review`} ref={heading} tabIndex={-1}>{review.kind === 'profile' ? 'Granska butiksprofilen' : 'Granska fryst API-underlag'}</h3>{review.kind === 'profile' ? <StoreFieldsSummary fields={review.fields}/> : <><p>{channelLabel[review.channel]} · {purposeLabel[review.purpose]}<br/>Profilversion {review.source.profileVersion}<br/>{review.source.legalName} · {review.source.organisationNumber}</p><StoreFieldsSummary fields={review.source.shop}/><p className="form-note">Underlagets SHA-256: <span style={{ wordBreak: 'break-all' }}>{review.sourceSha256}</span></p><p>Förberett i Trafexa – inte skickat. Detta steg skapar ingen extern butik eller verifierad kanalanslutning.</p></>}<StoreAcknowledgement checked={ack} disabled={busy} onChange={setAck}>{review.kind === 'profile' ? 'Jag har granskat butikens publika uppgifter och vill spara denna profilversion.' : 'Jag har granskat exakt profilversion, bolagsuppgifter, kanal och syfte. Jag vill förbereda API-underlaget i Trafexa utan att skicka det.'}</StoreAcknowledgement><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" className="button button-green" disabled={busy || !ack} onClick={review.kind === 'profile' ? save : prepareExport}>{review.kind === 'profile' ? 'Bekräfta och spara profil' : 'Bekräfta och förbered API-underlag'}</button><button type="button" className="button button-outline" disabled={busy} onClick={() => { setReview(null); setAck(false); }}>Tillbaka och ändra</button></div></section> : null}
      {selected ? <section aria-label="Sparat API-underlag" className="surface" style={{ padding: 18, marginTop: 20, minWidth: 0 }}><h3>Förberett i Trafexa – inte skickat</h3><p>{channelLabel[selected.channel]} · {purposeLabel[selected.purpose]}<br/>Fryst profilversion {selected.profileVersion}<br/>{selected.snapshot.legalName} · {selected.snapshot.organisationNumber}</p><StoreFieldsSummary fields={selected.snapshot.shop}/><p className="form-note">Källans SHA-256: <span style={{ wordBreak: 'break-all' }}>{selected.sourceSha256}</span><br/>Exportens SHA-256: <span style={{ wordBreak: 'break-all' }}>{selected.exportSha256}</span></p><a href={`/api/company-store-profile/exports/${encodeURIComponent(selected.id)}?companyId=${encodeURIComponent(companyId)}`} className="text-link">Hämta förberett Trafexa-API-underlag</a></section> : null}
      {current ? <section aria-label="Senaste API-underlag" style={{ marginTop: 24 }}><h3>Senaste API-underlag</h3><p>Här visas högst de 20 senaste sparade underlagen. Listan omfattar inte hela historiken.</p>{current.exports.length ? <ol style={{ paddingLeft: 20 }}>{current.exports.slice(0, 20).map(value => <li key={value.id} style={{ marginBlock: 14 }}><strong>{channelLabel[value.channel]} · {purposeLabel[value.purpose]}</strong><br/>Profilversion {value.profileVersion} · Förberett i Trafexa – inte skickat<br/>{new Date(value.createdAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}{current.profile && value.profileVersion < current.profile.version ? <p className="muted">Bygger på en äldre profilversion.</p> : null}<button type="button" className="text-link" disabled={busy} onClick={() => readExport(value.id)}>Granska sparat API-underlag</button></li>)}</ol> : <p>Inga förberedda API-underlag finns i den verifierade listan.</p>}</section> : null}
      {!demo && phase !== 'idle' ? <button type="button" className="button button-outline" style={{ marginTop: 18 }} disabled={busy} onClick={refresh}>Kontrollera aktuell butiksprofil</button> : null}
      <p style={{ marginTop: 20 }}><a href={demo ? '/demo?section=advertising' : '/advertising#advertising-connections'}>Visa kanalanslutningar under Annonsering</a></p>
    </section>
  </details>;
}

export function StoreAcknowledgement({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} style={{ width: 'auto', flexShrink: 0 }}/><span>{children}</span></label>;
}
export function StoreFieldsEditor({ fields, disabled, onChange }: { fields: CompanyStoreFields; disabled: boolean; onChange: (fields: CompanyStoreFields) => void }) {
  const change = (key: keyof CompanyStoreFields, value: string) => onChange({ ...fields, [key]: value });
  return <><label>Butiksnamn<input value={fields.displayName} required minLength={2} maxLength={160} disabled={disabled} autoComplete="organization" onChange={event => change('displayName', event.target.value)}/></label><label>Besöksadress<input value={fields.addressLine1} required minLength={2} maxLength={160} disabled={disabled} autoComplete="address-line1" onChange={event => change('addressLine1', event.target.value)}/></label><label>Adressrad 2 (valfritt)<input value={fields.addressLine2 ?? ''} maxLength={160} disabled={disabled} autoComplete="address-line2" onChange={event => change('addressLine2', event.target.value)}/></label><div className="field-pair"><label>Postnummer<input value={fields.postalCode} required inputMode="numeric" pattern="[0-9]{3} ?[0-9]{2}" maxLength={6} disabled={disabled} autoComplete="postal-code" onChange={event => change('postalCode', event.target.value)}/></label><label>Ort<input value={fields.city} required minLength={2} maxLength={100} disabled={disabled} autoComplete="address-level2" onChange={event => change('city', event.target.value)}/></label></div><p>Land: Sverige (SE)</p><label>Butikens publika e-postadress<input type="email" value={fields.publicEmail} required maxLength={254} disabled={disabled} autoComplete="off" onChange={event => change('publicEmail', event.target.value)}/></label><p className="form-privacy">Ange butikens kontaktadress. Den hämtas inte från och ändrar inte ditt inloggningsmejl.</p><label>Butikens publika telefonnummer<input type="tel" value={fields.publicPhone} required minLength={7} maxLength={40} disabled={disabled} autoComplete="off" onChange={event => change('publicPhone', event.target.value)}/></label><label>Hemsida, HTTPS (valfritt)<input type="url" value={fields.websiteUrl ?? ''} maxLength={2048} pattern="https://.*" disabled={disabled} autoComplete="url" onChange={event => change('websiteUrl', event.target.value)}/></label><label>Länk till logotyp, HTTPS (valfritt)<input type="url" value={fields.logoUrl ?? ''} maxLength={2048} pattern="https://.*" disabled={disabled} autoComplete="off" onChange={event => change('logoUrl', event.target.value)}/></label><p className="form-privacy">Länkarna sparas som uppgifter. Ingen hemsida eller extern logotyp hämtas automatiskt. Internationella domännamn och punycode stöds inte ännu. Lämna det frivilliga URL-fältet tomt tills vidare.</p><label>Butikspresentation (valfritt)<textarea rows={3} maxLength={5000} value={fields.description ?? ''} disabled={disabled} onChange={event => change('description', event.target.value)}/></label><label>Öppettider (valfritt)<textarea rows={3} maxLength={2000} value={fields.openingHoursText ?? ''} disabled={disabled} onChange={event => change('openingHoursText', event.target.value)}/></label></>;
}
export function StoreFieldsSummary({ fields }: { fields: CompanyStoreFields }) {
  return <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}><dl className="detail-list"><div><dt>Butiksnamn</dt><dd>{fields.displayName}</dd></div><div><dt>Besöksadress</dt><dd>{fields.addressLine1}{fields.addressLine2 ? <><br/>{fields.addressLine2}</> : null}<br/>{fields.postalCode} {fields.city}<br/>Sverige (SE)</dd></div><div><dt>Publik e-postadress</dt><dd>{fields.publicEmail}</dd></div><div><dt>Publikt telefonnummer</dt><dd>{fields.publicPhone}</dd></div><div><dt>Hemsida</dt><dd>{fields.websiteUrl ? <a href={fields.websiteUrl} target="_blank" rel="noopener noreferrer">{fields.websiteUrl}</a> : 'Ej angiven'}</dd></div><div><dt>Logotyplänk</dt><dd>{fields.logoUrl ? <a href={fields.logoUrl} target="_blank" rel="noopener noreferrer">{fields.logoUrl}</a> : 'Ej angiven'}</dd></div></dl><p style={{ whiteSpace: 'pre-wrap' }}>Butikspresentation: {fields.description || 'Ej angiven'}<br/>Öppettider: {fields.openingHoursText || 'Ej angivna'}</p></div>;
}
