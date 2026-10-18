'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import { getGuestInvitationRenewalReviewAction, renewGuestDocumentInvitationAction } from '@/lib/data/guest-invitation-renewal-actions';
import type { CustomerEmailDeliveryProps } from './customer-email-delivery';

type Review = Extract<Awaited<ReturnType<typeof getGuestInvitationRenewalReviewAction>>, { ok: true }>['review'];
type Request = Parameters<typeof renewGuestDocumentInvitationAction>[0];
type Saved = { version: 1; request: Request; conflict: boolean };
type Props = Omit<CustomerEmailDeliveryProps, 'kind'> & { kind: 'offer_invitation' | 'contract_invitation'; refreshVersion: number; parentBusy: boolean; onBusyChange: (busy: boolean) => void; onRenewed: () => void; onExpiredChange: (expired: boolean) => void };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function GuestInvitationRenewal(props: Props) {
  return <RenewalPanel key={[props.companyId, props.dealId, props.kind, props.referenceId, props.userId, props.role].join(':')} {...props}/>;
}
function RenewalPanel({companyId, dealId, referenceId, kind, userId, role, refreshVersion, parentBusy, onBusyChange, onRenewed, onExpiredChange}: Props) {
  const input = {companyId, dealId, referenceId, kind};
  const writable = (kind === 'offer_invitation' ? ['owner', 'admin', 'sales'] : ['owner', 'admin']).includes(role);
  const allowed = (kind === 'offer_invitation' ? ['owner', 'admin', 'sales', 'finance', 'viewer'] : ['owner', 'admin', 'finance']).includes(role);
  const storageKey = `trafexa:guest-invitation-renewal:v1:${JSON.stringify([userId, companyId, dealId, kind, referenceId, role])}`;
  const [review, setReview] = useState<Review | null>(null), [saved, setSaved] = useState<Saved | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [open, setOpen] = useState(false), [ack, setAck] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const alive = useRef(false), sequence = useRef(0), lock = useRef(false), heading = useRef<HTMLHeadingElement>(null), opener = useRef<HTMLButtonElement>(null);
  const currentSaved = useRef<Saved | null>(null);
  function scoped(value: {companyId: string; dealId: string; referenceId: string; kind: string; actorUserId: string; actorRole: string}) {
    return value.companyId === companyId && value.dealId === dealId && value.referenceId === referenceId && value.kind === kind && value.actorUserId === userId && value.actorRole === role;
  }
  function writeSaved(value: Saved | null) {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey);
    currentSaved.current = value; setSaved(value);
  }
  async function refresh() {
    const request = ++sequence.current; setLoading(true); setError(''); setReview(null); setOpen(false); setAck(false);
    try {
      const result = await getGuestInvitationRenewalReviewAction(input);
      if (!alive.current || request !== sequence.current) return;
      if (!result.ok) { setError(result.message); return; }
      if (!scoped(result.review)) { setError('Kundlänken kunde inte verifieras för aktuellt företag, konto och underlag.'); return; }
      setReview(result.review);
      onExpiredChange(result.review.expiresAt !== null && Date.parse(result.review.expiresAt) <= Date.now());
    } catch { if (alive.current && request === sequence.current) setError('Kundlänkens giltighet kunde inte kontrolleras. Uppdatera status för att försöka igen.'); }
    finally { if (alive.current && request === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    if (writable) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Saved, r = parsed?.request;
          if (parsed.version !== 1 || typeof parsed.conflict !== 'boolean' || !r || r.companyId !== companyId || r.dealId !== dealId || r.referenceId !== referenceId || r.kind !== kind || !uuid.test(r.requestId) || !r.expectedEmailId || !Number.isSafeInteger(r.expectedGeneration) || r.expectedGeneration < 0 || !/^[a-f0-9]{64}$/i.test(r.expectedDocumentHash) || r.reviewAcknowledged !== true) throw Error('Invalid saved request');
          currentSaved.current = parsed; setSaved(parsed);
        }
        setStorageReady(true);
      } catch { setStorageReady(false); setStorageError('Ett tidigare förnyelseförsök kunde inte läsas säkert. Kontakta Trafexa innan ett nytt försök görs.'); }
    } else if (allowed) setStorageReady(true);
    return () => { alive.current = false; ++sequence.current; onBusyChange(false); };
  }, []);
  useEffect(() => { if (allowed) void refresh(); else setLoading(false); }, [refreshVersion]);
  const returnFocus = useRef(false);
  useEffect(() => { if (open) heading.current?.focus(); else if (returnFocus.current) {returnFocus.current = false; opener.current?.focus();} }, [open]);
  const expired = review?.expiresAt != null && Date.parse(review.expiresAt) <= Date.now();
  const eligible = writable && review?.canWrite === true && review.canRenew === true && review.transport === 'configured';
  function closeReview() { returnFocus.current = true; setOpen(false); setAck(false); }
  async function submit() {
    if (lock.current || loading || busy || parentBusy || !writable || !storageReady || !review || !scoped(review)) return;
    let attempt = currentSaved.current;
    if (attempt?.conflict || (!attempt && (!eligible || !open || !ack))) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(''); setNotice(''); const requestSequence = sequence.current;
    try {
      if (!attempt) {
        if (!review.emailId) return;
        attempt = {version: 1, conflict: false, request: {...input, expectedEmailId: review.emailId, expectedGeneration: review.generation, expectedDocumentHash: review.documentHash, requestId: crypto.randomUUID(), reviewAcknowledged: true}};
        writeSaved(attempt);
      }
      const result = await renewGuestDocumentInvitationAction(attempt.request);
      if (!alive.current || requestSequence !== sequence.current) return;
      setOpen(false); setAck(false);
      if (!result.ok) {
        if (result.code === 'conflict') writeSaved({...attempt, conflict: true});
        setError(result.message); return;
      }
      const receipt = result.renewal;
      if (!scoped(receipt) || receipt.requestId !== attempt.request.requestId || receipt.expectedEmailId !== attempt.request.expectedEmailId || receipt.expectedGeneration !== attempt.request.expectedGeneration || receipt.documentHash !== attempt.request.expectedDocumentHash) {
        setError('Förnyelsens utfall kunde inte verifieras. Kontrollera samma förnyelseförsök innan ett nytt övervägs.'); return;
      }
      writeSaved(null); setReview(null); setBusy(false); setNotice('Förnyelsen har registrerats. Kontrollera aktuell mejlstatus; detta bekräftar inte leverans till kundens inkorg.'); onRenewed();
    } catch {
      if (alive.current && requestSequence === sequence.current) setError(currentSaved.current ? 'Förnyelsens utfall är oklart. Kontrollera samma förnyelseförsök; ett nytt ärende skapas inte.' : 'Förnyelsen kunde inte sparas säkert i webbläsaren. Inget nytt försök skickades.');
    } finally { lock.current = false; if (alive.current) {setBusy(false); onBusyChange(false);} }
  }
  function restart() {
    if (!saved?.conflict || busy || loading) return;
    try { writeSaved(null); setNotice('Läs in och granska det aktuella underlaget före en ny förnyelse.'); void refresh(); }
    catch { setError('Det tidigare försöket kunde inte avslutas säkert. Kontakta Trafexa.'); }
  }
  if (!allowed) return null;
  return <section className="guest-invitation-renewal" aria-label="Kundlänkens giltighet">
    {loading && <p role="status">Kontrollerar kundlänkens giltighet…</p>}
    {error && <p role="alert">{error}</p>}
    {storageError && <p role="alert">{storageError}</p>}
    {!storageReady && !loading && <p>Förnyelse är spärrad tills tidigare försök kan kontrolleras säkert.</p>}
    {review && expired && <><p>Kundens länk har gått ut.</p><p>Giltig till: {new Date(review.expiresAt!).toLocaleString('sv-SE', {timeZone: 'Europe/Stockholm'})}</p>
      {!review.canRenew && <p>{review.status === 'pending' ? 'Det tidigare mejlet väntar fortfarande. Kontakta Trafexa för kontroll av den utgångna länken.' : review.status === 'unknown' ? 'Utskickets utfall behöver kontrolleras av Trafexa innan länken kan förnyas.' : 'Länken kan inte förnyas i det aktuella läget. Kontrollera underlaget och kontakta Trafexa vid behov.'}</p>}
      {review.canRenew && review.transport !== 'configured' && <p>Mejlutskick behöver vara aktiverade och konfigurerade innan länken kan förnyas.</p>}
    </>}
    {saved && writable && <><p>{saved.conflict ? 'Underlaget har ändrats. Det tidigare försöket kan avslutas inför en ny granskning.' : 'Ett tidigare förnyelseförsök måste kontrolleras med samma ärendenummer.'}</p>
      <button type="button" className="button button-outline" disabled={busy || parentBusy || loading || !storageReady || !review} onClick={() => saved.conflict ? restart() : startTransition(() => void submit())}>{busy ? 'Kontrollerar förnyelsen…' : saved.conflict ? 'Läs in underlag för ny granskning' : 'Kontrollera samma förnyelseförsök'}</button></>}
    {!saved && eligible && storageReady && !open && <button ref={opener} type="button" className="button button-outline" disabled={loading || busy || parentBusy} onClick={() => {setOpen(true); setAck(false); setError('');}}>Granska förnyelse av kundlänk</button>}
    {!saved && eligible && open && review && <section className="customer-email-retry-review" aria-label="Granska ny kundlänk"><h5 ref={heading} tabIndex={-1}>Kontrollera underlaget för ny kundlänk</h5>
      <p>Mottagare: {review.recipientEmail}</p><p>Dokumentversion: {review.documentVersion}</p><details><summary>Dokumentreferens</summary><p style={{overflowWrap: 'anywhere'}}>Dokumentets kontrollsumma: {review.documentHash}</p></details><p>Giltig till: {review.expiresAt ? new Date(review.expiresAt).toLocaleString('sv-SE', {timeZone: 'Europe/Stockholm'}) : 'Saknas'}</p>
      <p>En ny länk gäller samma sparade dokument och mottagare. Kunden behöver inget Trafexakonto. Tidigare godkännanden ändras inte.</p>
      <label><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)}/><span>Jag har granskat mottagaren och dokumentet och vill förnya kundens utgångna länk.</span></label>
      <div><button type="button" className="button button-green" disabled={!ack || loading || busy || parentBusy} onClick={() => startTransition(() => void submit())}>{busy ? 'Registrerar förnyelsen…' : 'Förnya och skicka länk'}</button><button type="button" className="button button-outline" disabled={busy} onClick={closeReview}>Tillbaka</button></div>
    </section>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
