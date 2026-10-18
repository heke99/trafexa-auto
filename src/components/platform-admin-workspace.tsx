'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { activatePlatformAdminAction, erasePlatformWebApplicationAction, getPlatformWebApplicationAction, setPlatformWebApplicationStatusAction, listPlatformCompaniesAction, listPlatformContactRequestsAction, setPlatformCompanyStatusAction } from '@/lib/platform-admin/actions';
import { PlatformAccountAccess } from './platform-account-access';
import { PlatformApplicationInvitation } from './platform-application-invitation';
import { PlatformAdminOverview } from './platform-admin-overview';
import { getPlatformOverviewAction } from '@/lib/platform-admin/overview-actions';
import type { PlatformOverview } from '@/lib/platform-admin/overview-types';
import type { CompanyPage, CompanyStatus, PlatformCompany, PlatformContact } from '@/lib/platform-admin/database.types';

const PlatformAdvertisingReceivables = dynamic(() => import('./platform-advertising-receivables').then(module => module.PlatformAdvertisingReceivables), { loading: () => <p role="status">Läser in annonsfakturor…</p> });

const PlatformCompanyMembers = dynamic(() => import('./platform-memberships').then(module => module.PlatformCompanyMembers), { loading: () => <p role="status">Läser in företagsmedlemmar…</p> });
const AdvertisingBillingPanel = dynamic(() => import('./advertising-billing-panel').then(module => module.AdvertisingBillingPanel), { loading: () => <p role="status">Läser in kanalpriser…</p> });
const AdvertisingUsagePanel = dynamic(() => import('./advertising-usage-panel').then(module => module.AdvertisingUsagePanel), { loading: () => <p role="status">Läser in annonsunderlag…</p> });
const BlocketProvisioning = dynamic(() => import('./blocket-provisioning').then(module => module.BlocketProvisioning), { loading: () => <p role="status">Läser in Blocketadministration…</p> });

type AdminTab = 'overview' | 'companies' | 'contacts' | 'accounts' | 'receivables';
type Review = { company: PlatformCompany; status: CompanyStatus; reason: string; confirmed: boolean };
type CompanyView = 'members' | 'advertising' | 'billing' | 'blocket';
type CompanyDetailTarget = Pick<PlatformCompany, 'id' | 'name' | 'status'> & { organisationNumber?: string };
const companyViewLabels: Record<CompanyView, string> = { members: 'Medlemmar', advertising: 'Annonsunderlag', billing: 'Fakturering', blocket: 'Blocketkoppling' };
const applicationLabels: Record<string, string> = { new: 'Ny', in_review: 'Under granskning', contacted: 'Kontaktad', closed: 'Avslutad' };
const seekingLabels: Record<string, string> = { system: 'Trafexa-systemet', purchase_finance: 'Inköpsfinansiering', stock_finance: 'Lagerfinansiering', dealer_network: 'Handlarnätverk', advertising: 'Annonsering', other: 'Annat' };
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

export function PlatformAdminWorkspace({ initialPage, initialError, actorUserId }: { initialPage: CompanyPage; initialError: string | null; actorUserId: string }) {
  const [accountQuery,setAccountQuery]=useState<{filter:'all'|'pending'|'approved'|'rejected'|'suspended';search:string}>({filter:'pending',search:''});
  const accountCompanyReturn=useRef(false);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const overviewGeneration = useRef(0);
  const [companies, setCompanies] = useState(initialPage.companies);
  const [nextPageKey, setNextPageKey] = useState(initialPage.nextPageKey);
  const [contacts, setContacts] = useState<PlatformContact[]>([]);
  const [contactCursor, setContactCursor] = useState<string | null>(null);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const applicationHeading = useRef<HTMLHeadingElement>(null);
  const applicationTrigger = useRef<HTMLButtonElement | null>(null);
  const [application, setApplication] = useState<PlatformContact | null>(null);
  const [applicationAudit, setApplicationAudit] = useState<Array<{ status: string; reason: string; createdAt: string }>>([]);
  const [applicationReview, setApplicationReview] = useState<{ status: 'new' | 'in_review' | 'contacted' | 'closed'; reason: string; confirmed: boolean } | null>(null);
  const [erasureReview, setErasureReview] = useState<{ reason: 'rights_request' | 'no_longer_needed'; confirmed: boolean; applicationId: string; version: number; name: string } | null>(null);
  const erasureIntent = useRef<{ payload: string; requestId: string } | null>(null);
  const applicationIntent = useRef<{ payload: string; requestId: string } | null>(null);
  const [search, setSearch] = useState('');
  const [loadedSearch, setLoadedSearch] = useState('');
  const [companyDetail, setCompanyDetail] = useState<{ company: CompanyDetailTarget; view: CompanyView } | null>(null);
  const companyHeading = useRef<HTMLHeadingElement>(null);
  const companyTrigger = useRef<HTMLButtonElement | null>(null);
  const companyTab = useRef<HTMLButtonElement>(null);
  const accountTab = useRef<HTMLButtonElement>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [actionPending, startTransition] = useTransition();
  const [invitationBusy, setInvitationBusy] = useState(false);
  const invitationBusyRef = useRef(false);
  const [financeBusy, setFinanceBusy] = useState(false);
  const financeBusyRef = useRef(false);
  const handleFinanceBusy = useCallback((busy: boolean) => { financeBusyRef.current = busy; setFinanceBusy(busy); }, []);
  const pending = actionPending || invitationBusy || financeBusy;
  function handleInvitationBusy(busy: boolean) { invitationBusyRef.current = busy; setInvitationBusy(busy); }
  const generation = useRef(0);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const selectedCompanyId = review?.company.id;
  const reviewConfirmed = review?.confirmed;
  useEffect(() => { reviewHeading.current?.focus(); }, [selectedCompanyId, reviewConfirmed]);
  useEffect(() => { companyHeading.current?.focus(); }, [companyDetail?.company.id, companyDetail?.view]);
  useEffect(() => { applicationHeading.current?.focus(); }, [application?.id, application?.version]);
  const intent = useRef<{ payload: string; requestId: string } | null>(null);

  function handleFailure(result: { code: string; message: string }) {
    setError(result.message);
    if (result.code === 'access_denied') {
      financeBusyRef.current = false; setFinanceBusy(false);
      ++generation.current; ++overviewGeneration.current; setOverview(null); setOverviewError(null); setOverviewLoading(false); setDenied(true); setCompanyDetail(null); companyTrigger.current = null; setCompanies([]); setContacts([]); setNextPageKey(null); setContactCursor(null); setReview(null); setApplication(null); setApplicationAudit([]); setApplicationReview(null); setErasureReview(null);
    }
  }
  function loadOverview() {
    const requestGeneration = ++overviewGeneration.current;
    setOverview(null); setOverviewError(null); setOverviewLoading(true);
    void (async () => {
      try {
        const result = await getPlatformOverviewAction({});
        if (overviewGeneration.current !== requestGeneration) return;
        if (!result.ok) {
          if (result.code === 'access_denied') handleFailure(result);
          else setOverviewError(result.message);
          return;
        }
        setOverview(result.overview);
      } catch { if (overviewGeneration.current === requestGeneration) setOverviewError('Statistiken kunde inte läsas in. Försök igen.'); }
      finally { if (overviewGeneration.current === requestGeneration) setOverviewLoading(false); }
    })();
  }
  useEffect(() => { loadOverview(); return () => { ++overviewGeneration.current; ++generation.current; }; }, []);
  function navigate(nextTab: AdminTab) {
    if (invitationBusyRef.current || financeBusyRef.current) return;
    if (pending || denied) return;
    ++generation.current;
    accountCompanyReturn.current=false;
    setTab(nextTab); setCompanyDetail(null); setReview(null); setApplication(null); setApplicationAudit([]); setApplicationReview(null); setErasureReview(null); setError(null); setNotice(null);
    if (nextTab === 'contacts' && !contactsLoaded) loadContacts();
  }
  function openCompany(company: CompanyDetailTarget, view: CompanyView, trigger: HTMLButtonElement) {
    if (financeBusyRef.current) return;
    companyTrigger.current = trigger;
    setCompanyDetail({ company, view }); setReview(null); setError(null); setNotice(null);
  }
  function closeCompany() {
    if (financeBusyRef.current) return;
    setCompanyDetail(null);
    if(accountCompanyReturn.current){accountCompanyReturn.current=false;setTab('accounts');requestAnimationFrame(()=>accountTab.current?.focus());return;}
    if (companyTrigger.current?.isConnected) companyTrigger.current.focus(); else companyTab.current?.focus();
  }
  function loadCompanies(append = false) {
    const requestGeneration = ++generation.current;
    const query = append ? loadedSearch : search.trim();
    const cursor = append ? nextPageKey : null;
    setError(null); setNotice(null); setReview(null);
    if (!append) { setCompanyDetail(null); companyTrigger.current = null; accountCompanyReturn.current = false; intent.current = null; }
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
    if (invitationBusyRef.current) return;
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
        if (!result.ok) {
          if (result.code === 'conflict') {
            setReview(null); intent.current = null; setCompanies([]); setNextPageKey(null);
            try {
              const current = await listPlatformCompaniesAction({ search: loadedSearch, limit: 50 });
              if (generation.current !== requestGeneration) return;
              if (!current.ok) { handleFailure(current); return; }
              setCompanies(current.companies); setNextPageKey(current.nextPageKey);
            } catch { if (generation.current === requestGeneration) setError('Företagsstatusen har ändrats, men aktuell lista kunde inte läsas in. Sök igen och granska ett nytt beslut.'); return; }
          }
          handleFailure(result); return;
        }
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

  function closeApplication() {
    if (invitationBusyRef.current) return;
    setApplication(null); setApplicationReview(null); setErasureReview(null);
    applicationIntent.current = null; erasureIntent.current = null;
    requestAnimationFrame(() => applicationTrigger.current?.focus());
  }

  function loadApplication(applicationId: string) {
    if (invitationBusyRef.current) return;
    const requestGeneration = ++generation.current;
    setApplication(null); setApplicationAudit([]); setApplicationReview(null); setErasureReview(null); setError(null); setNotice(null);
    startTransition(async () => {
      try {
        const result = await getPlatformWebApplicationAction({ applicationId });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { handleFailure(result); return; }
        setApplication(result.application); setApplicationAudit(result.audit);
      } catch { if (generation.current === requestGeneration) setError('Ansökan kunde inte läsas in. Försök igen.'); }
    });
  }
  function saveApplicationStatus() {
    if (invitationBusyRef.current) return;
    if (!application || !applicationReview?.confirmed || pending || denied) return;
    const payload = { applicationId: application.id, expectedVersion: application.version, status: applicationReview.status, reason: applicationReview.reason.trim() };
    const fingerprint = JSON.stringify(payload);
    if (applicationIntent.current?.payload !== fingerprint) applicationIntent.current = { payload: fingerprint, requestId: crypto.randomUUID() };
    const requestGeneration = ++generation.current;
    const requestId = applicationIntent.current.requestId;
    setError(null); setNotice(null);
    startTransition(async () => {
      try {
        const result = await setPlatformWebApplicationStatusAction({ ...payload, requestId });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) {
          if (result.code !== 'conflict') { handleFailure(result); return; }
          // A definite version conflict cannot be retried with the old review.
          // Remove stale personal data before fetching the new decision source.
          const previousIndex = contacts.findIndex(item => item.id === payload.applicationId);
          setApplication(null); setApplicationAudit([]); setApplicationReview(null); setErasureReview(null);
          setContacts(previous => previous.filter(item => item.id !== payload.applicationId));
          applicationIntent.current = null;
          let current;
          try { current = await getPlatformWebApplicationAction({ applicationId: payload.applicationId }); }
          catch {
            if (generation.current === requestGeneration) setError('Ansökan har ändrats, men den aktuella versionen kunde inte läsas in. Uppdatera ansökningslistan och öppna ansökan igen.');
            return;
          }
          if (generation.current !== requestGeneration) return;
          if (!current.ok) { handleFailure(current); return; }
          setApplication(current.application); setApplicationAudit(current.audit);
          setContacts(previous => {
            const rows = previous.filter(item => item.id !== payload.applicationId);
            if (previousIndex >= 0) rows.splice(Math.min(previousIndex, rows.length), 0, current.application);
            return rows;
          });
          handleFailure(result);
          return;
        }
        const current = await getPlatformWebApplicationAction({ applicationId: payload.applicationId });
        if (generation.current !== requestGeneration) return;
        if (!current.ok) { handleFailure(current); return; }
        setApplication(current.application); setApplicationAudit(current.audit); setApplicationReview(null); applicationIntent.current = null;
        setContacts(previous => previous.map(item => item.id === current.application.id ? current.application : item));
        setNotice('Ansökans status har registrerats.');
      } catch { if (generation.current === requestGeneration) setError('Svaret kunde inte verifieras. Försök igen med samma uppgifter.'); }
    });
  }

  function eraseApplication() {
    if (invitationBusyRef.current) return;
    if (!application || !erasureReview?.confirmed || pending || denied) return;
    const payload = { applicationId: erasureReview.applicationId, expectedVersion: erasureReview.version, reason: erasureReview.reason };
    const fingerprint = JSON.stringify(payload);
    if (erasureIntent.current?.payload !== fingerprint) erasureIntent.current = { payload: fingerprint, requestId: crypto.randomUUID() };
    const requestId = erasureIntent.current.requestId;
    const requestGeneration = ++generation.current;
    setError(null); setNotice(null);
    startTransition(async () => {
      try {
        const result = await erasePlatformWebApplicationAction({ ...payload, requestId });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) {
          if (result.code === 'conflict') {
            setApplication(null); setApplicationAudit([]); setApplicationReview(null); setErasureReview(null);
            setContacts(previous => previous.filter(item => item.id !== payload.applicationId));
            erasureIntent.current = null;
            const current = await getPlatformWebApplicationAction({ applicationId: payload.applicationId });
            if (generation.current !== requestGeneration) return;
            if (!current.ok) { handleFailure(current); return; }
            setApplication(current.application); setApplicationAudit(current.audit);
          }
          handleFailure(result); return;
        }
        // Clear the selected personal data immediately; a receipt is not a current list.
        setApplication(null); setApplicationAudit([]); setApplicationReview(null); setErasureReview(null);
        setContacts(previous => previous.filter(item => item.id !== payload.applicationId));
        erasureIntent.current = null;
        const current = await listPlatformContactRequestsAction({ pageKey: null, limit: 50 });
        if (generation.current !== requestGeneration) return;
        if (!current.ok) { handleFailure(current); return; }
        setContacts(current.requests); setContactCursor(current.nextPageKey); setContactsLoaded(true);
        setNotice('Personuppgifterna har raderats.');
      } catch { if (generation.current === requestGeneration) setError('Svaret kunde inte verifieras. Försök igen med samma uppgifter.'); }
    });
  }

  return <main className="workspace-main platform-admin-workspace" style={{ paddingInline: 0 }}>
    <style>{`.platform-admin-workspace nav .table-controls{flex-wrap:wrap;gap:8px;justify-content:flex-start}.platform-admin-workspace nav .button{white-space:normal}.platform-admin-workspace .workspace-heading{min-width:0}.platform-admin-workspace .workspace-heading h1{overflow-wrap:anywhere}.platform-admin-workspace .admin-company-detail{margin-top:24px;min-width:0}.platform-admin-workspace .admin-company-detail h2{overflow-wrap:anywhere}.platform-admin-workspace .admin-company-views{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.platform-admin-workspace .admin-row-actions{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.platform-admin-workspace .admin-cell-label{display:none}.platform-admin-workspace .admin-responsive-table td{overflow-wrap:anywhere}.platform-admin-workspace .admin-account-controls{flex-wrap:wrap;align-items:flex-end}.platform-admin-workspace .admin-account-controls label{flex:1 1 220px;min-width:0}.platform-admin-workspace .admin-account-controls button{flex:0 0 auto}@media(max-width:600px){.platform-admin-workspace .admin-responsive-table,.platform-admin-workspace .admin-responsive-table tbody{display:block;min-width:0;width:100%}.platform-admin-workspace .admin-responsive-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.platform-admin-workspace .admin-responsive-table tbody{padding:0 16px}.platform-admin-workspace .admin-responsive-table tbody tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:18px 0;border-bottom:1px solid var(--line)}.platform-admin-workspace .admin-responsive-table td{display:block;border:0;padding:0;min-width:0;font-size:12px;line-height:1.5;white-space:normal}.platform-admin-workspace .admin-responsive-table td:first-child,.platform-admin-workspace .admin-responsive-table td:last-child,.platform-admin-workspace .admin-account-table td:nth-child(2){grid-column:1/-1}.platform-admin-workspace .admin-cell-label{display:block;font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px}.platform-admin-workspace .admin-responsive-table td:first-child strong{font-size:14px}.platform-admin-workspace .admin-row-actions{flex-direction:row;flex-wrap:wrap;gap:8px 18px}.platform-admin-workspace .admin-responsive-table .text-link{min-height:40px;font-size:12px}.platform-admin-workspace .admin-company-detail>.panel-heading{flex-wrap:wrap;gap:16px}.platform-admin-workspace .admin-company-views .button{flex:1 1 auto;min-width:0;white-space:normal}.platform-admin-workspace .admin-account-controls{justify-content:flex-start}.platform-admin-workspace .admin-account-controls label{flex-basis:100%}}`}</style>
    <div className="workspace-heading"><div><p className="eyebrow">Trafexa · Administration</p><h1>Plattformsadministration</h1><p>Följ plattformens aktivitet, hantera företagens åtkomst, följ annonsfakturor och handlägg ansökningar.</p></div></div>
    <nav className="table-toolbar" aria-label="Administrationsvyer"><div className="table-controls">{([['overview', 'Översikt'], ['companies', 'Företag'], ['contacts', 'Inkomna ansökningar'], ['accounts', 'Konton'], ['receivables', 'Annonsfakturor']] as const).map(([view, label]) => <button key={view} ref={view==='companies'?companyTab:view==='accounts'?accountTab:undefined} className={`button ${tab === view ? 'button-green' : 'button-outline'}`} type="button" aria-pressed={tab === view} disabled={pending || denied} onClick={() => navigate(view)}>{label}</button>)}</div></nav>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {pending && <p role="status">Läser in och verifierar…</p>}
    {!denied && tab === 'overview' && <PlatformAdminOverview overview={overview} loading={overviewLoading} error={overviewError} onRefresh={loadOverview} onNavigate={navigate}/> }
    {!denied && tab === 'accounts' && <PlatformAccountAccess key={actorUserId} actorUserId={actorUserId} onOpenApplications={() => navigate('contacts')} initialFilter={accountQuery.filter} initialSearch={accountQuery.search} onQueryChange={(filter,search)=>setAccountQuery({filter,search})} onOpenCompany={(company, trigger) => { navigate('companies'); accountCompanyReturn.current=true; openCompany(company, 'members', trigger); }} onAccessDenied={() => handleFailure({code:'access_denied',message:'Du har inte längre tillgång till plattformsadministrationen.'})}/> }
    {!denied && tab === 'receivables' && <PlatformAdvertisingReceivables key={actorUserId} actorUserId={actorUserId} onBusyChange={handleFinanceBusy} onDenied={message => handleFailure({ code: 'access_denied', message })}/>}
    {!denied && tab === 'companies' && <>
      <section className="surface" aria-label="Företag">
        <form className="table-toolbar" onSubmit={event => { event.preventDefault(); loadCompanies(); }}><div className="table-controls"><label className="search-field"><span className="sr-only">Sök företag eller organisationsnummer</span><input placeholder="Namn eller organisationsnummer" value={search} onChange={event => setSearch(event.target.value)} maxLength={160} disabled={pending}/></label><button type="submit" className="button button-outline" disabled={pending}>Sök</button></div></form>
        <div className="table-scroll"><table role="table" className="data-table admin-responsive-table"><caption className="sr-only">Företag som använder Trafexa</caption><thead><tr><th scope="col">Företag</th><th scope="col">Status</th><th scope="col">Medlemmar</th><th scope="col">Lagerobjekt</th><th scope="col">Registrerat</th><th scope="col">Åtgärd</th></tr></thead><tbody>{companies.map(company => <tr role="row" key={company.id}>
          <td><span className="admin-cell-label" aria-hidden="true">Företag</span><strong>{company.name}</strong><br/>{company.organisationNumber}</td>
          <td><span className="admin-cell-label" aria-hidden="true">Status</span><span className="badge">{statusLabel(company.status)}</span></td>
          <td><span className="admin-cell-label" aria-hidden="true">Medlemmar</span>{company.membershipCount}</td>
          <td><span className="admin-cell-label" aria-hidden="true">Lagerobjekt</span>{company.stockCount}</td>
          <td><span className="admin-cell-label" aria-hidden="true">Registrerat</span>{dateLabel(company.createdAt)}</td>
          <td><span className="admin-cell-label" aria-hidden="true">Åtgärder</span><div className="admin-row-actions"><button type="button" className="text-link" disabled={pending} onClick={() => { setCompanyDetail(null); setReview({ company, status: company.status === 'active' ? 'suspended' : 'active', reason: '', confirmed: false }); setError(null); setNotice(null); }}>Hantera status<span className="sr-only"> för {company.name}</span></button>{(['members', 'advertising', 'billing', 'blocket'] as const).map(view => <button key={view} type="button" className="text-link" disabled={pending} onClick={event => openCompany(company, view, event.currentTarget)}>{companyViewLabels[view]}<span className="sr-only"> för {company.name}</span></button>)}</div></td>
        </tr>)}</tbody></table></div>
        {!companies.length && <div className="empty-state"><h2>Inga företag hittades</h2><p>Ändra sökningen eller läs in listan igen.</p></div>}
        <div className="table-footer"><span>{companies.length} företag inlästa</span>{nextPageKey && <button type="button" className="text-link" disabled={pending} onClick={() => loadCompanies(true)}>Läs in fler</button>}</div>
      </section>
      {companyDetail && <section className="admin-company-detail" aria-label="Valt företags administration"><div className="panel-heading"><div><p className="eyebrow">Valt företag{companyDetail.company.organisationNumber ? ` · ${companyDetail.company.organisationNumber}` : ''}</p><h2 ref={companyHeading} tabIndex={-1}>{companyViewLabels[companyDetail.view]} för {companyDetail.company.name}</h2></div><button type="button" className="text-link" disabled={pending} onClick={closeCompany}>Stäng företagsvy</button></div>
        <nav className="admin-company-views" aria-label="Företagets administrationsvyer">{(['members', 'advertising', 'billing', 'blocket'] as const).map(view => <button key={view} type="button" className={`button ${companyDetail.view === view ? 'button-green' : 'button-outline'}`} aria-pressed={companyDetail.view === view} disabled={pending} onClick={() => { if (!financeBusyRef.current) setCompanyDetail(previous => previous ? { ...previous, view } : null); }}>{companyViewLabels[view]}</button>)}</nav>
        {companyDetail.view === 'members' && <PlatformCompanyMembers key={`${actorUserId}:${companyDetail.company.id}`} companyId={companyDetail.company.id} actorUserId={actorUserId} onAccessDenied={message => handleFailure({ code: 'access_denied', message })}/>}
        {companyDetail.view === 'advertising' && <AdvertisingUsagePanel companyId={companyDetail.company.id} userId={actorUserId} role="platform_admin" superadmin onDenied={message => handleFailure({ code: 'access_denied', message })}/>}
        {companyDetail.view === 'billing' && <AdvertisingBillingPanel companyId={companyDetail.company.id} userId={actorUserId} role="platform_admin" superadmin onBusyChange={handleFinanceBusy} onDenied={message => handleFailure({ code: 'access_denied', message })}/>}
        {companyDetail.view === 'blocket' && <BlocketProvisioning companyId={companyDetail.company.id} userId={actorUserId} onAccessDenied={message => handleFailure({ code: 'access_denied', message })}/>}
      </section>}
      {review && <section className="surface" aria-labelledby="status-review-title" style={{ marginTop: 24 }}><div className="panel-heading"><h2 ref={reviewHeading} tabIndex={-1} id="status-review-title">{review.confirmed ? 'Bekräfta statusändring' : 'Ändra företagsstatus'}</h2></div><div className="dialog-content"><form className="workspace-form" onSubmit={event => { event.preventDefault(); if (review.confirmed) saveStatus(); else setReview(previous => previous ? { ...previous, reason: previous.reason.trim(), confirmed: true } : null); }}><p><strong>{review.company.name}</strong> · {review.company.organisationNumber}</p><p>{statusLabel(review.company.status)} → {statusLabel(review.status)}</p><p>{review.status === 'suspended' ? 'Företagets användare förlorar åtkomst till företagets data. Befintlig information behålls.' : 'Aktiva medlemskap återfår åtkomst till företagets data.'}</p>{review.confirmed ? <div><strong>Motivering</strong><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.reason}</p></div> : <label>Motivering (obligatorisk)<input type="text" required maxLength={500} value={review.reason} disabled={pending} onChange={event => setReview(previous => previous ? { ...previous, reason: event.target.value } : null)}/></label>}<div className="table-controls"><button className="button button-green" type="submit" disabled={pending || !review.reason.trim()}>{review.confirmed ? review.status === 'suspended' ? 'Bekräfta avstängning' : 'Bekräfta aktivering' : 'Granska ändring'}</button>{review.confirmed && <button className="button button-outline" type="button" disabled={pending} onClick={() => setReview(previous => previous ? { ...previous, confirmed: false } : null)}>Ändra motivering</button>}<button className="text-link" type="button" disabled={pending} onClick={() => { setReview(null); intent.current = null; }}>Avbryt</button></div></form></div></section>}
    </>}
    {!denied && tab === 'contacts' && <>
      <section className="surface" hidden={!!application} aria-label="Inkomna ansökningar"><div className="panel-heading"><h2>Inkomna ansökningar</h2><button type="button" className="text-link" disabled={pending} onClick={() => { setApplication(null); setApplicationReview(null); loadContacts(); }}>Uppdatera</button></div><div className="table-scroll"><table role="table" className="data-table admin-responsive-table admin-applications-table"><caption className="sr-only">Ansökningar till Trafexa</caption><thead><tr><th scope="col">Kontakt</th><th scope="col">Företag</th><th scope="col">Söker</th><th scope="col">Status</th><th scope="col">Inkommet</th><th scope="col">Detaljer</th></tr></thead><tbody>{contacts.map(contact => <tr role="row" key={contact.id}><td><span className="admin-cell-label" aria-hidden="true">Kontakt</span><strong>{contact.name}</strong><br/><span style={{ overflowWrap: 'anywhere' }}>{contact.email}</span><br/>{contact.phone || '—'}</td><td><span className="admin-cell-label" aria-hidden="true">Företag</span>{contact.company}<br/>{contact.organisationNumber || 'Äldre förfrågan: ej angivet'}</td><td><span className="admin-cell-label" aria-hidden="true">Söker</span>{contact.seeking?.length ? contact.seeking.map(value => seekingLabels[value] || value).join(', ') : 'Äldre förfrågan: ej angivet'}</td><td><span className="admin-cell-label" aria-hidden="true">Status</span>{applicationLabels[contact.status] || contact.status}</td><td><span className="admin-cell-label" aria-hidden="true">Inkommet</span>{dateLabel(contact.createdAt)}</td><td><span className="admin-cell-label" aria-hidden="true">Detaljer</span><button type="button" className="text-link" disabled={pending} onClick={event => { applicationTrigger.current = event.currentTarget; loadApplication(contact.id); }}>Visa ansökan<span className="sr-only"> från {contact.name}</span></button></td></tr>)}</tbody></table></div>{contactsLoaded && !contacts.length && <div className="empty-state"><h2>Inga ansökningar ännu</h2><p>Ansökningar visas här när de kommer in.</p></div>}<div className="table-footer"><span>{contacts.length} ansökningar inlästa</span>{contactCursor && <button type="button" className="text-link" disabled={pending} onClick={() => loadContacts(true)}>Läs in äldre</button>}</div></section>
      {application && <section className="admin-application-detail" aria-labelledby="application-detail-heading">
        <div className="admin-application-toolbar"><button type="button" className="text-link" disabled={pending} onClick={closeApplication}>← Tillbaka till ansökningar<span className="sr-only"> · Stäng detaljer</span></button><button type="button" className="text-link" disabled={pending} onClick={() => { closeApplication(); loadContacts(); }}>Uppdatera</button></div>
        <header className="admin-application-summary">
          <div><p className="eyebrow">Inkommen ansökan · {dateLabel(application.createdAt)}</p><h2 id="application-detail-heading" ref={applicationHeading} tabIndex={-1}>Ansökan från {application.name}</h2><p>{application.company}</p></div>
          <span className="badge">{applicationLabels[application.status] || application.status}</span>
        </header>
        <div className="admin-application-layout">
          <div className="admin-application-information">
            <section className="admin-application-card" aria-labelledby="application-contact-heading"><h3 id="application-contact-heading">Företag och kontakt</h3><dl className="admin-application-fields">
              <div><dt>Företag och organisationsnummer</dt><dd>{application.company}<span className="admin-application-secondary">{application.organisationNumber || 'Ej angivet i äldre förfrågan'}</span></dd></div>
              <div><dt>Kontaktperson</dt><dd>{application.name}</dd></div>
              <div><dt>E-post</dt><dd>{application.email}</dd></div>
              <div><dt>Telefon</dt><dd>{application.phone || 'Ej angivet i äldre förfrågan'}</dd></div>
            </dl></section>
            <section className="admin-application-card" aria-labelledby="application-needs-heading"><h3 id="application-needs-heading">Önskemål och meddelande</h3><dl className="admin-application-fields">
              <div><dt>Vad de söker</dt><dd><div className="admin-application-tags">{application.seeking?.length ? application.seeking.map(value => <span key={value}>{seekingLabels[value] || value}</span>) : 'Ej angivet i äldre förfrågan'}</div></dd></div>
              <div><dt>Meddelande</dt><dd className="admin-application-message">{application.message || 'Inget meddelande angivet.'}</dd></div>
            </dl></section>

          </div>
          <div className="admin-application-actions">
            <div className="admin-application-card admin-application-approval"><PlatformApplicationInvitation key={`${application.id}:${application.version}`} application={application} actorUserId={actorUserId} disabled={actionPending || denied || !!erasureReview || !!applicationReview} onBusyChange={handleInvitationBusy} onAccessDenied={() => handleFailure({ code: 'access_denied', message: 'Administratörsåtkomsten kunde inte verifieras.' })} onComplete={() => loadApplication(application.id)}/></div>
            <section className="admin-application-card" aria-labelledby="application-status-heading"><h3 id="application-status-heading">Handlägg ansökan</h3><p>Följ ärendet med en handläggningsstatus. Statusändringen ger ingen kontotillgång och skickar inget mejl.</p>
        <form className="workspace-form" onSubmit={event => { event.preventDefault(); if (applicationReview?.confirmed) saveApplicationStatus(); else setApplicationReview(previous => previous ? { ...previous, confirmed: true, reason: previous.reason.trim() } : null); }}><label>Ny handläggningsstatus<select disabled={pending || !!erasureReview || applicationReview?.confirmed} value={applicationReview?.status || application.status} onChange={event => { applicationIntent.current = null; setApplicationReview({ status: event.target.value as 'new' | 'in_review' | 'contacted' | 'closed', reason: '', confirmed: false }); }}><option value="new">Ny</option><option value="in_review">Under granskning</option><option value="contacted">Kontaktad</option><option value="closed">Avslutad</option></select></label>{applicationReview && <><label>Motivering för handläggning<input required maxLength={500} disabled={pending || applicationReview.confirmed} value={applicationReview.reason} onChange={event => setApplicationReview(previous => previous ? { ...previous, reason: event.target.value } : null)}/></label>{applicationReview.confirmed && <p role="status">Granska: {applicationLabels[application.status]} → {applicationLabels[applicationReview.status]}. {applicationReview.reason}</p>}<button type="submit" className="button button-green" disabled={pending || !applicationReview.reason.trim()}>{applicationReview.confirmed ? 'Bekräfta handläggningsstatus' : 'Granska handläggningsstatus'}</button><button type="button" className="text-link" disabled={pending} onClick={() => { setApplicationReview(null); applicationIntent.current = null; }}>Avbryt ändring</button></>}</form></section>
          </div>
        </div>
        <div className="admin-application-history-section"><section className="admin-application-card" aria-labelledby="application-history-heading"><h3 id="application-history-heading">Handläggningshistorik</h3>{applicationAudit.length ? <ol className="admin-application-history">{applicationAudit.map((event, index) => <li key={index}><div><strong>{applicationLabels[event.status] || event.status}</strong><time dateTime={event.createdAt}>{dateLabel(event.createdAt)}</time></div><p>{event.reason}</p></li>)}</ol> : <p>Inga statusändringar registrerade.</p>}</section></div>
        <section className="admin-application-card admin-application-privacy-info" aria-labelledby="application-privacy-heading"><h3 id="application-privacy-heading">Integritet och personuppgifter</h3><dl className="admin-application-fields"><div><dt>Integritetsinformation</dt><dd>{application.privacyVersion ? `Version ${application.privacyVersion} · tagit del ${application.privacyAcknowledgedAt ? dateLabel(application.privacyAcknowledgedAt) : 'ej registrerat'}` : 'Ingen versionsregistrering i äldre förfrågan'}</dd></div></dl></section>
        <section aria-label="Radera ansökans personuppgifter" className="admin-application-card admin-application-privacy"><h3>Radera personuppgifter</h3><p>Radering tar bort ansökans kontaktuppgifter, meddelande och personuppgifter i handläggningshistoriken. Åtgärden kan inte ångras.</p>{!erasureReview ? <button type="button" className="button button-outline" disabled={pending} onClick={() => { setApplicationReview(null); setErasureReview({ reason: 'rights_request', confirmed: false, applicationId: application.id, version: application.version, name: application.name }); setError(null); }}>Radera personuppgifter</button> : <form className="workspace-form" onSubmit={event => { event.preventDefault(); if (erasureReview.confirmed) eraseApplication(); else setErasureReview(previous => previous ? { ...previous, confirmed: true } : null); }}><label>Skäl för radering<select disabled={pending || erasureReview.confirmed} value={erasureReview.reason} onChange={event => { erasureIntent.current = null; setErasureReview(previous => previous ? { ...previous, reason: event.target.value as 'rights_request' | 'no_longer_needed', confirmed: false } : null); }}><option value="rights_request">Begäran från den registrerade</option><option value="no_longer_needed">Uppgifterna behövs inte längre</option></select></label>{erasureReview.confirmed && <p role="status">Bekräfta radering av ansökan från {erasureReview.name}, version {erasureReview.version}. Personuppgifterna kan inte återställas.</p>}<button type="submit" className="button button-outline" disabled={pending}>{erasureReview.confirmed ? 'Bekräfta permanent radering' : 'Granska radering'}</button><button type="button" className="text-link" disabled={pending} onClick={() => { setErasureReview(null); erasureIntent.current = null; }}>Avbryt radering</button></form>}</section>
      </section>}
    </>}
  </main>;
}
