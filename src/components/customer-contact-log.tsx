'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createCustomerContactAction, listCustomerContactsAction, listCustomerFollowUpsAction, updateCustomerFollowUpAction } from '@/lib/data/customer-contact-actions';
import type { CustomerContact } from '@/lib/crm/types';

export type CustomerContactLogProps = { companyId: string; customerId: string; userId: string; canEdit: boolean; demo?: boolean; onAccessDenied?: () => void; onBusyChange?: (busy: boolean) => void; onChanged?: () => void };
export type CompanyFollowupsProps = { companyId: string; userId: string; canEdit: boolean; demo?: boolean; onSelectCustomer?: (customer: { id: string; name: string }) => void; refreshToken?: number };
const kinds = { call: 'Telefon', email: 'E-post', meeting: 'Möte', note: 'Anteckning' };
const dates = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' });
function displayDate(value: string) { return dates.format(new Date(`${value}T12:00:00Z`)); }

export function CustomerContactLog(props: CustomerContactLogProps) {
  return <ContactPanel key={`${props.companyId}:${props.customerId}:${props.userId}:${props.canEdit}:${!!props.demo}`} {...props} />;
}

function ContactPanel({ companyId, customerId, canEdit, demo = false, onAccessDenied, onBusyChange, onChanged }: CustomerContactLogProps) {
  const prefix = useId();
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState<'create' | 'update' | null>(null);
  const uncertain = useRef<'create' | 'update' | null>(null), busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [kind, setKind] = useState<keyof typeof kinds>('call');
  const [contactOn, setContactOn] = useState('');
  const [summary, setSummary] = useState('');
  const [followUpOn, setFollowUpOn] = useState('');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<{ contact: CustomerContact; status: 'done' | 'cancelled' } | null>(null);
  const alive = useRef(false);
  const writeLock = useRef(false);
  const createPayload = useRef<Omit<Parameters<typeof createCustomerContactAction>[0], 'requestId'> | null>(null);
  const updatePayload = useRef<Omit<Parameters<typeof updateCustomerFollowUpAction>[0], 'requestId'> | null>(null);
  const retries = useRef(new Map<string, string>());
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const sequence = useRef(0);
  function deny() { createPayload.current = null; updatePayload.current = null; uncertain.current = null; setUnknown(null); setContacts([]); setCursor(null); setBlocked(true); setReview(null); setSummary(''); retries.current.clear(); onAccessDenied?.(); }
  async function load(older = false): Promise<boolean> {
    const token = ++sequence.current;
    setLoading(true);
    try {
      const result = await listCustomerContactsAction({ companyId, customerId, ...(older && cursor ? { pageKey: cursor } : {}) });
      if (!alive.current || token !== sequence.current) return false;
      if (!result.ok) { setContacts([]); setCursor(null); setReview(null); setBlocked(true); if (result.code === 'access_denied' || result.code === 'unauthenticated') deny(); setError(result.message); return false; }
      setBlocked(false); setError(''); setToday(result.businessDate); setContactOn(current => current || result.businessDate);
      setContacts(current => older ? [...current, ...result.contacts].filter((row, index, all) => all.findIndex(other => other.id === row.id) === index) : result.contacts);
      setCursor(result.nextPageKey);
      return true;
    } catch { if (alive.current && token === sequence.current) { setContacts([]); setCursor(null); setBlocked(true); setReview(null); setError('Kontaktloggen kunde inte hämtas. Försök igen.'); } return false; }
    finally { if (alive.current && token === sequence.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; if (!demo) void load(); return () => { alive.current = false; sequence.current++; busyCallback.current?.(false); }; }, []); // Component key isolates every access scope.
  useEffect(() => { if (review) reviewHeading.current?.focus(); }, [review]);
  function requestId(fingerprint: string) {
    let id = retries.current.get(fingerprint);
    if (!id) { id = crypto.randomUUID(); retries.current.set(fingerprint, id); }
    return id;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo || !canEdit || blocked || uncertain.current === 'update' || writeLock.current || !event.currentTarget.reportValidity()) return;
    const values = createPayload.current ?? { companyId, customerId, kind, contactOn, summary: summary.trim(), followUpOn: followUpOn || null };
    createPayload.current = values;
    const id = requestId(JSON.stringify(values));
    writeLock.current = true; setBusy(true); busyCallback.current?.(true); setError(''); setMessage('');
    try {
      const result = await createCustomerContactAction({ ...values, requestId: id });
      if (!alive.current) return;
      if (!result.ok) { uncertain.current = result.code === 'unavailable' ? 'create' : null; if (!uncertain.current) createPayload.current = null; setUnknown(uncertain.current); setError(result.message); if (result.code === 'access_denied' || result.code === 'unauthenticated') deny(); return; }
      if (result.contact.companyId !== companyId || result.contact.customerId !== customerId) throw Error('invalid contact receipt');
      createPayload.current = null; uncertain.current = null; setUnknown(null); onChanged?.(); retries.current.delete(JSON.stringify(values)); setSummary(''); setFollowUpOn(''); setMessage('Kontakten är sparad.'); await load();
    } catch { if (alive.current) { uncertain.current = 'create'; setUnknown('create'); setError('Sparandet kunde inte bekräftas. Kontrollera samma uppgifter igen innan du lämnar kunden.'); } }
    finally { writeLock.current = false; if (alive.current) { setBusy(false); busyCallback.current?.(uncertain.current !== null); } }
  }
  async function confirm() {
    if (uncertain.current === 'create' || !review || reason.trim().length < 2 || /[\r\n]/.test(reason) || demo || !canEdit || blocked || writeLock.current) return;
    const values = updatePayload.current ?? { companyId, customerId, contactId: review.contact.id, expectedVersion: review.contact.version, status: review.status, reason: reason.trim() };
    updatePayload.current = values;
    const id = requestId(JSON.stringify(values));
    writeLock.current = true; setBusy(true); busyCallback.current?.(true); setError(''); setMessage('');
    try {
      const result = await updateCustomerFollowUpAction({ ...values, requestId: id });
      if (!alive.current) return;
      if (!result.ok) {
        uncertain.current = result.code === 'unavailable' ? 'update' : null; if (!uncertain.current) updatePayload.current = null; setUnknown(uncertain.current); setError(result.message);
        if (result.code === 'access_denied' || result.code === 'unauthenticated') deny();
        if (result.code === 'conflict') {
          setReview(null);
          const refreshed = await load();
          if (refreshed && alive.current) setError(result.message);
        }
        return;
      }
      if (result.contact.companyId !== companyId || result.contact.customerId !== customerId || result.contact.id !== values.contactId) throw Error('invalid followup receipt');
      updatePayload.current = null; uncertain.current = null; setUnknown(null); onChanged?.(); retries.current.delete(JSON.stringify(values)); setReview(null); setMessage('Uppföljningen är uppdaterad.'); await load();
    } catch { if (alive.current) { uncertain.current = 'update'; setUnknown('update'); setError('Ändringen kunde inte bekräftas. Kontrollera samma granskade uppföljning igen innan du lämnar kunden.'); } }
    finally { writeLock.current = false; if (alive.current) { setBusy(false); busyCallback.current?.(uncertain.current !== null); } }
  }
  return <section aria-labelledby={`${prefix}-title`} style={{ marginTop: 24, minWidth: 0 }}>
    <h3 id={`${prefix}-title`}>Kontaktlogg och uppföljning</h3>
    <p className="muted">Registrera genomförda kontakter och planera nästa uppföljning. Uppföljningarna visas i systemet.</p>
    {demo ? <p className="inline-note">Demoläge · kontakter sparas i ett inloggat företagskonto.</p> : null}
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    {loading ? <p role="status">Hämtar kontaktloggen…</p> : null}
    {!demo && canEdit && !blocked && today ? <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <label htmlFor={`${prefix}-kind`}>Kontakttyp</label><select id={`${prefix}-kind`} value={kind} onChange={event => setKind(event.target.value as keyof typeof kinds)} disabled={busy || unknown !== null}><option value="call">Telefon</option><option value="email">E-post</option><option value="meeting">Möte</option><option value="note">Anteckning</option></select>
      <label htmlFor={`${prefix}-date`}>Kontaktdatum</label><input id={`${prefix}-date`} type="date" required max={today} value={contactOn} onChange={event => setContactOn(event.target.value)} disabled={busy || unknown !== null} />
      <label htmlFor={`${prefix}-summary`}>Sammanfattning</label><textarea id={`${prefix}-summary`} required minLength={2} maxLength={2000} rows={3} value={summary} onChange={event => setSummary(event.target.value)} disabled={busy || unknown !== null} />
      <label htmlFor={`${prefix}-follow`}>Uppföljningsdatum (valfritt)</label><input id={`${prefix}-follow`} type="date" min={contactOn || undefined} value={followUpOn} onChange={event => setFollowUpOn(event.target.value)} disabled={busy || unknown !== null} />
      <button className="button button-green" disabled={busy || loading || unknown === 'update'}>Spara kontakt</button>
    </form> : null}
    {!loading && !contacts.length ? <p className="muted">Inga kontakter att visa.</p> : null}
    <ol style={{ paddingLeft: 20 }}>{contacts.map(contact => <li key={contact.id} style={{ marginBlock: 18, overflowWrap: 'anywhere' }}>
      <strong>{kinds[contact.kind]} · {displayDate(contact.contactOn)}</strong><span className="muted"> · {contact.actorLabel}</span><p style={{ whiteSpace: 'pre-wrap' }}>{contact.summary}</p>
      {contact.followUpOn ? <p>Uppföljning: {displayDate(contact.followUpOn)} · {contact.followUpStatus === 'pending' ? 'Planerad' : contact.followUpStatus === 'done' ? 'Klar' : 'Avbruten'}</p> : null}
      {contact.followUpOn && contact.followUpStatus === 'pending' && canEdit && !demo && !blocked ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button type="button" className="button button-outline" disabled={busy || unknown !== null} onClick={() => { setReason(''); setReview({ contact, status: 'done' }); }}>Markera klar</button><button type="button" className="button button-outline" disabled={busy || unknown !== null} onClick={() => { setReason(''); setReview({ contact, status: 'cancelled' }); }}>Avbryt uppföljning</button></div> : null}
    </li>)}</ol>
    {review ? <div className="inline-note" role="region" aria-label="Granska uppföljningen"><h4 ref={reviewHeading} tabIndex={-1}>Granska uppföljningen</h4><p>{review.contact.summary}</p><p>{review.status === 'done' ? 'Markera denna uppföljning som klar?' : 'Avbryt denna uppföljning?'}</p><label htmlFor={`${prefix}-reason`}>Anledning till ändringen</label><input id={`${prefix}-reason`} required minLength={2} maxLength={500} value={reason} disabled={busy || unknown !== null} onChange={event => setReason(event.target.value)} /><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button className="button button-green" disabled={busy || unknown === 'create' || reason.trim().length < 2} onClick={() => void confirm()}>Bekräfta {review.status === 'done' ? 'klar' : 'avbrott'}</button><button className="button button-outline" disabled={busy || unknown !== null} onClick={() => setReview(null)}>Tillbaka</button></div></div> : null}
    {!demo ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button type="button" className="button button-outline" disabled={busy || loading || unknown !== null} onClick={() => void load()}>Uppdatera kontaktloggen</button>{cursor && !blocked ? <button className="button button-outline" disabled={busy || loading || unknown !== null} onClick={() => void load(true)}>Visa äldre kontakter</button> : null}</div> : null}
  </section>;
}

export function CompanyFollowups(props: CompanyFollowupsProps) {
  return <FollowupPanel key={`${props.companyId}:${props.userId}:${props.canEdit}:${!!props.demo}`} {...props} />;
}
function FollowupPanel({ companyId, demo = false, onSelectCustomer, refreshToken }: CompanyFollowupsProps) {
  const [filter, setFilter] = useState<'due' | 'upcoming' | 'all'>('due');
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!demo);
  const alive = useRef(false), sequence = useRef(0);
  async function load(older = false) {
    const token = ++sequence.current; setLoading(true);
    try {
      const result = await listCustomerFollowUpsAction({ companyId, filter, ...(older && cursor ? { pageKey: cursor } : {}) });
      if (!alive.current || token !== sequence.current) return;
      if (!result.ok) { setContacts([]); setCursor(null); setError(result.message); return; }
      setError(''); setDate(result.businessDate); setCursor(result.nextPageKey);
      setContacts(current => older ? [...current, ...result.contacts].filter((row, index, all) => all.findIndex(other => other.id === row.id) === index) : result.contacts);
    } catch { if (alive.current && token === sequence.current) { setContacts([]); setCursor(null); setError('Uppföljningarna kunde inte hämtas.'); } }
    finally { if (alive.current && token === sequence.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; setContacts([]); setCursor(null); if (!demo) void load(); return () => { alive.current = false; sequence.current++; }; }, [filter, refreshToken]);
  return <section className="surface" style={{ padding: 20, marginTop: 24 }}><h3>Kunduppföljningar</h3><p className="muted">Planerade uppföljningar för hela företaget{date ? ` · idag ${displayDate(date)} (Stockholm)` : ''}.</p>
    {demo ? <p className="inline-note">Demoläge · uppföljningar visas för ditt inloggade företagskonto.</p> : <label>Visa uppföljningar <select value={filter} disabled={loading} onChange={event => setFilter(event.target.value as typeof filter)}><option value="due">Förfallna och idag</option><option value="upcoming">Kommande</option><option value="all">Alla planerade</option></select></label>}
    {error ? <p role="alert">{error}</p> : null}{loading ? <p role="status">Hämtar uppföljningar…</p> : null}
    <ul style={{ paddingLeft: 20 }}>{contacts.map(contact => <li key={contact.id} style={{ marginBlock: 16, overflowWrap: 'anywhere' }}><strong>{contact.customerName} · {contact.followUpOn ? displayDate(contact.followUpOn) : ''}</strong><p>{contact.summary}</p>{onSelectCustomer ? <button className="button button-outline" onClick={() => onSelectCustomer({ id: contact.customerId, name: contact.customerName || 'Kund' })}>Öppna kund</button> : null}</li>)}</ul>
    {!loading && !contacts.length ? <p className="muted">Inga uppföljningar att visa.</p> : null}
    {!demo ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button className="button button-outline" disabled={loading} onClick={() => void load()}>Uppdatera uppföljningar</button>{cursor ? <button className="button button-outline" disabled={loading} onClick={() => void load(true)}>Visa fler uppföljningar</button> : null}</div> : null}
  </section>;
}
