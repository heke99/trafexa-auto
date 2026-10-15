'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
const PlatformAccountMemberships = dynamic(() => import('./platform-memberships').then(module => module.PlatformAccountMemberships), { loading: () => <p role="status">Läser in kontots företag…</p> });
import { listPlatformAccountsAction, setPlatformAccountAccessAction } from '@/lib/platform-admin/account-actions';
import type { AccountStatus, PlatformAccount } from '@/lib/account-access/types';

const labels: Record<AccountStatus, string> = { pending: 'Inväntar godkännande', approved: 'Godkänt', rejected: 'Avslaget', suspended: 'Avstängt' };
type Review = { account: PlatformAccount; status: 'approved' | 'rejected' | 'suspended'; reason: string; confirmed: boolean };

export function PlatformAccountAccess({ actorUserId, onAccessDenied, onOpenCompany, initialFilter = 'pending', initialSearch = '', onQueryChange }: { actorUserId: string; onAccessDenied: () => void; initialFilter?: 'all'|AccountStatus; initialSearch?: string; onQueryChange?: (filter:'all'|AccountStatus,search:string)=>void; onOpenCompany?: (company: {id:string;name:string;status:'active'|'suspended'}, trigger: HTMLButtonElement) => void }) {
  const [membershipUser, setMembershipUser] = useState<string | null>(null);
  const membershipTrigger = useRef<HTMLButtonElement | null>(null);
  const [filter, setFilter] = useState<'all' | AccountStatus>(initialFilter);
  const [search, setSearch] = useState(initialSearch);
  const [loadedSearch, setLoadedSearch] = useState(initialSearch);
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  const intent = useRef<{ payload: string; requestId: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [review?.account.userId, review?.confirmed]);
  function fail(result: { code: string; message: string }) {
    setError(result.message);
    if (result.code === 'access_denied') {
      ++generation.current; setMembershipUser(null); setDenied(true); setAccounts([]); setCursor(null); setReview(null); intent.current = null; onAccessDenied();
    }
  }
  function load(selected: 'all' | AccountStatus, append = false, requestedSearch = search) {
    const token = ++generation.current;
    const query = append ? loadedSearch : requestedSearch.trim().toLowerCase();
    onQueryChange?.(selected,query);
    setMembershipUser(null); setReview(null); setError(null); setNotice(null); intent.current = null;
    if (!append) { setAccounts([]); setCursor(null); setLoaded(false); }
    startTransition(async () => {
      try {
        const result = await listPlatformAccountsAction({ filter: selected, search: query, pageKey: append ? cursor : null, limit: 50 });
        if (generation.current !== token) return;
        if (!result.ok) { fail(result); return; }
        setAccounts(previous => append ? [...previous, ...result.accounts.filter(row => !previous.some(item => item.userId === row.userId))] : result.accounts);
        setCursor(result.nextPageKey); setLoadedSearch(query); setLoaded(true);
      } catch { if (generation.current === token) setError('Kontona kunde inte läsas in. Försök igen.'); }
    });
  }
  useEffect(() => { load(initialFilter,false,initialSearch); return () => { ++generation.current; }; }, []);
  function save() {
    if (!review?.confirmed || pending || denied || review.account.userId === actorUserId || review.account.isPlatformAdmin) return;
    const payload = { userId: review.account.userId, expectedVersion: review.account.version, status: review.status, reason: review.reason.trim() };
    const fingerprint = JSON.stringify(payload);
    if (intent.current?.payload !== fingerprint) intent.current = { payload: fingerprint, requestId: crypto.randomUUID() };
    const requestId = intent.current.requestId;
    const token = ++generation.current;
    setError(null); setNotice(null);
    startTransition(async () => {
      try {
        const result = await setPlatformAccountAccessAction({ ...payload, requestId });
        if (generation.current !== token) return;
        if (!result.ok) {
          if (result.code === 'conflict') { setReview(null); setAccounts([]); setCursor(null); setLoaded(false); intent.current = null; }
          fail(result); return;
        }
        // An exact retry can return an old receipt. Only the current list establishes access now.
        setMembershipUser(null); setReview(null); setAccounts([]); setCursor(null); setLoaded(false); intent.current = null;
        const current = await listPlatformAccountsAction({ filter, search: loadedSearch, pageKey: null, limit: 50 });
        if (generation.current !== token) return;
        if (!current.ok) { fail(current); return; }
        setAccounts(current.accounts); setCursor(current.nextPageKey); setLoaded(true);
        setNotice('Kontobeslutet har registrerats. Listan visar aktuell åtkomst.');
      } catch { if (generation.current === token) setError('Svaret kunde inte verifieras. Försök igen med samma uppgifter.'); }
    });
  }
  return <section className="surface" aria-label="Kontogodkännande">
    <div className="panel-heading"><div><h2>Konton och åtkomst</h2><p>Registrering och bekräftad e-post ger ingen tillgång till systemet. Trafexa måste först godkänna kontot.</p></div></div>
    {!denied && <><div className="table-toolbar"><form className="table-controls admin-account-controls" onSubmit={event=>{event.preventDefault();load(filter);}}><label>Sök kontots e-post<input type="search" maxLength={254} value={search} disabled={pending} onChange={event=>setSearch(event.target.value)} placeholder="E-post eller del av adress"/></label><label>Visa konton<select value={filter} disabled={pending} onChange={event => { const next = event.target.value as 'all' | AccountStatus; setFilter(next); load(next); }}><option value="pending">Inväntar godkännande</option><option value="approved">Godkända</option><option value="rejected">Avslagna</option><option value="suspended">Avstängda</option><option value="all">Alla konton</option></select></label><button className="button button-outline" type="submit" disabled={pending}>Uppdatera konton</button></form></div>
      {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}{pending && <p role="status">Verifierar kontoåtkomst…</p>}
      <div className="table-scroll"><table role="table" className="data-table admin-responsive-table admin-account-table"><caption className="sr-only">Konton registrerade hos Trafexa</caption><thead><tr><th scope="col">Konto</th><th scope="col">E-post</th><th scope="col">Åtkomst</th><th scope="col">Registrerat</th><th scope="col">Åtgärd</th></tr></thead><tbody>{accounts.map(account => <tr role="row" key={account.userId}><td><span className="admin-cell-label" aria-hidden="true">Konto</span><strong style={{overflowWrap:'anywhere'}}>{account.name || account.email}</strong>{account.isPlatformAdmin && <p>Plattformsadministratör</p>}</td><td style={{overflowWrap:'anywhere'}}><span className="admin-cell-label" aria-hidden="true">E-post</span>{account.email}<br/>{account.emailVerified ? 'Bekräftad e-post' : 'E-post ej bekräftad'}</td><td><span className="admin-cell-label" aria-hidden="true">Åtkomst</span>{labels[account.status]}</td><td><span className="admin-cell-label" aria-hidden="true">Registrerat</span>{new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeZone: 'Europe/Stockholm' }).format(new Date(account.createdAt))}</td><td><span className="admin-cell-label" aria-hidden="true">Åtgärd</span><div className="admin-row-actions"><button className="text-link" type="button" disabled={pending} onClick={event => { membershipTrigger.current=event.currentTarget; setMembershipUser(account.userId); setReview(null); }}>Visa företag<span className="sr-only"> för {account.email}</span></button>{account.isPlatformAdmin || account.userId === actorUserId ? <span>Skyddad administratörsåtkomst</span> : <button className="text-link" type="button" disabled={pending} onClick={() => { setReview({ account, status: account.status === 'approved' ? 'suspended' : 'approved', reason: '', confirmed: false }); setError(null); setNotice(null); intent.current = null; }}>Granska konto<span className="sr-only"> {account.email}</span></button>}</div></td></tr>)}</tbody></table></div>
      {loaded && !accounts.length && <div className="empty-state"><h3>Inga konton i denna vy</h3><p>Nya registreringar visas under Inväntar godkännande.</p></div>}
      <div className="table-footer"><span>{accounts.length} konton inlästa</span>{cursor && <button className="text-link" type="button" disabled={pending} onClick={() => load(filter, true)}>Läs in fler konton</button>}</div>
      {membershipUser && <PlatformAccountMemberships key={`${actorUserId}:${membershipUser}`} userId={membershipUser} actorUserId={actorUserId} onAccessDenied={message => { setMembershipUser(null); fail({code:'access_denied',message}); }} onOpenCompany={(company, trigger) => onOpenCompany?.(company, trigger)} onClose={() => { setMembershipUser(null); if(membershipTrigger.current?.isConnected)membershipTrigger.current.focus(); }}/>}
      {review && <section className="dialog-content" aria-labelledby="account-review-heading"><h2 id="account-review-heading" ref={heading} tabIndex={-1}>{review.confirmed ? 'Bekräfta kontobeslut' : 'Granska kontoåtkomst'}</h2><form className="workspace-form" onSubmit={event => { event.preventDefault(); if (review.confirmed) save(); else setReview(previous => previous ? { ...previous, reason: previous.reason.trim(), confirmed: true } : null); }}><p style={{overflowWrap:'anywhere'}}><strong>{review.account.email}</strong><br/>{review.account.emailVerified ? 'E-postadressen är bekräftad.' : 'E-postadressen är inte bekräftad. Kontot kan inte godkännas ännu.'}</p><label htmlFor="account-access-decision">Beslut</label><select id="account-access-decision" disabled={pending || review.confirmed} value={review.status} onChange={event => { intent.current = null; setReview(previous => previous ? { ...previous, status: event.target.value as Review['status'] } : null); }}><option value="approved" disabled={!review.account.emailVerified}>Godkänn konto</option><option value="rejected">Avslå konto</option><option value="suspended">Stäng av konto</option></select><p>{labels[review.account.status]} → {labels[review.status]}</p><p>{review.status === 'approved' ? 'Godkännandet ger tillgång till kontots tillåtna funktioner. Företagsroller och finansiering bedöms separat.' : 'Kontot får inte använda arbetsytan, offerter eller företagsinbjudningar. Inloggning, lösenordsåterställning och utloggning är fortfarande möjliga.'}</p><label>Motivering för kontobeslut<input required minLength={2} maxLength={500} disabled={pending || review.confirmed} value={review.reason} onChange={event => setReview(previous => previous ? { ...previous, reason: event.target.value } : null)}/></label>{review.confirmed && <p role="status">Granska beslutet och motiveringen innan du bekräftar.</p>}<div className="table-controls"><button className="button button-green" type="submit" disabled={pending || review.reason.trim().length < 2 || (review.status === 'approved' && !review.account.emailVerified)}>{review.confirmed ? 'Bekräfta kontobeslut' : 'Granska beslut'}</button>{review.confirmed && <button className="button button-outline" type="button" disabled={pending} onClick={() => setReview(previous => previous ? { ...previous, confirmed: false } : null)}>Ändra beslut</button>}<button className="text-link" type="button" disabled={pending} onClick={() => { setReview(null); intent.current = null; }}>Avbryt kontobeslut</button></div></form></section>}
    </>}
  </section>;
}
