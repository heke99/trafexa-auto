'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { acceptCompanyInvitationAction, getMyInvitationsAction } from '@/lib/company-team/actions';

import type { MyInvitationsPage } from '@/lib/company-team/database.types';

type InvitationPage = MyInvitationsPage & { ok: true };
type Invitation = InvitationPage['invitations'][number];
const roles: Record<string, string> = { owner: 'Ägare', admin: 'Administratör', sales: 'Säljare', finance: 'Finansansvarig', viewer: 'Läsbehörighet' };
const dateLabel = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeZone: 'Europe/Stockholm' }).format(new Date(value));

export function CompanyInvitations() {
  const [page, setPage] = useState<InvitationPage | null>(null);
  const [review, setReview] = useState<{ invitation: Invitation; confirmed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [denied, setDenied] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const requests = useRef(new Map<string, string>());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [review?.invitation.id, review?.confirmed]);
  function failure(result: { code: string; message: string }) {
    setError(result.message);
    if (['access_denied', 'unauthenticated'].includes(result.code)) { ++generation.current; setDenied(true); setPage(null); setReview(null); setAccepted(false); }
  }
  async function readCurrent(requestGeneration: number, append = false, pageKey?: string | null) {
    const result = await getMyInvitationsAction({ pageKey: append ? pageKey : null, limit: 50 });
    if (generation.current !== requestGeneration) return;
    if (!result.ok) { setPage(null); failure(result); return; }
    setPage(previous => append && previous ? { ...result, invitations: [...previous.invitations, ...result.invitations.filter(item => !previous.invitations.some(known => known.id === item.id))] } : result);
  }
  function load(append = false) {
    if (denied || inFlight.current) return;
    const requestGeneration = ++generation.current;
    inFlight.current = true; setError(null); setReview(null);
    startTransition(async () => {
      try { await readCurrent(requestGeneration, append, page?.nextPageKey); }
      catch { if (generation.current === requestGeneration) { setPage(null); setError('Inbjudningarna kunde inte verifieras. Läs in listan igen.'); } }
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
  }, []);
  function accept() {
    if (!review?.confirmed || denied || inFlight.current) return;
    const invitationId = review.invitation.id;
    const expectedVersion = review.invitation.version;
    if (!requests.current.has(`${invitationId}:${expectedVersion}`)) requests.current.set(`${invitationId}:${expectedVersion}`, crypto.randomUUID());
    const requestId = requests.current.get(`${invitationId}:${expectedVersion}`)!;
    const requestGeneration = ++generation.current;
    inFlight.current = true; setError(null); setNotice(null);
    startTransition(async () => {
      let received = false;
      try {
        const result = await acceptCompanyInvitationAction({ invitationId, expectedVersion, requestId });
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { failure(result); return; }
        received = true; setReview(null); setPage(null);
        // The action verifies current membership/company before choosing the workspace cookie.
        setAccepted(true); setNotice('Inbjudan har accepterats. Öppna företaget för att läsa in din aktuella arbetsyta.');
        await readCurrent(requestGeneration);
      } catch {
        if (generation.current !== requestGeneration) return;
        if (received) { setPage(null); setError('Inbjudan har accepterats, men listan kunde inte läsas in på nytt. Öppna företaget för en färsk åtkomstkontroll.'); }
        else setError('Svaret kunde inte verifieras. Försök acceptera igen med samma begäran.');
      } finally { inFlight.current = false; }
    });
  }
  return <section className="surface" aria-label="Dina företagsinbjudningar"><div className="panel-heading"><h2>Dina inbjudningar</h2><button type="button" className="text-link" disabled={pending || denied} onClick={() => load()}>Uppdatera inbjudningar</button></div>
    <p className="settings-note">Här visas inbjudningar till din verifierade e-postadress. Du väljer själv om du vill ansluta dig till ett företag.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}{pending && <p role="status">Verifierar inbjudningar…</p>}
    {accepted && !denied && <a className="button button-green" href="/dashboard" style={{ margin: 20 }}>Öppna företaget</a>}
    {!denied && page && <><div className="table-scroll"><table className="data-table"><caption className="sr-only">Inbjudningar till din e-postadress</caption><thead><tr><th scope="col">Företag</th><th scope="col">Roll</th><th scope="col">Giltig till</th><th scope="col">Åtgärd</th></tr></thead><tbody>{page.invitations.map(invitation => <tr key={invitation.id}><td><strong>{invitation.companyName}</strong></td><td>{roles[invitation.role]}</td><td>{dateLabel(invitation.expiresAt)}</td><td><button type="button" className="text-link" disabled={pending || invitation.status !== 'pending' || new Date(invitation.expiresAt).getTime() <= Date.now()} onClick={() => { setReview({ invitation, confirmed: false }); setError(null); }}>Granska inbjudan<span className="sr-only"> från {invitation.companyName}</span></button></td></tr>)}</tbody></table></div>{!page.invitations.length && <div className="empty-state"><h3>Inga väntande inbjudningar</h3><p>En kollega kan bjuda in din e-postadress från företagets inställningar.</p></div>}<div className="table-footer"><span>{page.invitations.length} inbjudningar inlästa</span>{page.nextPageKey && <button type="button" className="text-link" disabled={pending} onClick={() => load(true)}>Läs in fler inbjudningar</button>}</div></>}
    {!denied && review && <div className="dialog-content"><h3 id="invitation-review-title" ref={heading} tabIndex={-1}>{review.confirmed ? 'Bekräfta anslutning' : 'Granska företagsinbjudan'}</h3><p><strong>{review.invitation.companyName}</strong> bjuder in dig som {roles[review.invitation.role]}.</p><p>Inbjudan gäller till {dateLabel(review.invitation.expiresAt)}. Medlemskapet gäller bara detta företag.</p><div className="table-controls" style={{ flexWrap: 'wrap' }}><button type="button" className="button button-green" disabled={pending} onClick={() => review.confirmed ? accept() : setReview({ ...review, confirmed: true })}>{review.confirmed ? 'Acceptera inbjudan' : 'Fortsätt till bekräftelse'}</button><button type="button" className="text-link" disabled={pending} onClick={() => setReview(null)}>Avbryt</button></div></div>}
  </section>;
}
