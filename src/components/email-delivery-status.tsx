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
    if (lock.current || loading || !ack || !status?.ok || status.transport !== 'configured') return;
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

  return <section className="surface" aria-labelledby="transactional-email-heading" style={{ marginBlock: 24, padding: 24, overflowWrap: 'anywhere' }}>
    <div className="panel-heading" style={{ padding: 0, flexWrap: 'wrap', gap: 16 }}>
      <h2 id="transactional-email-heading">Transaktionsmejl</h2>
      <button type="button" className="button button-outline" disabled={busy || loading} onClick={() => void refresh()}>{loading ? 'Hämtar mejlstatus…' : 'Uppdatera mejlstatus'}</button>
    </div>
    <p>Avsändare: kundtjanst@trafexa.com. Svar: info@trafexa.com.</p>
    {loading && <p role="status">Hämtar mejlstatus…</p>}
    {status && !status.ok && <p role="alert" className="form-error">{status.message}</p>}
    {status?.ok && <>
      <p>{status.transport === 'configured' ? 'Mejltransport aktiverad.' : 'Mejltransport behöver konfigureras och avsändardomänen verifieras.'}</p>
      <p>Kontomejl och lösenordsåterställning skickas separat av Supabase Auth.</p>
      {status.counts && <p>Väntar: {status.counts.pending} · Accepterade av leverantör: {status.counts.accepted} · Avvisade: {status.counts.rejected} · Okänt utfall: {status.counts.unknown}</p>}
      <p>Nya händelser försöker skickas direkt när mejltransporten är aktiverad. Väntande mejl kan skickas här. Inget schemalagt utskicksjobb är aktiverat.</p>
      <label><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} disabled={busy || status.transport !== 'configured'}/> Jag vill skicka nästa väntande transaktionsmejl</label>
      <p><button type="button" className="button button-green" disabled={!ack || busy || status.transport !== 'configured'} onClick={() => void dispatch()}>{busy ? 'Skickar…' : 'Skicka nästa mejl'}</button></p>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
