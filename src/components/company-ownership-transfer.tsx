'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCompanyOwnershipTransferAction, requestCompanyOwnershipTransferAction, acceptCompanyOwnershipTransferAction, cancelCompanyOwnershipTransferAction } from '@/lib/company-ownership/actions';
import { OWNERSHIP_ATTESTATION_VERSION, type OwnershipPage, type OwnershipMember } from '@/lib/company-ownership/types';

type Props = { companyId: string; userId: string; companyRole: string; onChanged?: () => void | Promise<void>; demo?: boolean };
type Review = { kind: 'request'; page: OwnershipPage; target: OwnershipMember; reason: string } | { kind: 'accept' | 'cancel'; page: OwnershipPage; reason: string };
const reasonValid = (s: string) => [...s.trim()].length >= 2 && [...s.trim()].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(s);
const labels = { pending: 'Väntar på accept', accepted: 'Accepterad', cancelled: 'Återkallad', expired: 'Utgången' };
const date = (s: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(s));

export function CompanyOwnershipTransfer(props: Props) {
  return <OwnershipPanel key={`${props.companyId}:${props.userId}:${props.companyRole}:${!!props.demo}`} {...props}/>;
}
function OwnershipPanel({ companyId, userId, companyRole, onChanged, demo = false }: Props) {
  const router = useRouter(), field = useId();
  const [page, setPage] = useState<OwnershipPage | null>(null), [review, setReview] = useState<Review | null>(null);
  const [target, setTarget] = useState(''), [reason, setReason] = useState(''), [ack, setAck] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  const live = useRef(true), generation = useRef(0), locked = useRef(false), nonces = useRef(new Map<string, string>()), heading = useRef<HTMLHeadingElement>(null);
  const allowed = !demo && ['owner', 'admin'].includes(companyRole) && !denied;
  function fail(result: { code: string; message: string }) {
    setError(result.message);
    if (['access_denied', 'unauthenticated'].includes(result.code)) { setPage(null); setReview(null); setTarget(''); setReason(''); setAck(false); nonces.current.clear(); setDenied(true); }
    else if (result.code === 'conflict') { setPage(null); setReview(null); setAck(false); setNotice('Läs in aktuellt underlag och granska på nytt.'); }
  }
  async function read(token: number, append = false, previous?: OwnershipPage | null) {
    const result = await getCompanyOwnershipTransferAction({ companyId, pageKey: append ? previous?.nextPageKey ?? null : null, limit: 50 });
    if (!live.current || generation.current !== token) return false;
    if (!result.ok) { setPage(null); fail(result); return false; }
    if (result.companyId !== companyId || result.actorUserId !== userId || !['owner', 'admin'].includes(result.actorRole)) { fail({ code: 'access_denied', message: 'Aktuell åtkomst kunde inte verifieras.' }); return false; }
    if (append && previous && (previous.teamVersion !== result.teamVersion || previous.owner?.membershipId !== result.owner?.membershipId)) { setPage(null); setReview(null); setError('Teamet har ändrats. Läs in och granska på nytt.'); return false; }
    setPage(append && previous ? { ...result, candidates: [...previous.candidates, ...result.candidates.filter(c => !previous.candidates.some(old => old.membershipId === c.membershipId))] } : result);
    return true;
  }
  async function load(append = false) {
    if (!allowed || locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice(''); setReview(null); setAck(false);
    const token = ++generation.current;
    try { await read(token, append, page); } catch { if (live.current && generation.current === token) { setPage(null); setError('Ägarrollen kunde inte verifieras. Läs in på nytt.'); } }
    finally { if (live.current && generation.current === token) { locked.current = false; setBusy(false); } }
  }
  useEffect(() => { live.current = true; locked.current = false; void load(); return () => { live.current = false; generation.current++; }; }, []); // Remounted whenever company, actor, role or demo scope changes.
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);
  function startReview(value: Review) { setReview(value); setAck(false); setError(''); setNotice(''); }
  async function save() {
    if (!allowed || locked.current || !review || !ack) return;
    const selected = review, p = selected.page;
    if (selected.kind === 'request' && (!p.canRequest || !p.owner || !reasonValid(selected.reason)) || selected.kind === 'accept' && !p.canAccept || selected.kind === 'cancel' && (!p.canCancel || !reasonValid(selected.reason))) return;
    const base = { companyId, expectedTeamVersion: p.teamVersion, acknowledged: true as const, attestationVersion: OWNERSHIP_ATTESTATION_VERSION };
    const payload = selected.kind === 'request' ? { ...base, targetMembershipId: selected.target.membershipId, expectedOwnerVersion: p.owner!.version, expectedTargetVersion: selected.target.version, reason: selected.reason.trim() } : { ...base, transferId: p.transfer!.id, expectedVersion: p.transfer!.version, ...(selected.kind === 'cancel' ? { reason: selected.reason.trim() } : {}) };
    const fingerprint = JSON.stringify({ kind: selected.kind, ...payload });
    if (!nonces.current.has(fingerprint)) nonces.current.set(fingerprint, crypto.randomUUID());
    const requestId = nonces.current.get(fingerprint)!, token = ++generation.current;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    let received = false;
    try {
      const result = selected.kind === 'request' ? await requestCompanyOwnershipTransferAction({ ...base, targetMembershipId: selected.target.membershipId, expectedOwnerVersion: p.owner!.version, expectedTargetVersion: selected.target.version, reason: selected.reason.trim(), requestId }) : selected.kind === 'accept' ? await acceptCompanyOwnershipTransferAction({ ...base, transferId: p.transfer!.id, expectedVersion: p.transfer!.version, requestId }) : await cancelCompanyOwnershipTransferAction({ ...base, transferId: p.transfer!.id, expectedVersion: p.transfer!.version, reason: selected.reason.trim(), requestId });
      if (!live.current || generation.current !== token) return;
      if (!result.ok) { fail(result); return; }
      if (result.receipt.companyId !== companyId || result.receipt.actorUserId !== userId || result.receipt.requestId !== requestId) { setPage(null); setReview(null); setError('Kvittot kunde inte verifieras. Läs in aktuellt underlag.'); return; }
      received = true; setPage(null); setReview(null); setAck(false); setTarget(''); setReason('');
      const fresh = await read(token);
      if (!live.current || generation.current !== token) return;
      if (fresh) { await onChanged?.(); if (!live.current || generation.current !== token) return; router.refresh(); setNotice('Åtgärden har registrerats och aktuellt underlag har lästs in.'); }
    } catch { if (live.current && generation.current === token) { if (received) { setPage(null); setError('Åtgärden är registrerad, men aktuell behörighet kunde inte verifieras. Uppdatera teamet.'); } else setError('Resultatet är okänt. Försök igen med samma granskning och begäran.'); } }
    finally { if (live.current && generation.current === token) { locked.current = false; setBusy(false); } }
  }
  if (!allowed) return <p role="alert">{demo ? 'Ägarrollen ändras inte i demo.' : error || 'Ägare eller administratör krävs.'}</p>;
  const t = page?.transfer;
  return <section className="surface" aria-label="Överlåtelse av ägarroll" style={{ marginTop: 20, padding: 20, overflowWrap: 'anywhere' }}>
    <div className="panel-heading"><h3>Överlåt ägarrollen</h3><button type="button" className="text-link" disabled={busy} onClick={() => void load()}>Uppdatera ägarrollen</button></div>
    <p>Ägarrollen styr behörigheter i Trafexa. Detta ändrar inte juridiskt ägande av företaget. Nuvarande ägare blir administratör först när den valda administratören accepterar. Förfrågan gäller i 24 timmar. Inga mejl skickas.</p>
    {busy && <p role="status">Verifierar ägarrollen…</p>}{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {page && <><p>Aktuell ägarroll: <strong>{page.owner?.email ?? 'Kan inte fastställas'}</strong></p>{['owner_missing', 'multiple_owners'].includes(page.blockReason ?? '') && <p role="alert">Ägarrollen saknas eller flera ägare finns. Separat återställning krävs.</p>}
      {t && <div><h4>{labels[t.status]}</h4><p>Från {t.from.email} till {t.to.email}</p><p>Motivering: {t.reason}</p><p>Giltig till: {date(t.expiresAt)}</p>{t.resolvedAt && <p>Avslutad: {date(t.resolvedAt)}</p>}{t.cancelReason && <p>Återkallande: {t.cancelReason}</p>}</div>}
      {page.canRequest && <form className="workspace-form" onSubmit={event => { event.preventDefault(); const candidate = page.candidates.find(c => c.membershipId === target); if (candidate && reasonValid(reason)) startReview({ kind: 'request', page, target: candidate, reason: reason.trim() }); }}><label htmlFor={`${field}-target`}>Ny innehavare av ägarrollen</label><select id={`${field}-target`} required disabled={busy} value={target} onChange={event => { setTarget(event.target.value); setAck(false); }}><option value="">Välj aktiv administratör</option>{page.candidates.map(c => <option key={c.membershipId} value={c.membershipId}>{c.email}</option>)}</select>{page.nextPageKey && <button type="button" className="text-link" disabled={busy} onClick={() => void load(true)}>Läs in fler administratörer</button>}<label htmlFor={`${field}-reason`}>Motivering för överlåtelse</label><input id={`${field}-reason`} required maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)}/><button className="button button-green" disabled={busy || !target || !reasonValid(reason)}>Granska överlåtelse</button></form>}
      {page.canAccept && <button type="button" className="button button-green" disabled={busy} onClick={() => startReview({ kind: 'accept', page, reason: '' })}>Granska accept av ägarroll</button>}
      {page.canCancel && <form className="workspace-form" onSubmit={event => { event.preventDefault(); if (reasonValid(reason)) startReview({ kind: 'cancel', page, reason: reason.trim() }); }}><label htmlFor={`${field}-cancel`}>Motivering för återkallande</label><input id={`${field}-cancel`} required maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)}/><button className="button button-outline" disabled={busy || !reasonValid(reason)}>Granska återkallande</button></form>}
    </>}
    {review && <section aria-labelledby={`${field}-review`}><h3 id={`${field}-review`} tabIndex={-1} ref={heading}>Bekräfta {review.kind === 'request' ? 'överlåtelse' : review.kind === 'accept' ? 'accept av ägarroll' : 'återkallande'}</h3><p>Från {review.page.transfer && review.kind !== 'request' ? review.page.transfer.from.email : review.page.owner?.email} till {review.kind === 'request' ? review.target.email : review.page.transfer?.to.email}</p>{review.reason && <p>Motivering: {review.reason}</p>}<p>{review.kind === 'cancel' ? 'Förfrågan återkallas. Nuvarande roller bevaras.' : 'Efter mottagarens accept blir nuvarande ägare administratör och mottagaren får ägarrollen i Trafexa.'}</p><label><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)}/>Jag har granskat personerna och bekräftar ändringen av appbehörighet. Detta överför inte juridiskt företagsägande.</label><div className="table-controls" style={{ flexWrap: 'wrap' }}><button type="button" className="button button-green" disabled={busy || !ack} onClick={() => void save()}>{review.kind === 'request' ? 'Skicka förfrågan om ägarroll' : review.kind === 'accept' ? 'Acceptera ägarrollen' : 'Återkalla förfrågan'}</button><button type="button" className="text-link" disabled={busy} onClick={() => { setReview(null); setAck(false); }}>Avbryt granskning</button></div></section>}
  </section>;
}
