'use client';

import { useEffect, useRef, useState } from 'react';
import { getTransactionalEmailStatusAction, dispatchTransactionalEmailAction } from '@/lib/email/actions';

type EmailStatus = Awaited<ReturnType<typeof getTransactionalEmailStatusAction>>;
const unavailable: EmailStatus = { ok: false, message: 'Mejlstatus kunde inte hämtas. Uppdatera status för att försöka igen.' };

export function EmailDeliveryStatus() {
  const alive = useRef(true);
  const lock = useRef(false);
  const generation = useRef(0);
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    const request = ++generation.current;
    setLoading(true);
    setStatus(null);
    setAck(false);
    try {
      const result = await getTransactionalEmailStatusAction();
      if (alive.current && request === generation.current) setStatus(result);
    } catch {
      if (alive.current && request === generation.current) setStatus(unavailable);
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; ++generation.current; };
  }, []);

  async function dispatch() {
    if (lock.current || loading || !ack || !status?.ok || status.transport !== 'configured' || !status.counts?.pending) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await dispatchTransactionalEmailAction({ acknowledged: true });
      if (!alive.current) return;
      setAck(false);
      if (!result.ok) {
        setStatus({ ok: false, message: result.message });
        return;
      }
      const labels: Record<string, string> = {
        accepted: 'Mejlet har accepterats av leverantören. Leverans till inkorgen är inte bekräftad.',
        empty: 'Inga mejl väntar på utskick.',
        unconfigured: 'Mejltransporten är inte aktiverad.',
        unknown: 'Utfallet är okänt. Kontrollera hos leverantören innan ett nytt utskick görs.',
        rejected: 'Leverantören avvisade utskicket.',
        retryable: 'Leverantören begränsade utskicket. Försök igen senare.',
        cancelled: 'Utskicket stoppades eftersom underlaget eller behörigheten ändrats.',
      };
      setMessage(labels[result.status] ?? 'Utskicket kunde inte verifieras.');
      await refresh();
    } catch {
      if (alive.current) {
        setAck(false);
        setStatus({ ok: false, message: 'Utskicket kunde inte verifieras. Kontrollera status innan ett nytt utskick görs.' });
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const configuration = status?.ok ? status : null;
  const diagnostics = configuration?.diagnostics;
  const paused = configuration?.transport !== 'configured' && diagnostics?.enabled === false;
  const ready = configuration?.transport === 'configured';
  const pendingCount = configuration?.counts?.pending ?? 0;

  return <section className="surface email-delivery-panel" aria-labelledby="transactional-email-heading">
    <header className="email-delivery-header">
      <div><h2 id="transactional-email-heading">Transaktionsmejl</h2><p>Status för automatiska mejl från händelser i Trafexa.</p></div>
      <button type="button" className="button button-outline" disabled={busy || loading} onClick={() => void refresh()}>{loading ? 'Hämtar mejlstatus…' : 'Uppdatera mejlstatus'}</button>
    </header>
    {loading && <p role="status" className="email-delivery-loading">Hämtar mejlstatus…</p>}
    {status && !status.ok && <p role="alert" className="notice error">{status.message}</p>}
    {configuration && <>
      <div className="email-delivery-connection">
        <div><span className={`badge ${ready ? 'badge-green' : ''}`}>{ready ? 'Aktiverat' : paused ? 'Pausat' : 'Inställningar saknas'}</span><h3>{ready ? 'Automatiska händelsemejl är aktiverade' : paused ? 'Automatiska händelsemejl är pausade' : 'Utskicksinställningarna behöver kontrolleras'}</h3><p>{ready ? 'Nya händelser försöker skickas direkt. Äldre väntande mejl hanteras separat nedan.' : paused ? 'Automatiska utskick är avstängda. Inga väntande händelsemejl skickas från den här panelen.' : 'Mejl kan inte skickas med nuvarande inställningar. Kontrollera mejlkonfigurationen innan utskick.'}</p>
        {diagnostics && !ready && <ul className="email-delivery-config-notes">{!diagnostics.domainVerified && <li>Avsändardomänen är inte markerad som verifierad i inställningarna.</li>}{!diagnostics.credentialsPresent && <li>Uppgifter för mejltjänsten saknas.</li>}{!diagnostics.projectConfigured && <li>Projektets mejlkoppling saknas.</li>}</ul>}</div>
        <dl className="email-delivery-addresses"><div><dt>Avsändare</dt><dd>kundtjanst@trafexa.com</dd></div><div><dt>Svar skickas till</dt><dd>info@trafexa.com</dd></div></dl>
      </div>
      {configuration.counts && <div className="email-delivery-queue" aria-labelledby="email-queue-heading"><h3 id="email-queue-heading">Kö för händelsemejl</h3><dl className="email-delivery-metrics">{([
        ['pending', 'Väntar på utskick'], ['accepted', 'Mottagna av mejltjänsten'], ['rejected', 'Avvisade'], ['unknown', 'Okänt utfall'],
      ] as const).map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{configuration.counts[key] ?? 0}</dd></div>)}</dl><p>Antalen gäller händelsemejl. Välkomstmejl, lösenordsåterställning och fakturamejl ingår inte. Mottagna av mejltjänsten betyder inte bekräftad leverans till inkorgen.</p></div>}
      <details className="email-delivery-manual"><summary>Manuellt utskick av väntande mejl</summary><div><p>{pendingCount ? `${pendingCount} mejl väntar. Här kan du skicka ett mejl i taget efter kontroll.` : 'Inga mejl väntar på utskick. Uppdatera status för att läsa in kön igen.'} Kön har inget schemalagt utskicksjobb.</p>{!ready && <p>Manuellt utskick är inte tillgängligt medan händelsemejl är {paused ? 'pausade' : 'okonfigurerade'}.</p>}<label className="email-delivery-confirmation"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} disabled={busy || !ready || !pendingCount}/><span>Jag vill skicka nästa väntande transaktionsmejl</span></label><button type="button" className="button button-green" disabled={!ack || busy || !ready || !pendingCount} onClick={() => void dispatch()}>{busy ? 'Skickar…' : 'Skicka nästa mejl'}</button></div></details>
      <aside className="email-delivery-account-note" aria-label="Kontomejl"><h3>Välkomstmejl och konto</h3><p>Välkomstmejl efter godkänd ansökan hanteras separat{configuration.invitationTransport === 'configured' ? ' och är konfigurerade för utskick' : configuration.invitationTransport === 'unconfigured' ? ' och behöver konfigureras' : ''}. Lösenordsåterställning har ett eget utskicksflöde.</p></aside>
    </>}
    {message && <p role="status" className="notice email-delivery-result">{message}</p>}
  </section>;
}
