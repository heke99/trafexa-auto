'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { cancelDealAction } from '@/lib/data/deal-cancellation-actions';
import type { CancelDealInput, DealCancellationReceipt } from '@/lib/deal-cancellation/types';

export type DealCancellationProps = { companyId: string; dealId: string; status: 'draft' | 'reserved' | 'cancelled'; canEdit: boolean; demo?: boolean; onCancelled?: (receipt: DealCancellationReceipt) => void };
export function DealCancellation(props: DealCancellationProps) {
  return <CancellationPanel key={`${props.companyId}:${props.dealId}:${props.status}:${props.canEdit}:${!!props.demo}`} {...props} />;
}
function CancellationPanel({ companyId, dealId, status, canEdit, demo = false, onCancelled }: DealCancellationProps) {
  const prefix = useId();
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [review, setReview] = useState('');
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [error, setError] = useState('');
  const [saved, setSaved] = useState<DealCancellationReceipt | null>(null);
  const alive = useRef(false), lock = useRef(false), retries = useRef(new Map<string, string>());
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (review) reviewHeading.current?.focus(); }, [review]);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || blocked || demo || !canEdit || status === 'cancelled' || !event.currentTarget.reportValidity()) return;
    const text = reason.trim();
    if (text.length < 2 || text.length > 500 || /[\u0000-\u001f\u007f]/.test(text)) { setError('Ange en anledning på 2–500 tecken utan radbrytningar.'); return; }
    setError(''); setReview(text);
  }
  async function confirm() {
    if (!review || lock.current || blocked || demo || !canEdit || status === 'cancelled') return;
    const values = { companyId, dealId, expectedStatus: status, reason: review };
    const fingerprint = JSON.stringify(values);
    let requestId = retries.current.get(fingerprint);
    if (!requestId) { requestId = crypto.randomUUID(); retries.current.set(fingerprint, requestId); }
    const args: CancelDealInput = { ...values, requestId };
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await cancelDealAction(args);
      if (!alive.current) return;
      if (!result.ok) {
        setError(result.message);
        if (result.code === 'access_denied' || result.code === 'unauthenticated' || result.code === 'conflict') { setBlocked(true); setReview(''); setReason(''); retries.current.clear(); }
        return;
      }
      const { ok: _ok, ...receipt } = result;
      setSaved(receipt); setOpen(false); setReview(''); setReason(''); retries.current.clear(); onCancelled?.(receipt);
    } catch { if (alive.current) setError('Avbrytningen kunde inte bekräftas. Försök igen med samma granskade anledning.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  if (saved) return <p role="status">Affären är avbruten. {saved.releasedReservations} reservationer har avslutats. Offerthistoriken är bevarad.</p>;
  if (status === 'cancelled') return <p>Affären är avbruten. Offerthistoriken är bevarad.</p>;
  if (!canEdit || demo) return <p className="muted">{demo ? 'Avbrytning sparas inte i demon.' : 'Din roll kan läsa affären.'}</p>;
  return <section aria-label="Avbryt affär">
    <p className="muted">Avbryt affären och avsluta dess reservationer. Offerthistoriken bevaras. En accepterad offert behöver hanteras genom en separat överenskommelse.</p>
    {error ? <p role="alert">{error}</p> : null}
    {!open ? <button type="button" className="button button-outline" disabled={blocked} onClick={() => setOpen(true)}>Avbryt affär</button> : review ? <div role="region" aria-labelledby={`${prefix}-review`}>
      <h3 id={`${prefix}-review`} ref={reviewHeading} tabIndex={-1}>Granska avbrytningen</h3>
      <p style={{ overflowWrap: 'anywhere' }}>{review}</p>
      <p>Bekräftelsen sparar anledningen och avslutar endast den här affärens reservationer.</p>
      <div className="form-actions"><button type="button" className="button button-outline" disabled={busy} onClick={() => setReview('')}>Ändra anledning</button><button type="button" className="button button-green" disabled={busy || blocked} onClick={() => void confirm()}>{busy ? 'Avbryter…' : 'Bekräfta avbrytning'}</button></div>
    </div> : <form onSubmit={prepare}>
      <label htmlFor={`${prefix}-reason`}>Anledning till avbrytningen</label>
      <input id={`${prefix}-reason`} value={reason} onChange={event => setReason(event.target.value)} minLength={2} maxLength={500} required disabled={busy || blocked} />
      <div className="form-actions"><button type="button" className="button button-outline" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>Behåll affären</button><button type="submit" className="button button-green" disabled={busy || blocked}>Granska avbrytning</button></div>
    </form>}
  </section>;
}
