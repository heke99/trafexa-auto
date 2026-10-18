'use client';

import { useRouter } from 'next/navigation';
import { lazy, Suspense, useEffect, useRef, useState, useTransition } from 'react';
const OwnershipTransfer = lazy(() => import('./company-ownership-transfer').then(module => ({ default: module.CompanyOwnershipTransfer })));
import { cancelCompanyInvitationAction, inviteCompanyMemberAction, listCompanyTeamAction, updateCompanyMemberAction } from '@/lib/company-team/actions';

import type { CompanyTeamPage, InviteRole } from '@/lib/company-team/database.types';

type TeamPage = CompanyTeamPage & { ok: true };
type Member = TeamPage['members'][number];
type Invitation = TeamPage['invitations'][number];
type Role = 'owner' | 'admin' | 'sales' | 'finance' | 'viewer';
type MemberStatus = 'active' | 'suspended';
type Review = { kind: 'member'; member: Member; role: Role; status: MemberStatus; reason: string; confirmed: boolean }
  | { kind: 'invite'; email: string; role: InviteRole; teamVersion: number; confirmed: boolean }
  | { kind: 'cancel'; invitation: Invitation; reason: string; confirmed: boolean };
const roleLabels: Record<Role, string> = { owner: 'Ägare', admin: 'Administratör', sales: 'Säljare', finance: 'Finansansvarig', viewer: 'Läsbehörighet' };
const statusLabel = (status: string) => ({ active: 'Aktiv', suspended: 'Avstängd', pending: 'Väntar på svar', accepted: 'Accepterad', cancelled: 'Återkallad', revoked: 'Återkallad', expired: 'Utgången' }[status] ?? status);
const dateLabel = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeZone: 'Europe/Stockholm' }).format(new Date(value));
const validReason = (reason: string) => reason.trim().length > 0 && reason.trim().length <= 500 && !/[\u0000-\u001f\u007f]/.test(reason);
const sameId = (left: unknown, right: string) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
const lowerRoles: InviteRole[] = ['sales', 'finance', 'viewer'];

type Props = { companyId: string; companyRole: string; userId: string };
export function CompanyTeam(props: Props) { return <TeamPanel key={`${props.companyId.toLowerCase()}:${props.userId.toLowerCase()}:${props.companyRole}`} {...props}/>; }
function TeamPanel({ companyId, companyRole, userId }: Props) {
  const router = useRouter();
  const [ownershipOpen, setOwnershipOpen] = useState(false);
  const [page, setPage] = useState<TeamPage | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('sales');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);
  const [denied, setDenied] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const nonces = useRef(new Map<string, string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const allowed = ['owner', 'admin'].includes(companyRole) && !denied;
  const actorRole = page?.actorRole ?? companyRole;
  const roles: InviteRole[] = actorRole === 'owner' ? ['admin', ...lowerRoles] : lowerRoles;
  const canManage = (member: Member) => member.role !== 'owner' && !sameId(member.userId, page?.actorUserId ?? userId) && (actorRole === 'owner' || lowerRoles.some(role => role === member.role));
  const canCancel = (invitation: Invitation) => invitation.status === 'pending' && new Date(invitation.expiresAt).getTime() > Date.now() && (actorRole === 'owner' || lowerRoles.some(role => role === invitation.role));
  useEffect(() => { heading.current?.focus(); }, [review?.kind, review?.confirmed]);

  function failure(result: { code: string; message: string }) {
    setError(result.message);
    if (['access_denied', 'unauthenticated'].includes(result.code)) { ++generation.current; setDenied(true); setPage(null); setReview(null); setInvited(false); setEmail(''); setInviteRole('sales'); setNotice(null); setOwnershipOpen(false); nonces.current.clear(); }
  }
  async function readCurrent(requestGeneration: number, append = false, previousPage?: TeamPage | null) {
    if (append && previousPage && (!sameId(previousPage.companyId, companyId) || !sameId(previousPage.actorUserId, userId) || previousPage.actorRole !== companyRole)) { failure({ code: 'access_denied', message: 'Teamets konto eller behörighet har ändrats. Läs in sidan igen.' }); return false; }
    const membersPageKey = append ? previousPage?.nextMembersPageKey : null;
    const invitationsPageKey = append ? previousPage?.nextInvitationsPageKey : null;
    const result = await listCompanyTeamAction({ companyId, membersPageKey, invitationsPageKey, limit: 50 });
    if (generation.current !== requestGeneration) return false;
    if (!result.ok) { setPage(null); failure(result); return false; }
    if (!sameId(result.companyId, companyId) || !sameId(result.actorUserId, userId) || result.actorRole !== companyRole || !['owner', 'admin'].includes(result.actorRole)) { failure({ code: 'access_denied', message: 'Du har inte längre behörighet att hantera teamet.' }); return false; }
    setInviteRole(previous => result.actorRole === 'owner' || lowerRoles.includes(previous) ? previous : 'sales');
    setPage(previous => append && previous ? { ...result,
      members: membersPageKey ? [...previous.members, ...result.members.filter(member => !previous.members.some(item => item.id === member.id))] : previous.members,
      invitations: invitationsPageKey ? [...previous.invitations, ...result.invitations.filter(invitation => !previous.invitations.some(item => item.id === invitation.id))] : previous.invitations,
      nextMembersPageKey: membersPageKey ? result.nextMembersPageKey : previous.nextMembersPageKey,
      nextInvitationsPageKey: invitationsPageKey ? result.nextInvitationsPageKey : previous.nextInvitationsPageKey,
    } : result);
    return true;
  }
  function load(append = false) {
    if (!allowed || inFlight.current) return;
    inFlight.current = true;
    const requestGeneration = ++generation.current;
    setError(null); setReview(null);
    startTransition(async () => {
      try { await readCurrent(requestGeneration, append, page); }
      catch { if (generation.current === requestGeneration) { setPage(null); setError('Teamet kunde inte läsas in. Uppdatera listan för att verifiera aktuell åtkomst.'); } }
      finally { inFlight.current = false; }
    });
  }
  useEffect(() => {
    const requestGeneration = ++generation.current;
    inFlight.current = true;
    startTransition(async () => {
      try { await readCurrent(requestGeneration); }
      catch { if (generation.current === requestGeneration) { setPage(null); setError('Listan kunde inte verifieras. Uppdatera för att läsa in aktuell åtkomst.'); } }
      finally { if (generation.current === requestGeneration) inFlight.current = false; }
    });
    return () => { ++generation.current; };
  }, [companyId, companyRole, userId]); // Server props identify this company workspace; each read verifies the actor again.

  function save() {
    if (!review?.confirmed || !allowed || inFlight.current) return;
    const selected = review;
    if (selected.kind === 'invite' && !roles.includes(selected.role)) return;
    if (selected.kind === 'member' && (!canManage(selected.member) || !validReason(selected.reason))) return;
    if (selected.kind === 'cancel' && (!canCancel(selected.invitation) || !validReason(selected.reason))) return;
    const payload = selected.kind === 'member'
      ? { companyId, membershipId: selected.member.id, expectedVersion: selected.member.version, role: selected.role, status: selected.status, reason: selected.reason.trim() }
      : selected.kind === 'invite' ? { companyId, email: selected.email, role: selected.role, expectedTeamVersion: selected.teamVersion }
        : { companyId, invitationId: selected.invitation.id, expectedVersion: selected.invitation.version, reason: selected.reason.trim() };
    const fingerprint = JSON.stringify({ kind: selected.kind, ...payload });
    if (!nonces.current.has(fingerprint)) nonces.current.set(fingerprint, crypto.randomUUID());
    const requestId = nonces.current.get(fingerprint)!;
    const requestGeneration = ++generation.current;
    inFlight.current = true; setError(null); setNotice(null);
    startTransition(async () => {
      let received = false;
      try {
        const result = selected.kind === 'member'
          ? await updateCompanyMemberAction({ companyId, membershipId: selected.member.id, expectedVersion: selected.member.version, role: selected.role, status: selected.status, reason: selected.reason.trim(), requestId })
          : selected.kind === 'invite' ? await inviteCompanyMemberAction({ companyId, email: selected.email, role: selected.role, expectedTeamVersion: selected.teamVersion, requestId })
            : await cancelCompanyInvitationAction({ companyId, invitationId: selected.invitation.id, expectedVersion: selected.invitation.version, reason: selected.reason.trim(), requestId });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { failure(result); return; }
        received = true; setReview(null); setPage(null);
        if (selected.kind === 'invite') { setInvited(true); setEmail(''); }
        // A historical receipt confirms this request, not the team's current roles or invitation state.
        const refreshed = await readCurrent(requestGeneration);
        if (refreshed && generation.current === requestGeneration) setNotice('Åtgärden har registrerats. Listan har lästs in på nytt.');
      } catch {
        if (generation.current !== requestGeneration) return;
        if (received) { setPage(null); setError('Åtgärden har registrerats, men aktuell lista kunde inte verifieras. Uppdatera teamet.'); }
        else setError('Svaret kunde inte verifieras. Försök igen med samma uppgifter och samma begäran.');
      } finally { inFlight.current = false; }
    });
  }
  if (!allowed) return <section className="surface" aria-label="Företagets team"><div className="panel-heading"><h2>Företagets team</h2></div><p className="form-error" role="alert">{error ?? 'Ägare eller administratör krävs för att hantera företagets team.'}</p></section>;
  return <section aria-label="Företagets team" style={{ marginTop: 24 }}>
    <div className="surface"><div className="panel-heading"><h2>Företagets team</h2><button type="button" className="text-link" disabled={pending} onClick={() => load()}>Uppdatera teamet</button></div>
      <p className="settings-note">Företagsroller styr endast åtkomst till det här företaget. Ägare och din egen behörighet ändras inte här.</p>
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}{pending && <p role="status">Verifierar företagets team…</p>}
      {page && <><div className="table-scroll"><table className="data-table"><caption className="sr-only">Företagets medlemmar</caption><thead><tr><th scope="col">Medlem</th><th scope="col">Roll</th><th scope="col">Status</th><th scope="col">Åtgärd</th></tr></thead><tbody>{page.members.map(member => <tr key={member.id}><td><strong>{member.email || 'Medlem'}</strong>{member.email && <small className="cell-subtext" style={{ overflowWrap: 'anywhere' }}>{member.email}</small>}{sameId(member.userId, page.actorUserId) && <span className="badge">Du</span>}</td><td>{roleLabels[member.role as Role]}</td><td>{statusLabel(member.status)}</td><td>{canManage(member) ? <button type="button" className="text-link" disabled={pending} onClick={() => { setReview({ kind: 'member', member, role: member.role as Role, status: member.status as MemberStatus, reason: '', confirmed: false }); setError(null); setNotice(null); }}>Hantera medlem<span className="sr-only"> {member.email}</span></button> : <span className="muted">Skyddad behörighet</span>}</td></tr>)}</tbody></table></div>
        <div className="panel-heading"><h3>Inbjudningar</h3></div><div className="table-scroll"><table className="data-table"><caption className="sr-only">Företagets inbjudningar</caption><thead><tr><th scope="col">E-post</th><th scope="col">Roll</th><th scope="col">Status</th><th scope="col">Giltig till</th><th scope="col">Åtgärd</th></tr></thead><tbody>{page.invitations.map(invitation => <tr key={invitation.id}><td style={{ overflowWrap: 'anywhere' }}>{invitation.email}</td><td>{roleLabels[invitation.role as Role]}</td><td>{statusLabel(invitation.status)}</td><td>{dateLabel(invitation.expiresAt)}</td><td>{canCancel(invitation) ? <button type="button" className="text-link" disabled={pending} onClick={() => { setReview({ kind: 'cancel', invitation, reason: '', confirmed: false }); setError(null); setNotice(null); }}>Återkalla inbjudan<span className="sr-only"> {invitation.email}</span></button> : '—'}</td></tr>)}</tbody></table></div>
        {!page.members.length && !page.invitations.length && <p className="quiet-empty">Inga medlemmar eller inbjudningar i den här listan.</p>}
        <div className="table-footer"><span>{page.members.length} medlemmar · {page.invitations.length} inbjudningar inlästa</span>{(page.nextMembersPageKey || page.nextInvitationsPageKey) && <button type="button" className="text-link" disabled={pending} onClick={() => load(true)}>Läs in fler</button>}</div></>}
      <form className="workspace-form" style={{ padding: 20 }} onSubmit={event => { event.preventDefault(); if (inFlight.current || !page || !event.currentTarget.reportValidity()) return; setReview({ kind: 'invite', email: email.trim().toLowerCase(), role: inviteRole, teamVersion: page.teamVersion, confirmed: false }); setError(null); setNotice(null); }}>
        <h3>Bjud in en kollega</h3><label>Kollegans e-postadress<input name="email" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={pending || !page} autoComplete="off"/></label>
        <label>Roll för kollegan<select value={inviteRole} onChange={event => setInviteRole(event.target.value as InviteRole)} disabled={pending || !page}>{roles.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><p className="form-privacy">Inbjudan gäller i sju dagar. Inga mejl skickas automatiskt. Kollegan loggar in med den inbjudna e-postadressen.</p><button type="submit" className="button button-green" disabled={pending || !page}>Granska inbjudan</button>
      </form>
      {invited && <div className="notice" role="status"><p>Inbjudan har sparats. Dela länken med kollegan, som loggar in med den inbjudna e-postadressen:</p><a href="https://app.trafexa.com/invitations">https://app.trafexa.com/invitations</a></div>}
    </div>
    <button type="button" className="button button-outline" aria-expanded={ownershipOpen} onClick={() => setOwnershipOpen(open => !open)}>{ownershipOpen ? 'Stäng ägarroll' : 'Hantera ägarroll'}</button>
    {ownershipOpen && <Suspense fallback={<p role="status">Läser in ägarrollen…</p>}><OwnershipTransfer companyId={companyId} userId={userId} companyRole={companyRole} onChanged={async () => { const token = ++generation.current; if (!await readCurrent(token)) { router.refresh(); throw Error('Team access could not be verified'); } }}/></Suspense>}
    {review && <section className="surface" style={{ marginTop: 24 }} aria-labelledby="team-review-title"><div className="panel-heading"><h2 id="team-review-title" tabIndex={-1} ref={heading}>{review.confirmed ? 'Bekräfta ändringen' : review.kind === 'member' ? 'Granska medlemsbehörighet' : review.kind === 'invite' ? 'Granska inbjudan' : 'Granska återkallande'}</h2></div><form className="workspace-form" style={{ padding: 20 }} onSubmit={event => { event.preventDefault(); if (review.confirmed) save(); else if (review.kind === 'invite' || validReason(review.reason)) setReview({ ...review, confirmed: true }); }}>
      {review.kind === 'member' ? <><p><strong>{review.member.email || 'Medlem'}</strong></p><p>{roleLabels[review.member.role as Role]} / {statusLabel(review.member.status)} → {roleLabels[review.role]} / {statusLabel(review.status)}</p>{review.confirmed ? <><p><strong>Motivering:</strong> {review.reason.trim()}</p><p>Den nya rollen och statusen påverkar kollegans åtkomst till företagets uppgifter.</p></> : <><label>Ny roll<select value={review.role} disabled={pending} onChange={event => setReview({ ...review, role: event.target.value as Role })}>{roles.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><label>Ny status<select value={review.status} disabled={pending} onChange={event => setReview({ ...review, status: event.target.value as MemberStatus })}><option value="active">Aktiv</option><option value="suspended">Avstängd</option></select></label><label>Motivering (obligatorisk)<input type="text" required maxLength={500} value={review.reason} disabled={pending} onChange={event => setReview({ ...review, reason: event.target.value })}/></label><p className="form-privacy">En rad, högst 500 tecken.</p></>}</>
        : review.kind === 'invite' ? <><p><strong>{review.email}</strong> · {roleLabels[review.role]}</p><p>Inbjudan gäller i sju dagar och ger denna roll först efter kollegans uttryckliga accept.</p></>
          : <><p><strong>{review.invitation.email}</strong> · {roleLabels[review.invitation.role as Role]}</p><p>En väntande inbjudan återkallas. Ett befintligt medlemskap ändras inte.</p>{review.confirmed ? <p><strong>Motivering:</strong> {review.reason.trim()}</p> : <label>Motivering (obligatorisk)<input type="text" required maxLength={500} value={review.reason} disabled={pending} onChange={event => setReview({ ...review, reason: event.target.value })}/></label>}</>}
      <div className="table-controls" style={{ flexWrap: 'wrap' }}><button type="submit" className="button button-green" disabled={pending || (review.kind !== 'invite' && !validReason(review.reason)) || (review.kind === 'member' && review.role === review.member.role && review.status === review.member.status)}>{review.confirmed ? review.kind === 'member' ? 'Bekräfta behörighetsändring' : review.kind === 'invite' ? 'Spara inbjudan' : 'Bekräfta återkallande' : 'Granska ändring'}</button>{review.confirmed && <button type="button" className="button button-outline" disabled={pending} onClick={() => setReview({ ...review, confirmed: false })}>Tillbaka</button>}<button type="button" className="text-link" disabled={pending} onClick={() => setReview(null)}>Avbryt</button></div>
    </form></section>}
  </section>;
}
