'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { createCustomerLeadAction, listCustomerLeadsAction, updateLeadStatusAction, type LeadCursor, type LeadStatus, type LeadSummary } from '@/lib/data/lead-actions';

export type CustomerLeadsProps = { companyId: string; canEdit: boolean; demo?: boolean };
const statusLabels: Record<LeadStatus, string> = { new: 'Ny', contacted: 'Kontaktad', qualified: 'Kvalificerad', closed: 'Avslutad' };
const demoLeads: LeadSummary[] = [{ id: 'demo-lead', status: 'new', subject: 'Intresserad av en kombi. Följ upp önskemål och budget.', createdAt: '2026-10-13T10:00:00Z', customer: { id: 'demo-contact', name: 'Anna Exempel', email: 'anna@example.invalid', phone: null } }];

/** A company switch creates fresh state, so a previous company's contacts never remain visible. */
export function CustomerLeads(props: CustomerLeadsProps) {
  return <CustomerLeadsPanel key={`${props.companyId}:${props.demo ? 'demo' : 'live'}`} {...props} />;
}

function CustomerLeadsPanel({ companyId, canEdit, demo = false }: CustomerLeadsProps) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState<LeadSummary[]>(demo ? demoLeads : []);
  const [cursor, setCursor] = useState<LeadCursor>();
  const [loaded, setLoaded] = useState(demo);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const retry = useRef<{ body: string; submission: string } | undefined>(undefined);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open || demo) return;
    let cancelled = false;
    startTransition(async () => {
      setLoading(true); setListError('');
      try {
        const result = await listCustomerLeadsAction(companyId);
        if (cancelled) return;
        if (!result.ok) { setListError(result.message); return; }
        setLeads(result.leads ?? []); setCursor(result.nextBefore); setLoaded(true);
      } catch { if (!cancelled) setListError('Kundförfrågningarna kunde inte hämtas. Försök igen.'); }
      finally { if (!cancelled) setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [open, demo, companyId]);

  async function fetchLeads(older = false) {
    setListError('');
    const result = await listCustomerLeadsAction(companyId, older ? cursor : undefined);
    if (!alive.current) return;
    if (!result.ok) { setListError(result.message); return; }
    setLeads((current) => older ? [...current, ...(result.leads ?? [])].filter((lead, index, all) => all.findIndex((entry) => entry.id === lead.id) === index) : result.leads ?? []);
    setCursor(result.nextBefore); setLoaded(true);
  }

  function refresh(older = false) {
    if (demo || pending) return;
    startTransition(async () => {
      setError(''); setLoading(true);
      try { await fetchLeads(older); }
      catch { if (alive.current) setListError('Kundförfrågningarna kunde inte hämtas. Försök igen.'); }
      finally { if (alive.current) setLoading(false); }
    });
  }

  function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo || !canEdit || pending || !event.currentTarget.reportValidity()) return;
    const form = new FormData(event.currentTarget);
    form.set('company_id', companyId);
    const body = JSON.stringify([companyId, name.trim(), email.trim().toLowerCase(), phone.trim(), subject.trim()]);
    if (retry.current?.body !== body) retry.current = { body, submission: crypto.randomUUID() };
    form.set('submission_id', retry.current.submission);
    startTransition(async () => {
      setError(''); setMessage('');
      try {
        const result = await createCustomerLeadAction(form);
        if (!alive.current) return;
        if (!result.ok) { setError(result.message); return; }
        setMessage(result.message); setName(''); setEmail(''); setPhone(''); setSubject(''); retry.current = undefined;
        try { await fetchLeads(); }
        catch { if (alive.current) setError('Förfrågan är sparad, men listan kunde inte uppdateras. Uppdatera listan för att se den.'); }
      } catch { if (alive.current) setError('Sparandet kunde inte bekräftas. Försök igen med samma uppgifter inom sju dagar.'); }
    });
  }

  function changeStatus(lead: LeadSummary, status: LeadStatus) {
    if (demo || !canEdit || pending) return;
    const form = new FormData();
    form.set('company_id', companyId); form.set('lead_id', lead.id);
    form.set('previous_status', lead.status); form.set('status', status);
    startTransition(async () => {
      setError(''); setMessage('');
      try {
        const result = await updateLeadStatusAction(form);
        if (!alive.current) return;
        if (!result.ok) {
          setError(result.message);
          if (result.conflict) {
            try { await fetchLeads(); }
            catch { if (alive.current) setError(`${result.message} Uppdatera listan manuellt om den inte kan hämtas.`); }
          }
          return;
        }
        setLeads((current) => current.map((row) => row.id === lead.id ? { ...row, status } : row));
        setMessage(result.message);
      } catch { if (alive.current) setError('Statusen kunde inte bekräftas. Uppdatera listan innan du försöker igen.'); }
    });
  }

  const busy = pending || loading;
  return <details className="surface" style={{ marginTop: 24 }} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary id={`${fieldId}-heading`} style={{ padding: 20, cursor: 'pointer', fontWeight: 600 }}>Kundförfrågningar</summary>
    {open ? <section aria-labelledby={`${fieldId}-heading`} style={{ padding: 20, paddingTop: 0 }}>
      <p className="muted">Samla nya kundkontakter och följ förfrågan från första kontakt till avslut.</p>
      {demo ? <p className="inline-note">Demoläge · exempel och läsvisning. Kundförfrågningar sparas i ett inloggat företagskonto.</p> : !canEdit ? <p className="inline-note">Din roll har läsbehörighet. Ägare, administratörer och säljare kan registrera och uppdatera förfrågningar.</p> : null}
      {loading ? <p role="status">Hämtar kundförfrågningar…</p> : null}
      {loaded && !loading && !leads.length ? <p className="muted">Inga kundförfrågningar har registrerats ännu.</p> : null}
      {leads.length ? <div className="table-scroll"><table className="data-table">
        <caption className="sr-only">Företagets kundförfrågningar</caption>
        <thead><tr><th>Kund / kontakt</th><th>Ärende / anteckning</th><th>Skapad</th><th>Status</th></tr></thead>
        <tbody>{leads.map((lead) => <tr key={lead.id}>
          <td><strong>{lead.customer?.name ?? 'Kontakt saknas'}</strong><span className="cell-subtext">{[lead.customer?.email, lead.customer?.phone].filter(Boolean).join(' · ') || 'Kontaktuppgift saknas'}</span></td>
          <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 420 }}>{lead.subject}</td>
          <td>{new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeZone: 'Europe/Stockholm' }).format(new Date(lead.createdAt))}</td>
          <td>{!demo && canEdit ? <LeadStatusForm key={`${lead.id}:${lead.status}`} lead={lead} disabled={busy} onSave={changeStatus} /> : <span className="badge">{statusLabels[lead.status]}</span>}</td>
        </tr>)}</tbody>
      </table></div> : null}
      {!demo ? <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button className="button button-outline button-small" type="button" disabled={busy} onClick={() => refresh()}>Uppdatera listan</button>
        {cursor ? <button className="button button-outline button-small" type="button" disabled={busy} onClick={() => refresh(true)}>Visa äldre förfrågningar</button> : null}
      </div> : null}
      {!demo && canEdit ? <form onSubmit={createLead} className="workspace-form" style={{ marginTop: 24 }}>
        <h3>Ny kundförfrågan</h3>
        <label htmlFor={`${fieldId}-name`}>Namn<input id={`${fieldId}-name`} name="name" required minLength={2} maxLength={160} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
        <div className="field-pair">
          <label htmlFor={`${fieldId}-email`}>E-post<input id={`${fieldId}-email`} name="email" type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
          <label htmlFor={`${fieldId}-phone`}>Telefon<input id={`${fieldId}-phone`} name="phone" type="tel" maxLength={60} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={busy} /></label>
        </div>
        <p className="small muted">Ange minst e-post eller telefon.</p>
        <label htmlFor={`${fieldId}-subject`}>Ärende / anteckning<textarea id={`${fieldId}-subject`} name="subject" required maxLength={2000} rows={3} value={subject} onChange={(event) => setSubject(event.target.value)} disabled={busy} /></label>
        <button className="button button-green" type="submit" disabled={busy || (!email.trim() && !phone.trim())}>{pending ? 'Sparar…' : 'Spara kundförfrågan'}</button>
      </form> : null}
      {message ? <p className="notice notice-success" role="status">{message}</p> : null}
      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
      {listError ? <p className="notice notice-error" role="alert">{listError}</p> : null}
    </section> : null}
  </details>;
}

function LeadStatusForm({ lead, disabled, onSave }: { lead: LeadSummary; disabled: boolean; onSave: (lead: LeadSummary, status: LeadStatus) => void }) {
  const id = useId();
  const [status, setStatus] = useState(lead.status);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); onSave(lead, status); }
  return <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <label className="sr-only" htmlFor={id}>Status för {lead.customer?.name ?? 'kundförfrågan'}</label>
    <select id={id} value={status} onChange={(event) => setStatus(event.target.value as LeadStatus)} disabled={disabled}>
      {Object.entries(statusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>
    <button type="submit" className="button button-outline button-small" disabled={disabled || status === lead.status}>Spara</button>
  </form>;
}
