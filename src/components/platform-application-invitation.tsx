'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { inviteApprovedApplicationAction } from '@/lib/platform-admin/application-invitation-send-actions';
import { renewPlatformApplicationInvitationAction } from '@/lib/platform-admin/application-invitation-renew-actions';
import { getPlatformApplicationInvitationAction } from '@/lib/platform-admin/application-invitation-actions';
import type { PlatformContact } from '@/lib/platform-admin/database.types';

const failureMessages: Record<string, string> = {
  forbidden: 'Din administratörsåtkomst kunde inte verifieras. Läs in sidan igen.',
  conflict: 'Ansökan har ändrats. Läs in ansökan igen och granska de aktuella uppgifterna.',
  invalid_input: 'Kontrollera motiveringen och bekräfta godkännandet.',
  existing_account: 'E-postadressen har redan ett konto. Granska kontot under Konton innan du går vidare.',
  unavailable: 'Godkännandet kunde inte slutföras. Försök igen med samma granskning.',
};

export function PlatformApplicationInvitation({ application, actorUserId, disabled = false, onAccessDenied, onComplete, onBusyChange }: {
  application: PlatformContact;
  actorUserId: string;
  disabled?: boolean;
  onAccessDenied: () => void;
  onComplete: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [ready, setReady] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [existing, setExisting] = useState(false);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof getPlatformApplicationInvitationAction>> | null>(null);
  const [renewReason, setRenewReason] = useState('');
  const [renewReview, setRenewReview] = useState(false);
  const [renewAcknowledged, setRenewAcknowledged] = useState(false);
  const renewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (renewReview) renewHeading.current?.focus(); }, [renewReview]);
  const loadedDeliveryId = useRef<string | null>(null);
  const renewIntent = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const busy = useRef(false);
  const callbacks = useRef({ onAccessDenied, onBusyChange });
  callbacks.current = { onAccessDenied, onBusyChange };
  const [pending, startTransition] = useTransition();
  const intent = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; if (busy.current) callbacks.current.onBusyChange?.(false); }; }, []);
  const invitation = snapshot?.ok ? snapshot.invitation : null;
  const lifecycle = snapshot?.ok ? snapshot.lifecycle : null;
  const requiresNewApprovalReview = !!invitation && !invitation.userId && invitation.applicationVersion !== application.version;
  const applicationEligible = !application.legacy && application.status !== 'closed';
  const applicationCurrent = lifecycle?.applicationVersion === application.version;
  const correctReview = applicationEligible && applicationCurrent && (!invitation || invitation.actorUserId === actorUserId && (invitation.applicationVersion === application.version || !!invitation.userId || lifecycle.delivery.canRetry));
  const canRenew = correctReview && lifecycle?.applicationVersion === application.version && lifecycle.canRenew;
  const deliveryBlocksSend = !correctReview || !!invitation && !lifecycle?.delivery.canRetry;
  function applySnapshot(result: Awaited<ReturnType<typeof getPlatformApplicationInvitationAction>>) {
    setSnapshot(result);
    if (!result.ok) {
      setReady(false); setFinished(true);
      setError(result.code === 'access_denied' ? failureMessages.forbidden : 'Kontoinbjudans status kunde inte läsas in. Kontrollera status innan du går vidare.');
      if (result.code === 'access_denied') callbacks.current.onAccessDenied();
      return;
    }
    setReady(true);
    if (!applicationEligible || result.lifecycle.applicationVersion !== application.version) {
      setFinished(true); setReviewing(false); setAcknowledged(false); setRenewReview(false); setRenewAcknowledged(false);
      return;
    }
    if (loadedDeliveryId.current !== null && loadedDeliveryId.current !== result.lifecycle.delivery.id) { setRenewReview(false); setRenewAcknowledged(false); renewIntent.current = null; }
    loadedDeliveryId.current = result.lifecycle.delivery.id;
    if (result.invitation) {
      const previous = result.invitation;
      const replacePreparation = !previous.userId && previous.applicationVersion !== application.version;
      if (replacePreparation) {
        setExisting(false);
        setFinished(!result.lifecycle.delivery.canRetry || previous.actorUserId !== actorUserId || result.lifecycle.applicationVersion !== application.version);
        // Keep a newly reviewed request stable after a lost response. An old approval
        // nonce must never authorize a replacement review for the current case.
        if (intent.current?.requestId === previous.requestId) intent.current = null;
        return;
      }
      setExisting(true); setReason(previous.reason);
      const payload = { applicationId: application.id, expectedVersion: application.version, reason: previous.reason, acknowledged: true as const };
      intent.current = { fingerprint: JSON.stringify(payload), requestId: previous.requestId };
      setFinished(!result.lifecycle.delivery.canRetry || previous.actorUserId !== actorUserId || previous.applicationVersion !== application.version && (!previous.userId || result.lifecycle.applicationVersion !== application.version));
    }
  }
  useEffect(() => {
    let current = true;
    setReady(false); setError(null); setMessage(null); setFinished(false); setExisting(false); setReason(''); setReviewing(false); setAcknowledged(false); setSnapshot(null);
    loadedDeliveryId.current = null; setRenewReason(''); setRenewReview(false); setRenewAcknowledged(false); intent.current = null; renewIntent.current = null;
    void getPlatformApplicationInvitationAction({ applicationId: application.id }).then(result => {
      if (current) applySnapshot(result);
    }).catch(() => {
      if (current) setError('Kontoinbjudans status kunde inte läsas in. Kontrollera status innan du går vidare.');
    });
    return () => { current = false; };
  }, [application.id, application.version, actorUserId, readAttempt]);

  async function refreshAfterMutation() {
    try {
      const result = await getPlatformApplicationInvitationAction({ applicationId: application.id });
      if (active.current) applySnapshot(result);
    } catch {
      if (active.current) { setReady(false); setFinished(true); setError('Resultatet behöver kontrolleras. Uppdatera kontoinbjudans status innan du går vidare.'); }
    }
  }
  function setBusy(value: boolean) { busy.current = value; callbacks.current.onBusyChange?.(value); }
  function renewInvitation() {
    if (!ready || disabled || busy.current || !invitation || !canRenew || !lifecycle?.delivery.id || !renewReview || !renewAcknowledged || renewReason.trim().length < 2) return;
    const payload = { applicationId: application.id, invitationId: invitation.id, expectedDeliveryId: lifecycle.delivery.id, expectedVersion: application.version, reason: renewReason.trim(), acknowledged: true as const, invalidatesPreviousLink: true as const };
    const fingerprint = JSON.stringify(payload);
    if (renewIntent.current?.fingerprint !== fingerprint) renewIntent.current = { fingerprint, requestId: crypto.randomUUID() };
    const requestId = renewIntent.current.requestId;
    setBusy(true); setError(null); setMessage(null);
    startTransition(async () => {
      try {
        const result = await renewPlatformApplicationInvitationAction({ ...payload, requestId });
        if (!active.current) return;
        if (!result.ok) { setError(failureMessages[result.code] || failureMessages.unavailable); if (result.code === 'forbidden') callbacks.current.onAccessDenied(); }
        else { setRenewReview(false); setRenewAcknowledged(false); setMessage(result.status === 'unknown' ? 'Förnyelsens utskicksresultat är okänt. Kontrollera status innan någon ytterligare åtgärd.' : result.status === 'not_configured' ? 'Utskicket är inte konfigurerat. Ingen ny inbjudan har skickats.' : 'Den förnyade kontoinbjudan har lämnats till mejltjänsten. Leverans till inkorgen är ännu inte bekräftad.'); }
      } catch { if (active.current) setError('Förnyelsens resultat kunde inte verifieras. Kontrollera aktuell status innan du fortsätter.'); }
      finally { if (active.current) await refreshAfterMutation(); setBusy(false); }
    });
  }

  function sendInvitation() {
    if (!ready || busy.current || pending || disabled || finished || deliveryBlocksSend || !reviewing || !acknowledged || !reason.trim()) return;
    const payload = { applicationId: application.id, expectedVersion: application.version, reason: reason.trim(), acknowledged: true as const };
    const fingerprint = JSON.stringify(payload);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, requestId: crypto.randomUUID() };
    const requestId = intent.current.requestId;
    setBusy(true); setError(null); setMessage(null);
    startTransition(async () => {
      try {
        const result = await inviteApprovedApplicationAction({ ...payload, requestId });
        if (!active.current) return;
        if (!result.ok) {
          setError(failureMessages[result.code] || failureMessages.unavailable);
          if (result.code === 'forbidden') onAccessDenied();
          return;
        }
        if (result.status === 'not_configured') {
          setMessage('Utskicket är inte konfigurerat. Ingen kontoinbjudan har skickats från denna åtgärd. Kontrollera aktuell kontostatus och mejlinställningarna innan du försöker igen.');
        } else if (result.status === 'unknown') {
          setFinished(true);
          setMessage('Det gick inte att bekräfta om mejlet skickades. Skicka inte en ny inbjudan innan utskicksstatus har kontrollerats.');
        } else {
          setFinished(true);
          setMessage(result.status === 'already_sent' ? `Mejltjänsten har redan tagit emot välkomstmejlet till ${result.email}. Ingen ny inbjudan har skickats.` : `Välkomstmejlet med godkännandebekräftelse och kontoinbjudan har lämnats till mejltjänsten för ${result.email}. Leverans till inkorgen är ännu inte bekräftad.`);
        }
      } catch {
        if (active.current) setError('Resultatet kunde inte läsas in. Försök igen med samma granskning för att kontrollera utskicket.');
      } finally { if (active.current) await refreshAfterMutation(); setBusy(false); }
    });
  }

  return <section className="admin-application-approval-content" aria-labelledby="application-invitation-heading">
    <h3 id="application-invitation-heading">Godkänn ansökan och bjud in</h3>
    <p>Godkänn kontot och skicka ett välkomstmejl till ansökans e-postadress. Mejlet bekräftar godkännandet och innehåller en personlig länk för att aktivera kontot och välja lösenord. Företags- och produktbehörigheter samt finansiering hanteras separat.</p>
    {ready && !applicationCurrent && <p role="status">Ansökan har ändrats sedan den öppnades. Läs in aktuell ansökan och granska uppgifterna på nytt innan du godkänner eller förnyar en kontoinbjudan.</p>}
    {application.legacy && <p>Den här äldre förfrågan kan inte användas för en kontoinbjudan. Be kunden lämna en ny, fullständig ansökan via Trafexas webbplats.</p>}
    {!application.legacy && application.status === 'closed' && <p>Ansökan är avslutad. Ändra handläggningsstatus och granska det aktuella underlaget innan en kontoinbjudan kan skickas.</p>}
    {lifecycle && invitation && <div className="admin-application-approval-review" aria-label="Kontoinbjudans aktuella status">
      <dl className="admin-application-fields"><div><dt>Utskick</dt><dd>{({ not_started: 'Inte påbörjat', generating: 'Förbereder inbjudan', sending: 'Utskick pågår', sent: 'Mottaget av mejltjänsten', retryable: 'Kan försöka igen med samma utskick', rejected: 'Utskicket avvisades', unknown: 'Okänt utskicksresultat' } as const)[lifecycle.delivery.state]}</dd></div>
      <div><dt>Sändningsförsök</dt><dd>{lifecycle.delivery.attemptCount}</dd></div>{lifecycle.delivery.updatedAt && <div><dt>Senast registrerat</dt><dd><time dateTime={lifecycle.delivery.updatedAt}>{new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(lifecycle.delivery.updatedAt))}</time></dd></div>}<div><dt>E-postaktivering</dt><dd>{lifecycle.account.emailVerified === true ? 'E-post bekräftad' : lifecycle.account.emailVerified === false ? 'E-post ej bekräftad' : 'Kontot har inte skapats ännu'}</dd></div>
      <div><dt>Kontoåtkomst</dt><dd>{lifecycle.account.approvalStatus ? ({ pending: 'Inväntar godkännande', approved: 'Godkänt', rejected: 'Avslaget', suspended: 'Avstängt' } as const)[lifecycle.account.approvalStatus] : 'Inget kontobeslut ännu'}</dd></div></dl>
      {lifecycle.delivery.state === 'sent' && <p>Mejltjänstens mottagande bekräftar inte leverans till inkorgen.</p>}
      {lifecycle.delivery.state === 'unknown' && <p>Skicka inte en ny inbjudan innan utskicksstatus har kontrollerats. Okända utskick försöks inte automatiskt igen.</p>}
      {requiresNewApprovalReview && correctReview && <p>Handläggningen har ändrats sedan det tidigare godkännandet. Ange en ny motivering och granska den aktuella ansökan innan kontoinbjudan förbereds.</p>}
      {!correctReview && <p>Den tidigare granskningen kan inte användas för ett nytt utskick här. Läs in aktuell ansökan eller låt ansvarig administratör granska ärendet.</p>}
    </div>}
    <form className="workspace-form" onSubmit={event => {
      event.preventDefault();
      if (reviewing) sendInvitation();
      else if (ready && !disabled && !pending && !finished && !deliveryBlocksSend && reason.trim()) { setReason(reason.trim()); setReviewing(true); setAcknowledged(false); setError(null); setMessage(null); }
    }}>
      {reviewing && <div className="admin-application-approval-review"><h4>Kontrollera före godkännande</h4><dl className="admin-application-fields"><div><dt>Sökande</dt><dd>{application.name}</dd></div><div><dt>Företag</dt><dd>{application.company} · {application.organisationNumber || 'Organisationsnummer saknas'}</dd></div><div><dt>Välkomstmejl skickas till</dt><dd style={{ overflowWrap: 'anywhere' }}>{application.email}</dd></div><div><dt>Mejlets ämne</dt><dd>Välkommen till Trafexa – din ansökan är godkänd</dd></div></dl><p>Godkännandet och välkomsthälsningen skickas tillsammans med aktiveringslänken i ett mejl.</p></div>}
      <label>Motivering för kontogodkännande<input required minLength={2} maxLength={500} value={reason} disabled={!ready || disabled || pending || reviewing || finished || existing} onChange={event => setReason(event.target.value)}/></label>
      {reviewing && <label className="auth-checkbox"><input type="checkbox" required checked={acknowledged} disabled={disabled || pending || finished} onChange={event => setAcknowledged(event.target.checked)}/><span>Jag har granskat ansökan och godkänner kontot för {application.email}.</span></label>}
      {error && <p role="alert" className="notice error">{error}</p>}
      {message && <p role="status" className="notice">{message}</p>}
      {!ready && !error && <p role="status">Kontrollerar tidigare kontoinbjudan…</p>}
      <div className="table-controls">
        <button type="submit" className="button button-green" disabled={!ready || disabled || pending || finished || deliveryBlocksSend || reason.trim().length < 2 || reviewing && !acknowledged}>{pending ? 'Behandlar kontoinbjudan…' : reviewing ? 'Godkänn och skicka kontoinbjudan' : 'Granska godkännande'}</button>
        {!ready && error && <button type="button" className="button button-outline" disabled={disabled || pending} onClick={() => setReadAttempt(attempt => attempt + 1)}>Kontrollera kontoinbjudan igen</button>}
        {reviewing && !finished && <button type="button" className="button button-outline" disabled={disabled || pending} onClick={() => { setReviewing(false); setAcknowledged(false); }}>Ändra granskning</button>}
        {finished && <button type="button" className="button button-outline" disabled={disabled || pending} onClick={onComplete}>Läs in aktuell ansökan</button>}
      </div>
    </form>
    {ready && <button type="button" className="text-link" disabled={disabled || pending} onClick={() => setReadAttempt(attempt => attempt + 1)}>Uppdatera kontoinbjudans status</button>}
    {ready && canRenew && <form className="workspace-form" aria-label="Förnya kontoinbjudan" onSubmit={event => { event.preventDefault(); if (renewReview) renewInvitation(); else if (!disabled && !pending && renewReason.trim().length >= 2) { setRenewReview(true); setRenewAcknowledged(false); } }}>
      <h4 ref={renewHeading} tabIndex={-1}>Förnya kontoinbjudan</h4><p>En ny personlig aktiveringslänk ersätter den tidigare länken. Den tidigare länken blir ogiltig. Detta ändrar inte kontots behörigheter.</p>
      <label>Motivering för förnyelse<input required minLength={2} maxLength={500} disabled={disabled || pending || renewReview} value={renewReason} onChange={event => setRenewReason(event.target.value)}/></label>
      {renewReview && <><p>Kontrollera mottagaren: <strong style={{ overflowWrap: 'anywhere' }}>{application.email}</strong></p><label className="auth-checkbox"><input type="checkbox" required checked={renewAcknowledged} disabled={disabled || pending} onChange={event => setRenewAcknowledged(event.target.checked)}/><span>Jag bekräftar att den tidigare aktiveringslänken blir ogiltig och att en ny kontoinbjudan skickas till {application.email}.</span></label></>}
      <button type="submit" className="button button-green" disabled={disabled || pending || renewReason.trim().length < 2 || renewReview && !renewAcknowledged}>{renewReview ? 'Bekräfta och skicka ny kontoinbjudan' : 'Granska förnyelse'}</button>
      {renewReview && <button type="button" className="text-link" disabled={disabled || pending} onClick={() => { setRenewReview(false); setRenewAcknowledged(false); }}>Ändra förnyelse</button>}
    </form>}
  </section>;
}
