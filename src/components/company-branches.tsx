'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { listCompanyBranchesAction, saveCompanyBranchAction, setCompanyBranchStatusAction } from '@/lib/company-branches/actions';
import type { BranchFields, BranchPage, BranchStatus, CompanyBranch, SaveBranchInput, SetBranchStatusInput } from '@/lib/company-branches/types';

type Props = { companyId: string; userId: string; role: string; demo?: boolean };
type Review = { kind: 'save'; input: Omit<SaveBranchInput, 'acknowledged' | 'requestId'> } | { kind: 'status'; input: Omit<SetBranchStatusInput, 'acknowledged' | 'requestId'> };
const blank = (): BranchFields => ({ code: '', name: '', addressLine1: '', postalCode: '', city: '', publicEmail: null, publicPhone: null });
const textValid = (s: string, min: number, max: number) => [...s].length >= min && [...s].length <= max && s === s.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(s);
function valid(f: BranchFields) {
  const digits = f.publicPhone?.replace(/\D/g, '') ?? '';
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(f.code) && textValid(f.name, 2, 120) && textValid(f.addressLine1, 2, 160) && /^\d{5}$/.test(f.postalCode) && textValid(f.city, 2, 100) && (f.publicEmail === null || textValid(f.publicEmail, 3, 254) && f.publicEmail === f.publicEmail.toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.publicEmail)) && (f.publicPhone === null || textValid(f.publicPhone, 7, 40) && /^\+?[0-9 ()-]+$/.test(f.publicPhone) && digits.length >= 7 && digits.length <= 15);
}
export function CompanyBranches(props: Props) { return <BranchesPanel key={`${props.companyId}:${props.userId}:${props.role}:${!!props.demo}`} {...props}/>; }
function BranchesPanel({ companyId, userId, role, demo = false }: Props) {
  const [open, setOpen] = useState(false), [status, setStatus] = useState<BranchStatus>('active');
  const [page, setPage] = useState<BranchPage | null>(null), [fields, setFields] = useState<BranchFields>(blank), [editing, setEditing] = useState<CompanyBranch | null>(null), [formOpen, setFormOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null), [statusTarget, setStatusTarget] = useState<CompanyBranch | null>(null), [reason, setReason] = useState(''), [ack, setAck] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  const alive = useRef(true), serial = useRef(0), lock = useRef(false), nonces = useRef(new Map<string, string>()), newId = useRef<string | null>(null), heading = useRef<HTMLHeadingElement>(null), id = useId();
  const allowed = ['owner', 'admin'].includes(role) && !denied && !demo;
  useEffect(() => { alive.current = true; return () => { alive.current = false; serial.current++; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);
  function clearForm() { setFormOpen(false); setEditing(null); setFields(blank()); setStatusTarget(null); setReason(''); setReview(null); setAck(false); newId.current = null; }
  function fail(r: { code: string; message: string }) {
    setError(r.message);
    if (['access_denied', 'unauthenticated'].includes(r.code)) { setDenied(true); setPage(null); clearForm(); nonces.current.clear(); }
    if (r.code === 'conflict') { setPage(null); clearForm(); setNotice('Läs in aktuell lista och granska ändringen på nytt.'); }
  }
  async function read(token: number, filter: BranchStatus, append = false, previous: BranchPage | null = null) {
    const r = await listCompanyBranchesAction({ companyId, status: filter, pageKey: append ? previous?.nextPageKey ?? null : null, limit: 50 });
    if (!alive.current || serial.current !== token) return false;
    if (!r.ok) { setPage(null); fail(r); return false; }
    if (r.companyId !== companyId || r.actorUserId !== userId || !['owner', 'admin'].includes(r.actorRole) || r.status !== filter) { fail({ code: 'access_denied', message: 'Filialernas aktuella åtkomst kunde inte verifieras.' }); return false; }
    setPage(append && previous ? { ...r, branches: [...previous.branches, ...r.branches.filter(b => !previous.branches.some(old => old.id === b.id))] } : r);
    return true;
  }
  async function load(filter = status, append = false) {
    if (!allowed || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); clearForm(); setStatus(filter); const token = ++serial.current;
    try { await read(token, filter, append, page); } catch { if (alive.current && serial.current === token) { setPage(null); setError('Filialregistret kunde inte verifieras. Läs in på nytt.'); } }
    finally { if (alive.current && serial.current === token) { lock.current = false; setBusy(false); } }
  }
  function startReview(r: Review) { setReview(r); setAck(false); setError(''); setNotice(''); }
  async function save() {
    if (!allowed || lock.current || !ack || !review) return;
    const selected = review, payload = { ...selected.input, acknowledged: true as const }, fingerprint = JSON.stringify({ kind: selected.kind, ...payload });
    if (!nonces.current.has(fingerprint)) nonces.current.set(fingerprint, crypto.randomUUID());
    const requestId = nonces.current.get(fingerprint)!, token = ++serial.current;
    lock.current = true; setBusy(true); setError(''); setNotice(''); let received = false;
    try {
      const r = selected.kind === 'save' ? await saveCompanyBranchAction({ ...selected.input, acknowledged: true, requestId }) : await setCompanyBranchStatusAction({ ...selected.input, acknowledged: true, requestId });
      if (!alive.current || serial.current !== token) return;
      if (!r.ok) { fail(r); return; }
      if (r.receipt.companyId !== companyId || r.receipt.actorUserId !== userId || r.receipt.requestId !== requestId || r.receipt.branch.id !== selected.input.branchId) { setPage(null); clearForm(); setError('Kvittot kunde inte verifieras. Läs in aktuell lista.'); return; }
      received = true; setPage(null); clearForm();
      if (await read(token, status) && alive.current && serial.current === token) setNotice('Åtgärden är registrerad. Den aktuella listan har lästs in på nytt.');
    } catch { if (alive.current && serial.current === token) { if (received) { setPage(null); setError('Åtgärden är registrerad, men aktuell lista kunde inte verifieras. Uppdatera filialerna.'); } else setError('Resultatet är okänt. Försök igen med samma granskning och begäran.'); } }
    finally { if (alive.current && serial.current === token) { lock.current = false; setBusy(false); } }
  }
  if (!['owner', 'admin'].includes(role)) return null;
  if (demo) return <section className="surface" style={{ marginTop: 24, padding: 20 }}><h2>Filialregister</h2><p>Filialer är kontaktadresser under samma juridiska företag. Registret ändras inte i demo.</p></section>;
  return <section className="surface" aria-label="Filialregister" style={{ marginTop: 24, padding: 20, overflowWrap: 'anywhere' }}>
    <div className="panel-heading"><h2>Filialregister</h2><button type="button" className="button button-outline" aria-expanded={open} disabled={busy || denied} onClick={() => { if (open) { setOpen(false); setPage(null); clearForm(); } else { setOpen(true); void load(); } }}>{open ? 'Stäng filialregister' : 'Öppna filialregister'}</button></div>
    <p>Kontaktadresser under samma juridiska företag. Filialerna har inte egna organisationsnummer, behörigheter, lager eller annonsörsanslutningar.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">Verifierar filialregistret…</p>}
    {open && !denied && <><div className="table-controls" style={{ flexWrap: 'wrap' }}><button type="button" className="text-link" disabled={busy} onClick={() => void load()}>Uppdatera filialer</button><label htmlFor={`${id}-filter`}>Visa filialer</label><select id={`${id}-filter`} disabled={busy} value={status} onChange={e => void load(e.target.value as BranchStatus)}><option value="active">Aktiva</option><option value="archived">Arkiverade</option></select></div>
      {page && <><p><strong>{page.legalName}</strong> · Organisationsnummer {page.organisationNumber}</p>{!page.branches.length && <p>Inga {status === 'active' ? 'aktiva' : 'arkiverade'} filialer.</p>}{page.branches.map(branch => <article key={branch.id} style={{ paddingBlock: 14, borderBottom: '1px solid var(--line)' }}><h3>{branch.fields.name}</h3><p>Filialkod: {branch.fields.code}</p><p>{branch.fields.addressLine1}, {branch.fields.postalCode} {branch.fields.city}</p>{branch.fields.publicEmail && <p>{branch.fields.publicEmail}</p>}{branch.fields.publicPhone && <p>{branch.fields.publicPhone}</p>}<div className="table-controls" style={{ flexWrap: 'wrap' }}>{branch.status === 'active' && <button type="button" className="text-link" disabled={busy} onClick={() => { clearForm(); setEditing(branch); setFields({ ...branch.fields }); setFormOpen(true); }}>Redigera filial<span className="sr-only"> {branch.fields.name}</span></button>}<button type="button" className="text-link" disabled={busy} onClick={() => { clearForm(); setStatusTarget(branch); }}>{branch.status === 'active' ? 'Arkivera filial' : 'Återaktivera filial'}<span className="sr-only"> {branch.fields.name}</span></button></div></article>)}{page.nextPageKey && <button type="button" className="text-link" disabled={busy} onClick={() => void load(status, true)}>Läs in fler filialer</button>}<button type="button" className="button button-green" disabled={busy} onClick={() => { clearForm(); newId.current = crypto.randomUUID(); setFormOpen(true); }}>Ny filial</button></>}
      {formOpen && !review && <form className="workspace-form" onSubmit={e => { e.preventDefault(); if (valid(fields) && (newId.current !== null || editing)) startReview({ kind: 'save', input: { companyId, branchId: editing?.id ?? newId.current!, expectedVersion: editing?.version ?? 0, fields: { ...fields } } }); }}><h3>{editing ? 'Redigera filial' : 'Skapa filial'}</h3>{([['name', 'Filialnamn', 120], ['code', 'Filialkod', 24], ['addressLine1', 'Gatuadress', 160], ['postalCode', 'Postnummer (5 siffror)', 5], ['city', 'Ort', 100], ['publicEmail', 'Offentlig e-post (valfri)', 254], ['publicPhone', 'Offentligt telefonnummer (valfritt)', 40]] as const).map(([key, label, max]) => <label key={key} htmlFor={`${id}-${key}`}>{label}<input id={`${id}-${key}`} required={key !== 'publicEmail' && key !== 'publicPhone'} maxLength={max} disabled={busy} value={fields[key] ?? ''} onChange={e => setFields(old => ({ ...old, [key]: e.target.value || (key === 'publicEmail' || key === 'publicPhone' ? null : '') }))}/></label>)}<p>Filialkod: små bokstäver, siffror och bindestreck. Offentlig e-post anges med små bokstäver.</p><button className="button button-green" disabled={busy || !valid(fields)}>Granska filialuppgifter</button></form>}
      {statusTarget && !review && <form className="workspace-form" onSubmit={e => { e.preventDefault(); if (textValid(reason.trim(), 2, 500)) startReview({ kind: 'status', input: { companyId, branchId: statusTarget.id, expectedVersion: statusTarget.version, status: statusTarget.status === 'active' ? 'archived' : 'active', reason: reason.trim() } }); }}><h3>{statusTarget.status === 'active' ? 'Arkivera' : 'Återaktivera'} {statusTarget.fields.name}</h3><label htmlFor={`${id}-reason`}>Motivering<input id={`${id}-reason`} value={reason} required maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)}/></label><button className="button button-outline" disabled={busy || !textValid(reason.trim(), 2, 500)}>Granska statusändring</button></form>}
      {review && <section aria-labelledby={`${id}-review`}><h3 id={`${id}-review`} tabIndex={-1} ref={heading}>Bekräfta filialändring</h3>{review.kind === 'save' ? <dl>{Object.entries(review.input.fields).map(([key,value]) => <div key={key}><dt>{{name:'Filialnamn',code:'Filialkod',addressLine1:'Gatuadress',postalCode:'Postnummer',city:'Ort',publicEmail:'Offentlig e-post',publicPhone:'Offentligt telefonnummer'}[key]}</dt><dd>{value ?? 'Ingen uppgift'}</dd></div>)}</dl> : <><p>{statusTarget?.fields.name}: {review.input.status === 'archived' ? 'Arkiveras' : 'Återaktiveras'}</p><p>Motivering: {review.input.reason}</p></>}<p>Endast företagets filialregister ändras. Företagets juridiska identitet, behörigheter, lager och annonsörsanslutningar påverkas inte.</p><label><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)}/>Jag har granskat och bekräftar filialändringen.</label><div className="table-controls" style={{ flexWrap: 'wrap' }}><button type="button" className="button button-green" disabled={busy || !ack} onClick={() => void save()}>Bekräfta filialändringen</button><button type="button" className="text-link" disabled={busy} onClick={() => { setReview(null); setAck(false); }}>Tillbaka till uppgifter</button></div></section>}
    </>}
  </section>;
}
