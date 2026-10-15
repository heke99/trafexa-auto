'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { inviteApprovedApplicationAction } from '@/lib/platform-admin/application-invitation-send-actions';
import { getPlatformApplicationInvitationAction } from '@/lib/platform-admin/application-invitation-actions';
import type { PlatformContact } from '@/lib/platform-admin/database.types';

const failureMessages: Record<string, string> = {
  forbidden: 'Din administratörsåtkomst kunde inte verifieras. Läs in sidan igen.',
  conflict: 'Ansökan har ändrats. Läs in ansökan igen och granska de aktuella uppgifterna.',
  invalid_input: 'Kontrollera motiveringen och bekräfta godkännandet.',
  existing_account: 'E-postadressen har redan ett konto. Granska kontot under Konton innan du går vidare.',
  unavailable: 'Godkännandet kunde inte slutföras. Försök igen med samma granskning.',
};

export function PlatformApplicationInvitation({ application, actorUserId, disabled = false, onAccessDenied, onComplete }: {
  application: PlatformContact;
  actorUserId: string;
  disabled?: boolean;
  onAccessDenied: () => void;
  onComplete: () => void;
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
  const [pending, startTransition] = useTransition();
  const intent = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setReady(false); setError(null);
    void (async () => {
      try {
        const result = await getPlatformApplicationInvitationAction({ applicationId: application.id });
        if (!current) return;
        if (!result.ok) {
          setError(result.code === 'access_denied' ? failureMessages.forbidden : 'Kontoinbjudans status kunde inte läsas in. Kontrollera status innan du går vidare.');
          if (result.code === 'access_denied') onAccessDenied();
          return;
        }
        if (result.invitation) {
          const previous = result.invitation;
          setExisting(true);
          if (previous.applicationVersion !== application.version || previous.actorUserId !== actorUserId) {
            setFinished(true);
            setMessage('Ansökan har en tidigare kontoinbjudan som behöver granskas av ansvarig administratör. En ny inbjudan kan inte skickas från denna granskning.');
          } else {
            setReason(previous.reason);
            const payload = { applicationId: application.id, expectedVersion: application.version, reason: previous.reason, acknowledged: true as const };
            intent.current = { fingerprint: JSON.stringify(payload), requestId: previous.requestId };
            setMessage('En kontoinbjudan har tidigare förberetts. Granska uppgifterna och bekräfta för att kontrollera utskicket. Tidigare förberedelse betyder inte att mejlet har levererats.');
          }
        }
        setReady(true);
      } catch {
        if (current) setError('Kontoinbjudans status kunde inte läsas in. Kontrollera status innan du går vidare.');
      }
    })();
    return () => { current = false; };
  }, [application.id, application.version, actorUserId, readAttempt]);

  function sendInvitation() {
    if (!ready || pending || disabled || finished || !reviewing || !acknowledged || !reason.trim()) return;
    const payload = { applicationId: application.id, expectedVersion: application.version, reason: reason.trim(), acknowledged: true as const };
    const fingerprint = JSON.stringify(payload);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, requestId: crypto.randomUUID() };
    const requestId = intent.current.requestId;
    setError(null); setMessage(null);
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
          setMessage('Utskicket är inte konfigurerat. Ingen kontoinbjudan har skickats. Kontrollera mejlinställningarna innan du försöker igen.');
        } else if (result.status === 'unknown') {
          setFinished(true);
          setMessage('Det gick inte att bekräfta om mejlet skickades. Skicka inte en ny inbjudan innan utskicksstatus har kontrollerats.');
        } else {
          setFinished(true);
          setMessage(result.status === 'already_sent' ? `Kontoinbjudan har redan skickats till ${result.email}.` : `Kontoinbjudan har skickats till ${result.email}. Kunden väljer lösenord via mejlet.`);
        }
      } catch {
        if (active.current) setError('Resultatet kunde inte läsas in. Försök igen med samma granskning för att kontrollera utskicket.');
      }
    });
  }

  return <section aria-labelledby="application-invitation-heading" style={{ marginTop: 24 }}>
    <h3 id="application-invitation-heading">Godkänn ansökan och bjud in</h3>
    <p>Granska ansökan innan du godkänner tillgång till Trafexa. Kunden får en kontoinbjudan till ansökans e-postadress och väljer sitt lösenord. Finansiering och företagsmedlemskap hanteras separat.</p>
    <form className="workspace-form" onSubmit={event => {
      event.preventDefault();
      if (reviewing) sendInvitation();
      else if (ready && !disabled && !pending && reason.trim()) { setReason(reason.trim()); setReviewing(true); setAcknowledged(false); setError(null); setMessage(null); }
    }}>
      {reviewing && <dl><dt>Sökande</dt><dd>{application.name}</dd><dt>Företag</dt><dd>{application.company} · {application.organisationNumber || 'Organisationsnummer saknas'}</dd><dt>Kontoinbjudan skickas till</dt><dd style={{ overflowWrap: 'anywhere' }}>{application.email}</dd></dl>}
      <label>Motivering för kontogodkännande<input required minLength={2} maxLength={500} value={reason} disabled={!ready || disabled || pending || reviewing || finished || existing} onChange={event => setReason(event.target.value)}/></label>
      {reviewing && <label className="auth-checkbox"><input type="checkbox" required checked={acknowledged} disabled={disabled || pending || finished} onChange={event => setAcknowledged(event.target.checked)}/><span>Jag har granskat ansökan och godkänner kontot för {application.email}.</span></label>}
      {error && <p role="alert" className="notice error">{error}</p>}
      {message && <p role="status" className="notice">{message}</p>}
      {!ready && !error && <p role="status">Kontrollerar tidigare kontoinbjudan…</p>}
      <div className="table-controls">
        <button type="submit" className="button button-green" disabled={!ready || disabled || pending || finished || reason.trim().length < 2 || reviewing && !acknowledged}>{pending ? 'Behandlar kontoinbjudan…' : reviewing ? 'Godkänn och skicka kontoinbjudan' : 'Granska godkännande'}</button>
        {!ready && error && <button type="button" className="button button-outline" disabled={disabled || pending} onClick={() => setReadAttempt(attempt => attempt + 1)}>Kontrollera kontoinbjudan igen</button>}
        {reviewing && !finished && <button type="button" className="button button-outline" disabled={disabled || pending} onClick={() => { setReviewing(false); setAcknowledged(false); }}>Ändra granskning</button>}
        {finished && <button type="button" className="button button-outline" disabled={disabled || pending} onClick={onComplete}>Läs in aktuell ansökan</button>}
      </div>
    </form>
  </section>;
}
