'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { AdvertisingConnection } from '@/lib/advertising/database.types';
import { requestAdvertisingConnectionAction } from '@/lib/advertising/actions';

export type AdvertisingChannel = 'blocket' | 'wayke';
export type ConnectionView = AdvertisingConnection;
export const channelNames: Record<AdvertisingChannel, string> = { blocket: 'Blocket', wayke: 'Wayke' };
const connectionLabel = (status: string) => ({ pending: 'Anslutning begärd', requested: 'Anslutning begärd', verified: 'Verifierad anslutning', suspended: 'Spärrad anslutning', rejected: 'Anslutning nekad', unconfigured: 'Ej ansluten' }[status] ?? 'Ej ansluten');

export function ChannelConnections({ companyId, role, userId, demo = false, connections, disabled = false, onSaved, onDenied, onBusyChange }: {
  companyId: string; role: string; userId: string; demo?: boolean; connections: ConnectionView[]; disabled?: boolean;
  onSaved: () => Promise<boolean>; onDenied: (message: string) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [channel, setChannel] = useState<AdvertisingChannel>('blocket');
  const [reference, setReference] = useState('');
  const [review, setReview] = useState<{ channel: AdvertisingChannel; accountReference: string; confirmed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requests = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewId = useId();
  const canEdit = !demo && ['owner', 'admin'].includes(role);
  useEffect(() => { heading.current?.focus(); }, [review?.confirmed, review?.channel]);
  useEffect(() => { setReview(null); setError(null); setNotice(null); }, [companyId, role, userId]);
  function save() {
    if (!review?.confirmed || !canEdit || disabled || inFlight.current) return;
    const payload = { companyId, channel: review.channel, accountReference: review.accountReference };
    const fingerprint = JSON.stringify(payload);
    if (!requests.current.has(fingerprint)) requests.current.set(fingerprint, crypto.randomUUID());
    const requestId = requests.current.get(fingerprint)!;
    inFlight.current = true; onBusyChange?.(true); setError(null); setNotice(null);
    startTransition(async () => {
      let received = false;
      try {
        const result = await requestAdvertisingConnectionAction({ ...payload, requestId });
        if (!result.ok) { setError(result.message); if (['access_denied', 'unauthenticated'].includes(result.code)) onDenied(result.message); return; }
        received = true; setReview(null); setReference('');
        const refreshed = await onSaved();
        if (refreshed) setNotice('Anslutningsförfrågan har sparats. Kanalens aktuella status har lästs in på nytt.');
      } catch {
        setError(received ? 'Förfrågan har sparats, men aktuell kanalstatus kunde inte verifieras. Uppdatera annonskontot.' : 'Svaret kunde inte verifieras. Försök igen med samma uppgifter och samma begäran.');
      } finally { inFlight.current = false; onBusyChange?.(false); }
    });
  }
  return <section className="surface" aria-label="Annonskanaler" id="advertising-connections" style={{ marginTop: 24 }}><div className="panel-heading"><h2>Kanalanslutningar</h2></div>
    <p className="settings-note">En anslutningsförfrågan aktiverar ingen kanal. Leverans kräver verifierat kanalkonto och den aktuella kanalens avtalade tekniska anslutning.</p>
    <div className="table-scroll"><table className="data-table"><caption className="sr-only">Företagets anslutningar till annonskanaler</caption><thead><tr><th scope="col">Kanal</th><th scope="col">Status</th><th scope="col">Extern handlarreferens</th></tr></thead><tbody>{(['blocket', 'wayke'] as const).map(name => { const connection = connections.find(item => item.channel === name); return <tr key={name}><td><strong>{channelNames[name]}</strong></td><td>{connectionLabel(connection?.status ?? 'unconfigured')}{connection?.status === 'verified' && !connection.dispatcherAvailable && <small className="cell-subtext">Kanalleverans ej aktiverad</small>}</td><td style={{ overflowWrap: 'anywhere' }}>{connection?.accountReference || '—'}</td></tr>; })}</tbody></table></div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {canEdit ? <form className="workspace-form" style={{ padding: 20 }} onSubmit={event => { event.preventDefault(); if (pending || disabled || !event.currentTarget.reportValidity()) return; setReview({ channel, accountReference: reference.trim(), confirmed: false }); setError(null); setNotice(null); }}><h3>Anslut kanal</h3><label>Kanal för anslutning<select value={channel} disabled={pending || disabled} onChange={event => setChannel(event.target.value as AdvertisingChannel)}><option value="blocket">Blocket</option><option value="wayke">Wayke</option></select></label><label>Extern handlar- eller kontoreferens<input type="text" value={reference} maxLength={160} required autoComplete="off" disabled={pending || disabled} onChange={event => setReference(event.target.value)}/></label><p className="form-privacy">Ange referensen till företagets kanalkonto. Lämna inga API-nycklar, lösenord eller andra hemligheter. Kanalavtal och åtkomst verifieras separat.</p><button className="button button-green" type="submit" disabled={pending || disabled}>Granska anslutningsförfrågan</button></form> : <p className="settings-note">{demo ? 'Demonstration med exempeldata. Ingen kanalanslutning görs här.' : 'Ägare och administratörer kan begära kanalanslutning. Din roll kan läsa anslutningarnas status.'}</p>}
    {review && canEdit && <section className="dialog-content" aria-labelledby={reviewId}><h3 id={reviewId} tabIndex={-1} ref={heading}>{review.confirmed ? 'Bekräfta anslutningsförfrågan' : 'Granska kanalanslutning'}</h3><p><strong>{channelNames[review.channel]}</strong> · {review.accountReference}</p><p>Förfrågan sparas för granskning. Den innebär ingen publicering eller färdig teknisk anslutning.</p><div className="table-controls" style={{ flexWrap: 'wrap' }}><button type="button" className="button button-green" disabled={pending || disabled} onClick={() => review.confirmed ? save() : setReview({ ...review, confirmed: true })}>{review.confirmed ? 'Spara anslutningsförfrågan' : 'Fortsätt till bekräftelse'}</button><button type="button" className="text-link" disabled={pending || disabled} onClick={() => setReview(null)}>Avbryt</button></div></section>}
  </section>;
}
