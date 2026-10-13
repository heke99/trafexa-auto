'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { activatePlatformAdminAction, listPlatformCompaniesAction, listPlatformContactRequestsAction, setPlatformCompanyStatusAction } from '@/lib/platform-admin/actions';
import type { CompanyPage, CompanyStatus, PlatformCompany, PlatformContact } from '@/lib/platform-admin/database.types';

type Review = { company: PlatformCompany; status: CompanyStatus; reason: string; confirmed: boolean };
const statusLabel = (status: CompanyStatus) => status === 'active' ? 'Aktivt' : 'Avstängt';
const dateLabel = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeZone: 'Europe/Stockholm' }).format(new Date(value));

export function PlatformAdminActivation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return <main className="workspace-main"><div className="empty-state"><h1>Administratörsåtkomst krävs</h1><p>Åtkomsten måste vara förgodkänd av Trafexa. Ett företagskonto ger ingen administratörsbehörighet.</p><button type="button" className="button button-green" disabled={pending} onClick={() => startTransition(async () => {
    setMessage(null);
    try { const result = await activatePlatformAdminAction({}); if (result.ok) router.refresh(); else setMessage(result.message); } catch { setMessage('Åtkomsten kunde inte verifieras. Försök igen.'); }
  })}>{pending ? 'Verifierar åtkomst…' : 'Aktivera administratörsåtkomst'}</button>{message && <p role="alert">{message}</p>}</div></main>;
}

export function PlatformAdminWorkspace({ initialPage, initialError }: { initialPage: CompanyPage; initialError: string | null }) {
  const [tab, setTab] = useState<'companies' | 'contacts'>('companies');
  const [companies, setCompanies] = useState(initialPage.companies);
  const [nextPageKey, setNextPageKey] = useState(initialPage.nextPageKey);
  const [contacts, setContacts] = useState<PlatformContact[]>([]);
  const [contactCursor, setContactCursor] = useState<string | null>(null);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [loadedSearch, setLoadedSearch] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const selectedCompanyId = review?.company.id;
  const reviewConfirmed = review?.confirmed;
  useEffect(() => { reviewHeading.current?.focus(); }, [selectedCompanyId, reviewConfirmed]);
  const intent = useRef<{ payload: string; requestId: string } | null>(null);

  function handleFailure(result: { code: string; message: string }) {
    setError(result.message);
    if (result.code === 'access_denied') {
      setDenied(true); setCompanies([]); setContacts([]); setNextPageKey(null); setContactCursor(null); setReview(null);
    }
  }
  function loadCompanies(append = false) {
    const requestGeneration = ++generation.current;
    const query = append ? loadedSearch : search.trim();
    const cursor = append ? nextPageKey : null;
    setError(null); setNotice(null); setReview(null);
    startTransition(async () => {
      try {
        const result = await listPlatformCompaniesAction({ search: query, pageKey: cursor, limit: 50 });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { handleFailure(result); return; }
        setCompanies(previous => append ? [...previous, ...result.companies.filter(company => !previous.some(item => item.id === company.id))] : result.companies);
        setNextPageKey(result.nextPageKey); setLoadedSearch(query);
      } catch { if (generation.current === requestGeneration) setError('Listan kunde inte läsas in. Försök igen.'); }
    });
  }
  function loadContacts(append = false) {
    const requestGeneration = ++generation.current;
    setError(null); setNotice(null); setReview(null);
    startTransition(async () => {
      try {
        const result = await listPlatformContactRequestsAction({ pageKey: append ? contactCursor : null, limit: 50 });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { handleFailure(result); return; }
        setContacts(previous => append ? [...previous, ...result.requests.filter(contact => !previous.some(item => item.id === contact.id))] : result.requests);
        setContactCursor(result.nextPageKey); setContactsLoaded(true);
      } catch { if (generation.current === requestGeneration) setError('Kontakterna kunde inte läsas in. Försök igen.'); }
    });
  }
  function saveStatus() {
    if (!review?.confirmed || denied || pending) return;
    const selected = review;
    const payload = { companyId: selected.company.id, expectedStatus: selected.company.status, status: selected.status, reason: selected.reason.trim() };
    const fingerprint = JSON.stringify(payload);
    if (intent.current?.payload !== fingerprint) intent.current = { payload: fingerprint, requestId: crypto.randomUUID() };
    const requestId = intent.current.requestId;
    const requestGeneration = ++generation.current;
    setError(null); setNotice(null);
    startTransition(async () => {
      try {
        const result = await setPlatformCompanyStatusAction({ ...payload, requestId });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { handleFailure(result); return; }
        setReview(null); intent.current = null;
        setNotice('Statusändringen har registrerats.');
        // A repeated request may return a historical receipt; only a fresh list establishes current status.
        const current = await listPlatformCompaniesAction({ search: loadedSearch, limit: 50 });
        if (generation.current !== requestGeneration) return;
        if (!current.ok) { handleFailure(current); return; }
        setCompanies(current.companies); setNextPageKey(current.nextPageKey);
      } catch { if (generation.current === requestGeneration) setError('Svaret kunde inte verifieras. Försök igen med samma uppgifter.'); }
    });
  }

  return <main className="workspace-main" style={{ paddingInline: 0 }}>
    <div className="workspace-heading"><div><p className="eyebrow">Trafexa · Administration</p><h1>Plattformsadministration</h1><p>Hantera företagens tillgång och inkomna kontakter.</p></div></div>
    <div className="table-toolbar"><div className="table-controls" aria-label="Administrationsvyer"><button className="button button-outline" type="button" aria-pressed={tab === 'companies'} disabled={pending || denied} onClick={() => { ++generation.current; setTab('companies'); setReview(null); setError(null); }}>Företag</button><button className="button button-outline" type="button" aria-pressed={tab === 'contacts'} disabled={pending || denied} onClick={() => { setTab('contacts'); setReview(null); if (!contactsLoaded) loadContacts(); }}>Inkomna kontakter</button></div></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {pending && <p role="status">Läser in och verifierar…</p>}
    {!denied && tab === 'companies' && <>
      <section className="surface" aria-label="Företag">
        <form className="table-toolbar" onSubmit={event => { event.preventDefault(); loadCompanies(); }}><div className="table-controls"><label className="search-field"><span className="sr-only">Sök företag eller organisationsnummer</span><input placeholder="Namn eller organisationsnummer" value={search} onChange={event => setSearch(event.target.value)} maxLength={160} disabled={pending}/></label><button type="submit" className="button button-outline" disabled={pending}>Sök</button></div></form>
        <div className="table-scroll"><table className="data-table"><caption className="sr-only">Företag som använder Trafexa</caption><thead><tr><th scope="col">Företag</th><th scope="col">Status</th><th scope="col">Medlemmar</th><th scope="col">Lagerobjekt</th><th scope="col">Registrerat</th><th scope="col">Åtgärd</th></tr></thead><tbody>{companies.map(company => <tr key={company.id}><td><strong>{company.name}</strong><br/>{company.organisationNumber}</td><td><span className="badge">{statusLabel(company.status)}</span></td><td>{company.membershipCount}</td><td>{company.stockCount}</td><td>{dateLabel(company.createdAt)}</td><td><button type="button" className="text-link" disabled={pending} onClick={() => { setReview({ company, status: company.status === 'active' ? 'suspended' : 'active', reason: '', confirmed: false }); setError(null); setNotice(null); }}>Hantera status<span className="sr-only"> för {company.name}</span></button></td></tr>)}</tbody></table></div>
        {!companies.length && <div className="empty-state"><h2>Inga företag hittades</h2><p>Ändra sökningen eller läs in listan igen.</p></div>}
        <div className="table-footer"><span>{companies.length} företag inlästa</span>{nextPageKey && <button type="button" className="text-link" disabled={pending} onClick={() => loadCompanies(true)}>Läs in fler</button>}</div>
      </section>
      {review && <section className="surface" aria-labelledby="status-review-title" style={{ marginTop: 24 }}><div className="panel-heading"><h2 ref={reviewHeading} tabIndex={-1} id="status-review-title">{review.confirmed ? 'Bekräfta statusändring' : 'Ändra företagsstatus'}</h2></div><div className="dialog-content"><form className="workspace-form" onSubmit={event => { event.preventDefault(); if (review.confirmed) saveStatus(); else setReview(previous => previous ? { ...previous, reason: previous.reason.trim(), confirmed: true } : null); }}><p><strong>{review.company.name}</strong> · {review.company.organisationNumber}</p><p>{statusLabel(review.company.status)} → {statusLabel(review.status)}</p><p>{review.status === 'suspended' ? 'Företagets användare förlorar åtkomst till företagets data. Befintlig information behålls.' : 'Aktiva medlemskap återfår åtkomst till företagets data.'}</p>{review.confirmed ? <div><strong>Motivering</strong><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.reason}</p></div> : <label>Motivering (obligatorisk)<input type="text" required maxLength={500} value={review.reason} disabled={pending} onChange={event => setReview(previous => previous ? { ...previous, reason: event.target.value } : null)}/></label>}<div className="table-controls"><button className="button button-green" type="submit" disabled={pending || !review.reason.trim()}>{review.confirmed ? review.status === 'suspended' ? 'Bekräfta avstängning' : 'Bekräfta aktivering' : 'Granska ändring'}</button>{review.confirmed && <button className="button button-outline" type="button" disabled={pending} onClick={() => setReview(previous => previous ? { ...previous, confirmed: false } : null)}>Ändra motivering</button>}<button className="text-link" type="button" disabled={pending} onClick={() => { setReview(null); intent.current = null; }}>Avbryt</button></div></form></div></section>}
    </>}
    {!denied && tab === 'contacts' && <section className="surface" aria-label="Inkomna kontakter"><div className="panel-heading"><h2>Inkomna kontakter</h2><button type="button" className="text-link" disabled={pending} onClick={() => loadContacts()}>Uppdatera</button></div><div className="table-scroll"><table className="data-table"><caption className="sr-only">Kontaktförfrågningar till Trafexa</caption><thead><tr><th scope="col">Kontakt</th><th scope="col">Företag</th><th scope="col">Meddelande</th><th scope="col">Inkommet</th></tr></thead><tbody>{contacts.map(contact => <tr key={contact.id}><td><strong>{contact.name}</strong><br/><span style={{ overflowWrap: 'anywhere' }}>{contact.email}</span>{contact.phone && <><br/>{contact.phone}</>}</td><td>{contact.company}</td><td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 420 }}>{contact.message || '—'}</td><td>{dateLabel(contact.createdAt)}</td></tr>)}</tbody></table></div>{contactsLoaded && !contacts.length && <div className="empty-state"><h2>Inga kontakter ännu</h2><p>Kontaktförfrågningar visas här när de kommer in.</p></div>}<div className="table-footer"><span>{contacts.length} kontakter inlästa</span>{contactCursor && <button type="button" className="text-link" disabled={pending} onClick={() => loadContacts(true)}>Läs in äldre</button>}</div></section>}
  </main>;
}
