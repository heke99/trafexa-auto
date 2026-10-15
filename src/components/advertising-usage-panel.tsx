'use client';

import { useEffect, useRef, useState } from 'react';
import { getPlatformAdvertisingUsageAction, listAdvertisingUsageAction } from '@/lib/advertising/usage-actions';
import type { AdvertisingUsagePage } from '@/lib/advertising/usage-types';
import { channelNames } from './channel-connections';

const currentMonth = () => {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
};
const date = (value: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium' }).format(new Date(value));

export function AdvertisingUsagePanel({ companyId, userId, role, superadmin = false, onDenied }: { companyId: string; userId: string; role: string; superadmin?: boolean; onDenied?: (message: string) => void }) {
  // A keyed inner component prevents even a single render of the previous tenant's data.
  return <Usage key={`${companyId}:${userId}:${role}:${superadmin}`} companyId={companyId} userId={userId} role={role} superadmin={superadmin} onDenied={onDenied}/>;
}
function Usage({ companyId, userId, role, superadmin = false, onDenied }: { companyId: string; userId: string; role: string; superadmin?: boolean; onDenied?: (message: string) => void }) {
  const [month, setMonth] = useState(currentMonth);
  const [page, setPage] = useState<AdvertisingUsagePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const denyCallback = useRef(onDenied);
  denyCallback.current = onDenied;
  useEffect(() => {
    const request = ++generation.current;
    setPage(null);
    if (denied) { setLoading(false); return; }
    setError(null);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { setLoading(false); return; }
    setLoading(true);
    void (superadmin ? getPlatformAdvertisingUsageAction : listAdvertisingUsageAction)({ companyId, month }).then(result => {
      if (generation.current !== request) return;
      if (!result.ok) {
        setError(result.message);
        if (result.code === 'access_denied' || result.code === 'unauthenticated') { setDenied(true); denyCallback.current?.(result.message); }
        return;
      }
      if (result.companyId !== companyId || result.actorUserId !== userId || result.actorRole !== (superadmin ? 'platform_admin' : role) || result.month !== month || result.timeZone !== 'Europe/Stockholm') {
        const message = 'Företaget eller behörigheten har ändrats. Läs in annonskontot på nytt.';
        setError(message); setDenied(true); denyCallback.current?.(message); return;
      }
      setPage(result);
    }).catch(() => { if (generation.current === request) setError('Annonsstatistiken kunde inte verifieras. Försök läsa in den igen.'); })
      .finally(() => { if (generation.current === request) setLoading(false); });
    return () => { ++generation.current; };
  }, [companyId, userId, role, superadmin, month, refresh, denied]);
  return <section className="surface" style={{ marginTop: 24 }} aria-label="Annonsstatistik och faktureringsunderlag">
    <div className="panel-heading"><h2>Annonsstatistik och faktureringsunderlag</h2></div>
    <div style={{ padding: 20 }}>
      <p>Debiteringsgrund: en unik publicerad annons per kanal. Nya versioner och upprepade leveransförsök räknas inte som nya debiteringar.</p>
      <div className="table-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 6 }}>Faktureringsmånad<input type="month" value={month} required disabled={denied} onChange={event => { ++generation.current; setPage(null); setError(null); setMonth(event.target.value); }}/></label>
        <button className="button button-outline" type="button" disabled={loading || denied || !month} onClick={() => { setPage(null); setRefresh(value => value + 1); }}>Uppdatera statistik</button>
      </div>
      <p className="settings-note">Kalendermånad enligt svensk tid (Europe/Stockholm).</p>
      {loading && <p role="status">Verifierar annonsstatistik…</p>}{error && <p className="form-error" role="alert">{error}</p>}
      {page && <>
        <p><a className="text-link" href={`/api/advertising/usage/${encodeURIComponent(page.month)}/csv${superadmin ? `?companyId=${encodeURIComponent(companyId)}` : ''}`}>Hämta underlag som CSV</a></p>
        <dl className="detail-list"><div><dt>Unika publiceringar under vald månad</dt><dd>{page.totals.newPublications}</dd></div></dl>
        <p className="form-privacy">Antalsstatistiken visar verifierade publiceringar. Överenskomna priser och låst månadsunderlag visas under Kanalpriser och månadsavstämning.</p>
        <div className="table-scroll"><table className="data-table"><caption>Debiteringsgrund för {page.month}</caption><thead><tr><th scope="col">Kanal</th><th scope="col">Unika publiceringar</th></tr></thead><tbody>{page.channels.map(channel => <tr key={channel.channel}><th scope="row">{channelNames[channel.channel]}</th><td>{channel.newPublications}</td></tr>)}</tbody></table></div>
        <h3 style={{ marginTop: 24 }}>Aktuell leveransstatus</h3>
        <p className="settings-note">Nuvarande status för samtliga leveransjobb, oavsett månad. Jobbantalet är inte debiteringsgrund.</p>
        <dl className="detail-list"><div><dt>Annonsutkast</dt><dd>{page.totals.drafts}</dd></div><div><dt>Klara annonsversioner</dt><dd>{page.totals.ready}</dd></div></dl>
        <div className="table-scroll"><table className="data-table"><caption className="sr-only">Aktuell jobbstatus per kanal</caption><thead><tr><th scope="col">Kanal</th><th scope="col">Köade</th><th scope="col">Pågår</th><th scope="col">Inskickade</th><th scope="col">Publicerade jobb</th><th scope="col">Avvisade</th><th scope="col">Nytt försök</th><th scope="col">Okänt utfall</th></tr></thead><tbody>{page.channels.map(channel => <tr key={channel.channel}><th scope="row">{channelNames[channel.channel]}</th><td>{channel.queued}</td><td>{channel.dispatching}</td><td>{channel.submitted}</td><td>{channel.published}</td><td>{channel.rejected}</td><td>{channel.retryable}</td><td>{channel.outcomeUnknown}</td></tr>)}</tbody></table></div>
        <p className="settings-note">Publiceringsunderlaget registreras från {date(page.trackingStartedAt)}. {page.legacyPublishedJobs > 0 ? `${page.legacyPublishedJobs} äldre publicerade jobb saknar verifierat publiceringsunderlag och ingår inte i debiteringsgrunden.` : 'Endast verifierade publiceringar ingår i debiteringsgrunden.'}</p>
      </>}
    </div>
  </section>;
}
