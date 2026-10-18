'use client';

import { useEffect, useRef, useState } from 'react';
import { getPlatformAdvertisingInvoiceEmailPageAction, listAdvertisingInvoiceEmailPageAction, queueAdvertisingInvoiceEmailAction } from '@/lib/advertising/invoice-email-actions';
import { getAdvertisingInvoiceEmailConfigurationAction, sendAdvertisingInvoiceEmailAction } from '@/lib/advertising/invoice-email-send-actions';
import { formatOre } from '@/lib/calculations/vehicle-calculation';

type Props = { companyId: string; userId: string; role: string; superadmin?: boolean; documentKind: 'invoice' | 'credit'; documentId: string; onDenied?: (message: string) => void };
type Page = Extract<Awaited<ReturnType<typeof getPlatformAdvertisingInvoiceEmailPageAction>>, { ok: true }>['page'];
const ack = 'Jag har granskat mottagaren, dokumentet och beloppet och godkänner detta förberedda mejlutskick.';
const statusLabels: Record<string, string> = { pending: 'Väntar på utskick', processing: 'Utskick pågår', accepted: 'Mottaget av mejlleverantören', rejected: 'Utskicket avvisades', unknown: 'Utskickets resultat behöver stämmas av', cancelled: 'Utskicket är avbrutet' };
const blockerLabels: Record<string, string> = { 'email.exists': 'Ett utskick finns redan för detta dokument.', 'original.creditExists': 'Originalfakturan har krediterats. Skicka kreditfakturan i stället.', 'recipient.missing': 'Dokumentet saknar en faktureringsadress.', 'recipient.suppressed': 'Mottagaradressen är spärrad efter leveransproblem eller klagomål.', 'email.adminOnly': 'Endast Trafexas superadmin får skicka fakturor och kreditfakturor.' };

const dateLabel = (value: string) => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(value))
  : 'Datum kunde inte läsas';

export function AdvertisingInvoiceEmailPanel(props: Props) {
  return <InvoiceEmail key={`${props.companyId}:${props.userId}:${props.role}:${props.superadmin}:${props.documentKind}:${props.documentId}`} {...props}/>;
}
function InvoiceEmail({ companyId, userId, role, superadmin = false, documentKind, documentId, onDenied }: Props) {
  const [page, setPage] = useState<Page | null>(null), [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), generation = useRef(0), inFlight = useRef(false), requests = useRef(new Map<string, string>()), deniedCallback = useRef(onDenied), heading = useRef<HTMLHeadingElement>(null);
  deniedCallback.current = onDenied;
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++generation.current; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);
  function failure(result: { code?: string; message: string }) {
    setError(result.message);
    if (result.code === 'access_denied' || result.code === 'unauthenticated') { ++generation.current; setPage(null); setReview(false); setConfirmed(false); setNotice(''); setConfigured(false); setDenied(true); deniedCallback.current?.(result.message); }
  }
  useEffect(() => {
    const scope = ++generation.current; setPage(null); setReview(false); setConfirmed(false); setConfigured(false);
    if (denied) { setLoading(false); return; }
    setLoading(true); setError('');
    void Promise.all([
      (superadmin ? getPlatformAdvertisingInvoiceEmailPageAction : listAdvertisingInvoiceEmailPageAction)({ companyId, documentKind, documentId }),
      superadmin ? getAdvertisingInvoiceEmailConfigurationAction() : Promise.resolve(null),
    ]).then(([result, configuration]) => {
      if (!alive.current || generation.current !== scope) return;
      if (!result.ok) { failure(result); return; }
      const value = result.page;
      if (value.companyId !== companyId || value.actorUserId !== userId || value.actorRole !== (superadmin ? 'platform_admin' : role) || value.documentKind !== documentKind || value.documentId !== documentId) { failure({ code: 'access_denied', message: 'Utskicket kunde inte verifieras för aktuellt företag, dokument och behörighet.' }); return; }
      if (configuration && !configuration.ok) { failure(configuration); return; }
      setConfigured(configuration?.ok === true && configuration.configured); setPage(value);
    }).catch(() => { if (alive.current && generation.current === scope) setError('Utskicket kunde inte verifieras. Försök igen.'); }).finally(() => { if (alive.current && generation.current === scope) setLoading(false); });
    return () => { ++generation.current; };
  }, [companyId, userId, role, superadmin, documentKind, documentId, refresh, denied]);
  async function dispatch(emailId: string, scope: number) {
    const result = await sendAdvertisingInvoiceEmailAction({ companyId, emailId });
    if (!alive.current || generation.current !== scope) return;
    if (!result.ok) {
      failure(result);
      if (result.code === 'unavailable') {
        setPage(null); setReview(false); setConfirmed(false);
        setNotice('Utskickets resultat kunde inte bekräftas. Aktuell status kontrolleras innan ett nytt försök kan göras.');
        setRefresh(value => value + 1);
      }
      return;
    }
    setNotice(result.status === 'unconfigured' ? 'Mejltjänsten är inte konfigurerad. Utskicket har inte startats.' : result.status === 'busy' ? 'Utskicket hanteras redan. Uppdatera status om en stund.' : result.status === 'unavailable' ? 'Mejltjänsten kunde inte nås. Kontrollera aktuell status före nästa försök.' : 'Utskicksförsöket är registrerat. Kontrollera aktuell status nedan; leverantörens mottagande är inte samma sak som leverans till kunden.');
    setRefresh(value => value + 1);
  }
  async function confirm() {
    if (!superadmin || !page?.canQueue || !page.preview || !review || !confirmed || inFlight.current || loading || denied) return;
    const scope = generation.current;
    const input = { companyId, documentKind, documentId, expectedDocumentSourceHash: page.documentSourceHash, expectedReviewToken: page.preview.reviewToken, reviewAcknowledged: true as const };
    const fingerprint = JSON.stringify(input); if (!requests.current.has(fingerprint)) requests.current.set(fingerprint, crypto.randomUUID());
    const requestId = requests.current.get(fingerprint)!;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    let queued = false;
    try {
      const result = await queueAdvertisingInvoiceEmailAction({ ...input, requestId });
      if (!alive.current || generation.current !== scope) return;
      if (!result.ok) { failure(result); if (result.code === 'conflict') { setPage(null); setReview(false); setConfirmed(false); setNotice('Dokumentet eller utskicket har ändrats. Granska aktuella uppgifter innan du fortsätter.'); setRefresh(value => value + 1); } return; }
      const receipt = result.receipt;
      if (receipt.companyId !== companyId || receipt.actorUserId !== userId || receipt.requestId !== requestId || receipt.documentKind !== documentKind || receipt.documentId !== documentId || receipt.documentSourceHash !== input.expectedDocumentSourceHash || receipt.reviewToken !== input.expectedReviewToken || result.email.id !== receipt.emailId || result.email.companyId !== companyId || result.email.documentId !== documentId || result.email.documentKind !== documentKind || result.email.documentSourceHash !== input.expectedDocumentSourceHash) { failure({ code: 'access_denied', message: 'Utskickskvittot kunde inte verifieras för aktuellt företag och dokument.' }); return; }
      queued = true; setPage({ ...page, email: result.email, preview: null, canQueue: false, blockers: ['email.exists'] }); setReview(false); setConfirmed(false);
      if (configured) await dispatch(result.email.id, scope);
      else { setNotice('Mejlet är förberett. Utskick är inte aktiverat och inget mejl har skickats.'); setRefresh(value => value + 1); }
    } catch { if (alive.current && generation.current === scope) { setError('Åtgärdens resultat är okänt. Uppdatera status eller försök samma granskade begäran igen. Ett okänt leverantörsresultat måste stämmas av före nytt utskick.'); if (queued) { setPage(null); setRefresh(value => value + 1); } } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  const amount = (value: string) => formatOre(documentKind === 'credit' && value !== '0' ? `-${value}` : value);
  const email = page?.email;
  const canRetry = superadmin && configured && email?.status === 'pending' && !email.bouncedAt && !email.complainedAt && (!email.nextAttemptAt || Date.parse(email.nextAttemptAt) <= Date.now());
  async function retry() {
    if (!email || !canRetry || busy || inFlight.current || denied) return;
    const scope = generation.current; inFlight.current = true; setBusy(true); setError('');
    try { await dispatch(email.id, scope); }
    catch { if (alive.current && generation.current === scope) { setError('Utskickets resultat är okänt. Uppdatera status och stäm av resultatet före ett nytt försök.'); setPage(null); setRefresh(value => value + 1); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="surface invoice-email-panel" aria-label="Dokumentets mejlutskick">
    <header className="invoice-email-header"><div><h3>{documentKind === 'credit' ? 'Mejla kreditfakturan' : 'Mejla fakturan'}</h3><p>Granska dokument och mottagare innan utskick.</p></div><button type="button" className="button button-outline" disabled={loading || busy || denied} onClick={() => { setPage(null); setReview(false); setConfirmed(false); setNotice(''); setRefresh(value => value + 1); }}>Uppdatera utskicksstatus</button></header>
    {loading && <p role="status" className="invoice-email-loading">Verifierar mejlutskick…</p>}{error && <p role="alert" className="notice error">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    {page && <><div className="invoice-email-details"><div><h4>Dokument och mottagare</h4><dl className="invoice-email-fields"><div><dt>Dokument</dt><dd>{page.documentNumber}</dd></div><div><dt>Mottagare</dt><dd>{page.recipient || 'Faktureringsadress saknas i dokumentet'}</dd></div></dl><p>PDF med dokumentets bevarade uppgifter bifogas. Mottagaradressen kommer från dokumentet.</p></div><dl className="invoice-email-amounts"><div><dt>Exklusive moms</dt><dd>{amount(page.netTotalOre)}</dd></div><div><dt>Moms</dt><dd>{amount(page.vatTotalOre)}</dd></div><div><dt>{documentKind === 'credit' ? 'Krediterat inklusive moms' : 'Inklusive moms'}</dt><dd>{amount(page.grossTotalOre)}</dd></div></dl></div>
      <dl className="invoice-email-addresses"><div><dt>Avsändare</dt><dd>kundtjanst@trafexa.com</dd></div><div><dt>Svar skickas till</dt><dd>info@trafexa.com</dd></div></dl>
      {superadmin && !configured && <p role="status" className="notice">Mejlutskick är inte aktiverat. Du kan förbereda ett granskat mejl; inget mejl skickas.</p>}
      {email ? <section className="invoice-email-status" aria-label="Dokumentets leveransstatus"><h4>Leveransstatus</h4><p className="invoice-email-current-status">{statusLabels[email.status] ?? 'Status behöver kontrolleras'}</p><dl className="invoice-email-fields">{email.deliveredAt && <div><dt>Levererat:</dt><dd><time dateTime={email.deliveredAt}>{dateLabel(email.deliveredAt)}</time></dd></div>}{email.bouncedAt && <div><dt>Leveransproblem</dt><dd>Mejlet kunde inte levereras.</dd></div>}{email.complainedAt && <div><dt>Klagomål</dt><dd>Mottagaren har markerat mejlet som oönskat.</dd></div>}</dl>{email.status === 'accepted' && !email.deliveredAt && <p>Mejlleverantören har tagit emot utskicket. Leverans till kunden är ännu inte bekräftad.</p>}{email.status === 'unknown' && <p>Stäm av utskicket med mejlleverantören. Ett nytt utskick är spärrat för att undvika dubletter.</p>}{email.status === 'pending' && email.nextAttemptAt && <p>Tidigaste nästa försök: <time dateTime={email.nextAttemptAt}>{dateLabel(email.nextAttemptAt)}</time></p>}{canRetry && <button type="button" className="button button-outline" disabled={busy} onClick={() => void retry()}>Försök skicka det granskade utskicket</button>}</section> : <>
        {page.blockers.length > 0 && <ul className="invoice-email-blockers">{page.blockers.map(value => <li key={value}>{blockerLabels[value] ?? 'En uppgift behöver kontrolleras innan dokumentet kan mejlas.'}</li>)}</ul>}
        {superadmin && page.canQueue && !review && <button type="button" className="button button-outline" disabled={busy} onClick={() => { setReview(true); setConfirmed(false); setError(''); }}>Granska mejlutskick</button>}
        {review && <section className="workspace-form invoice-email-review" aria-label="Granskning av mejlutskick"><h4 ref={heading} tabIndex={-1}>{configured ? 'Bekräfta mejlutskick' : 'Förbered mejlutskick'}</h4><p>{page.documentNumber} {configured ? 'skickas' : 'förbereds'} som PDF till {page.recipient}. Belopp inklusive moms: {amount(page.grossTotalOre)}.</p><label className="invoice-email-confirmation"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>{ack}</span></label><div className="invoice-email-controls"><button type="button" className="button button-green" disabled={busy || !confirmed} onClick={() => void confirm()}>{configured ? 'Bekräfta och skicka mejlet' : 'Bekräfta och förbered mejlet'}</button><button type="button" className="button button-outline" disabled={busy} onClick={() => { setReview(false); setConfirmed(false); }}>Avbryt mejlgranskning</button></div></section>}
      </>}
    </>}
  </section>;
}
