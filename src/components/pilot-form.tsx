'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import { LEGAL_POLICY_VERSION } from '../lib/privacy/policy-version';

const seekingOptions = [['system', 'Trafexa-systemet'], ['purchase_finance', 'Inköpsfinansiering'], ['stock_finance', 'Lagerfinansiering'], ['dealer_network', 'Handlarnätverk'], ['advertising', 'Annonsering'], ['other', 'Annat']] as const;

export function PilotForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'success-with-changes' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const inFlight = useRef(false);
  const intent = useRef<{ fingerprint: string; requestId: string } | null>(null);
  useEffect(() => setReady(true), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!ready || inFlight.current || !form.reportValidity()) return;
    const formData = new FormData(form);
    const seeking = formData.getAll('seeking').map(String).sort();
    if (!seeking.length) { setMessage('Välj minst ett område som ansökan gäller.'); setStatus('error'); return; }
    const fields = { ...Object.fromEntries(formData), seeking, privacyAcknowledged: formData.get('privacyAcknowledged') === 'yes', privacyVersion: LEGAL_POLICY_VERSION };
    const fingerprint = JSON.stringify(fields);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, requestId: crypto.randomUUID() };
    const requestId = intent.current.requestId;
    const payload = JSON.stringify({ ...fields, requestId });
    inFlight.current = true;
    setStatus('sending');
    setMessage('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/demo-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted || !response.ok || body?.success !== true || body?.receipt?.requestId !== requestId || body?.receipt?.accepted !== true) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Ansökan kunde inte sparas. Försök igen eller kontakta oss via mejl.');
      }
      const current = new FormData(form);
      const changed = JSON.stringify({ ...Object.fromEntries(current), seeking: current.getAll('seeking').map(String).sort(), privacyAcknowledged: current.get('privacyAcknowledged') === 'yes', privacyVersion: LEGAL_POLICY_VERSION }) !== fingerprint;
      intent.current = null;
      setStatus(changed ? 'success-with-changes' : 'success');
      if (changed) setMessage('Din ansökan har sparats. Dina senaste ändringar har behållits och är inte skickade ännu.');
    } catch (error) {
      setMessage(controller.signal.aborted ? 'Det tog för lång tid att skicka ansökan. Försök igen eller kontakta oss via mejl.' : error instanceof Error ? error.message : 'Ansökan kunde inte sparas.');
      setStatus('error');
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
    }
  }
  if (status === 'success') return <div className="pilot-success" role="status"><span className="success-symbol"><Check size={28}/></span><h3>Tack. Vi hörs snart.</h3><p>Din ansökan har sparats och granskas av Trafexa. Efter godkännande får du en kontoinbjudan via e-post och väljer ditt lösenord.</p><button className="text-link" onClick={() => setStatus('idle')}>Skicka en till ansökan <ArrowUpRight size={16}/></button></div>;
  return <form className="pilot-form" action="/api/demo-requests" method="post" onSubmit={submit} aria-busy={status === 'sending'}>
    <p>Ansök om tillgång till Trafexa. Vi granskar ansökan och skickar en kontoinbjudan efter godkännande.</p>
    <div className="field-pair"><label>Företag<input name="company" autoComplete="organization" placeholder="Din bilfirma" required maxLength={160}/></label><label>Ditt namn<input name="name" autoComplete="name" placeholder="För- och efternamn" required maxLength={160}/></label></div>
    <div className="field-pair"><label>Mejladress<input name="email" autoComplete="email" type="email" placeholder="namn@bilfirma.se" required maxLength={254}/></label><label>Telefon<input name="phone" autoComplete="tel" type="tel" placeholder="070 000 00 00" required minLength={7} maxLength={40}/></label></div>
    <label>Organisationsnummer<input name="organisationNumber" placeholder="556123-4567" inputMode="numeric" required pattern="[0-9]{6}-?[0-9]{4}" maxLength={11}/></label>
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend>Vad söker ni? (välj minst ett område)</legend><div style={{ display: 'grid', gap: 10, marginTop: 12 }}>{seekingOptions.map(([value, label]) => <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><input style={{ width: 'auto' }} type="checkbox" name="seeking" value={value}/>{label}</label>)}</div></fieldset>
    <label>Beskriv vad ni söker<textarea name="message" rows={3} placeholder="Berätta om ditt fordonslager, ditt team och vilka funktioner du vill se." required minLength={2} maxLength={2000}/></label>
    <div className="honeypot" aria-hidden="true"><label>Webbplats<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
    <label className="form-privacy" style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><input style={{ width: 'auto', marginTop: 4 }} name="privacyAcknowledged" value="yes" type="checkbox" required/><span>Jag har tagit del av <a href="/privacy">integritetspolicyn</a> och informationen om hur Trafexa behandlar uppgifterna i min ansökan. Version {LEGAL_POLICY_VERSION}.</span></label>
    <noscript><p className="form-privacy">Mejla din förfrågan till <a href="mailto:info@trafexa.com">info@trafexa.com</a>.</p></noscript>
    {status === 'error' ? <p className="form-error" role="alert">{message} <a href="mailto:info@trafexa.com">info@trafexa.com</a></p> : null}
    {status === 'success-with-changes' ? <p className="form-privacy" role="status">{message}</p> : null}
    {status === 'sending' ? <p className="form-privacy" role="status">Skickar din ansökan…</p> : null}
    <button className="button button-green" type="submit" disabled={!ready || status === 'sending'}>{status === 'sending' ? 'Skickar…' : 'Skicka ansökan'}<ArrowUpRight size={18}/></button>
  </form>;
}
