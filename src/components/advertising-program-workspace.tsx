'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveAdvertisingProgramRequestAction, resolveAdvertisingProgramRequestAction } from '@/lib/platform-admin/advertising-program-actions';
import { parseProgramIdentity, parseProgramReceipt, parseProgramSave, periodDraft, programDates, programPrices, ProgramValidationError } from '@/lib/advertising-program/validation';
import type { ProgramCompany, ProgramIdentity, ProgramOperation, ProgramPeriod, ProgramReceipt } from '@/lib/advertising-program/validation';
import { useDescendantBusy } from './use-descendant-busy';

const requestPrefix = 'trafexa-program-request:v1:';
type Failure = { code: string; message: string; fields?: Record<string, string> };
type FormProps = { actorId: string; companyId: string; storeId: string | null; period?: ProgramPeriod; operation: ProgramOperation; blocked: boolean; busyRef: { current: boolean }; onBusyChange: (busy: boolean) => void; onDenied: () => void };

function ProgramForm({ actorId, companyId, storeId, period, operation, blocked, busyRef, onBusyChange, onDenied }: FormProps) {
  const router = useRouter();
  const errorId = useId();
  const initial = () => operation === 'store' ? { store_name: '', dealer_code: '' } : operation === 'period' ? periodDraft(period) : {};
  const [values, setValues] = useState<Record<string, string>>(initial), [acknowledged, setAcknowledged] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'unknown' | 'unauthenticated' | 'saved' | 'blocked'>('idle');
  const [message, setMessage] = useState(''), [errors, setErrors] = useState<Record<string, string>>({}), [ready, setReady] = useState(false);
  const [receipt, setReceipt] = useState<ProgramReceipt | null>(null), [pending, startTransition] = useTransition();
  const identity = useRef<ProgramIdentity | null>(null), form = useRef<HTMLFormElement>(null), notice = useRef<HTMLParagraphElement>(null);
  const alive = useRef(true);
  const key = `${requestPrefix}${actorId}:${companyId}:${operation}:${storeId ?? 'new'}:${period?.period_id ?? 'new'}`;
  useEffect(() => {
    alive.current = true;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const restored = parseProgramIdentity(JSON.parse(stored));
        if (restored.operation !== operation || restored.storeId !== storeId || period && restored.periodId !== period.period_id) throw Error('Changed request target');
        identity.current = restored; setPhase('unknown'); setMessage('En tidigare sparning behöver kontrolleras innan du gör en ny ändring.');
      }
    } catch { setPhase('blocked'); setMessage('Webbläsaren kunde inte återställa sparningsbegäran. Kontakta info@trafexa.com innan du gör en ny ändring.'); }
    setReady(true);
    return () => { alive.current = false; };
  }, [key, operation, storeId, period?.period_id]);
  function clearIdentity() { try { sessionStorage.removeItem(key); } catch { /* A leftover opaque ID can only re-read the same guarded result. */ } identity.current = null; }
  function showFailure(result: Failure) {
    setErrors(result.fields ?? {}); setMessage(result.message);
    if (result.code === 'access_denied') { onDenied(); return; }
    if (result.code === 'unavailable') setPhase('unknown');
    else if (result.code === 'unauthenticated') setPhase('unauthenticated');
    else {
      // A definite validation/CAS response proves this attempt did not commit.
      clearIdentity(); setPhase(result.code === 'conflict' ? 'blocked' : 'idle');
    }
    requestAnimationFrame(() => {
      const first = Object.keys(result.fields ?? {})[0];
      const input = first ? form.current?.elements.namedItem(first) : null;
      if (input instanceof HTMLElement) input.focus(); else notice.current?.focus();
    });
  }
  function saved(value: unknown, submitted: ProgramIdentity) {
    const verified = parseProgramReceipt(value, { ...submitted, actorId, companyId });
    clearIdentity(); setReceipt(verified); setPhase('saved'); setErrors({}); setMessage('Sparningen är verifierad. Aktuellt underlag läses in.');
    router.refresh(); requestAnimationFrame(() => notice.current?.focus());
  }
  function submit() {
    if (!ready || busyRef.current || phase !== 'idle') return;
    let submitted: ProgramIdentity;
    try {
      submitted = parseProgramIdentity({ requestId: crypto.randomUUID(), operation, storeId, periodId: operation === 'store' ? null : period?.period_id ?? crypto.randomUUID(), expectedVersion: period?.version ?? 0 });
      const input = { ...submitted, actorId, companyId, fields: values, acknowledged: operation === 'cancel' ? acknowledged : true };
      parseProgramSave(input);
      // Only opaque identifiers/target metadata survive refresh, never values.
      sessionStorage.setItem(key, JSON.stringify(submitted)); identity.current = submitted;
    } catch (error) {
      if (error instanceof ProgramValidationError) showFailure({ code: 'invalid_input', message: error.message, fields: error.fields });
      else { setPhase('blocked'); setMessage('Sparningen kunde inte förberedas i webbläsaren. Ingen ändring skickades.'); }
      return;
    }
    const input = { ...submitted, actorId, companyId, fields: { ...values }, acknowledged: operation === 'cancel' ? acknowledged : true };
    onBusyChange(true); setMessage(''); setErrors({});
    startTransition(async () => {
      try {
        const result = await saveAdvertisingProgramRequestAction(input);
        if (!alive.current) return;
        if (!result.ok) showFailure(result); else saved(result.receipt, submitted);
      } catch { if (alive.current) showFailure({ code: 'unavailable', message: 'Svaret saknas. Kontrollera samma sparning innan du fortsätter.' }); }
      finally { onBusyChange(false); }
    });
  }
  function resolve() {
    const submitted = identity.current;
    if (!submitted || busyRef.current) return;
    onBusyChange(true); setMessage('Kontrollerar den tidigare sparningen…');
    startTransition(async () => {
      try {
        const result = await resolveAdvertisingProgramRequestAction({ actorId, companyId, identity: submitted });
        if (!alive.current) return;
        if (!result.ok) showFailure(result);
        else if (result.state === 'saved') saved(result.receipt, submitted);
        else { clearIdentity(); setPhase('idle'); setMessage('Den tidigare begäran sparades inte och är säkert avslutad. Dina värden är kvar; granska dem och försök igen.'); }
      } catch { if (alive.current) showFailure({ code: 'unavailable', message: 'Kontrollen kunde inte slutföras. Försök kontrollera samma sparning igen.' }); }
      finally { onBusyChange(false); }
    });
  }
  const disabled = !ready || blocked || pending || phase !== 'idle';
  const field = (name: string, label: string, extra: { type?: string; maxLength?: number; required?: boolean; inputMode?: 'decimal' } = {}) => <div key={name}><label>{label}<input {...extra} name={name} value={values[name] ?? ''} aria-invalid={errors[name] ? true : undefined} aria-describedby={errors[name] ? `${errorId}-${name}` : undefined} onChange={event => { setValues(old => ({ ...old, [name]: event.target.value })); setErrors(old => ({ ...old, [name]: '' })); }}/></label>{errors[name] && <p id={`${errorId}-${name}`} className="form-error">{errors[name]}</p>}</div>;
  return <form method="post" className="workspace-form" ref={form} aria-busy={pending} onSubmit={event => { event.preventDefault(); submit(); }}>
    {message && <p ref={notice} tabIndex={-1} role={phase === 'saved' ? 'status' : 'alert'} className={phase === 'saved' ? 'notice' : 'form-error'}>{message}</p>}
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 16 }}>
      {operation === 'store' ? <>{field('store_name', 'Butiksnamn', { required: true, maxLength: 160 })}{field('dealer_code', 'Butikens dealer_code', { required: true, maxLength: 160 })}</> : operation === 'cancel' ? <label style={{ flexDirection: 'row', alignItems: 'flex-start' }}><input style={{ width: 'auto' }} name="acknowledged" type="checkbox" required checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/> Jag vill avbryta den väntande avtalsperioden</label> : <>
        {field('agreement_reference', 'Avtalsreferens', { required: true, maxLength: 300 })}
        {Object.entries(programDates).map(([name, label]) => field(name, label, { type: 'date', required: name === 'desired_start' }))}
        {Object.entries(programPrices).map(([name, label]) => field(name, `${label} (kr exkl. moms)`, { inputMode: 'decimal', maxLength: 20 }))}
        <label>Avgift för delmånad<select name="partial_month_rule" value={values.partial_month_rule} onChange={event => setValues(old => ({ ...old, partial_month_rule: event.target.value }))}><option value="">Ej beslutad</option><option value="full">Hel avgift</option><option value="prorated">Proportionerad avgift</option></select></label>
      </>}
      <button type="submit" className={operation === 'cancel' ? 'button button-outline' : 'button button-green'}>{pending ? 'Verifierar sparning…' : operation === 'store' ? 'Registrera butik' : operation === 'cancel' ? 'Avbryt väntande period' : 'Spara avtalsperiod'}</button>
    </fieldset>
    {pending && !message && <p role="status">Sparningen och kvittot kontrolleras. Vänta tills resultatet är känt.</p>}
    {phase === 'unauthenticated' && <a className="text-link" target="_blank" rel="noopener noreferrer" href={`/login?${new URLSearchParams({ next: `/admin/annonsprogram/${companyId}` })}`}>Logga in i en ny flik och behåll formuläret här</a>}
    {(phase === 'unknown' || phase === 'unauthenticated') && <button type="button" className="button button-outline" disabled={blocked || pending} onClick={resolve}>Kontrollera tidigare sparning</button>}
    {phase === 'blocked' && <button type="button" className="text-link" disabled={blocked || pending} onClick={() => router.refresh()}>Läs in aktuellt underlag</button>}
    {phase === 'saved' && operation !== 'cancel' && (operation === 'store' || !period || period.version === receipt?.version) && <button type="button" className="text-link" disabled={blocked || pending} onClick={() => { setValues(initial()); setPhase('idle'); setMessage(''); setReceipt(null); }}>Gör en ny ändring</button>}
  </form>;
}

export function AdvertisingProgramWorkspace({ company, actorId }: { company: ProgramCompany; actorId: string }) {
  return <ProgramWorkspace key={`${actorId}:${company.companyId}`} company={company} actorId={actorId}/>;
}
function ProgramWorkspace({ company, actorId }: { company: ProgramCompany; actorId: string }) {
  const operation = useDescendantBusy();
  const [denied, setDenied] = useState(false);
  function deny() {
    try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const key = sessionStorage.key(i); if (key?.startsWith(`${requestPrefix}${actorId}:`)) sessionStorage.removeItem(key); } } catch { /* No stored values or credentials exist in this namespace. */ }
    setDenied(true);
  }
  if (denied) return <main className="surface"><h1>Annonsprogrammet är inte längre tillgängligt.</h1><p role="alert">Din aktuella administratörsåtkomst kunde inte verifieras. Uppgifterna har dolts.</p><a href={`/login?${new URLSearchParams({ next: `/admin/annonsprogram/${company.companyId}` })}`}>Kontrollera din inloggning</a></main>;
  const common = { actorId, companyId: company.companyId, blocked: operation.busy, busyRef: operation.busyRef, onBusyChange: operation.report, onDenied: deny };
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());
  return <main className="surface dialog-content" style={{ overflowWrap: 'anywhere', maxWidth: 1000, margin: '24px auto', display: 'grid', gap: 20 }}>
    <a role="link" aria-disabled={operation.busy} tabIndex={operation.busy ? -1 : undefined} href={operation.busy ? undefined : '/admin'} onClick={event => { if (operation.busyRef.current) event.preventDefault(); }}>Tillbaka till superadmin</a>
    <h1>Annonsprogram · {company.name}</h1><p>{company.organisationNumber} · Trafexa Nordic AB tar emot Blockets faktura enligt bekräftad avtalsperiod.</p>
    <p>Här sparas avtalsunderlag och priser inför publicering och fakturering.</p>
    <details><summary>Registrera befintlig Blocketbutik</summary><ProgramForm {...common} operation="store" storeId={null}/></details>
    {company.stores.map(store => <section key={store.id}>
      <h2 style={{ marginBottom: 12 }}>{store.store_name} · {store.dealer_code}</h2>
      {store.periods.map(period => <details key={period.period_id}>
        <summary>{period.desired_start} · {period.cancelled ? 'Avbruten' : period.contract_end && period.contract_end <= today ? 'Avslutad' : !period.confirmed_start ? 'Väntar på Blocket' : period.confirmed_start > today || period.desired_start && period.desired_start > today ? 'Planerad' : 'Aktiv'} · version {period.version}{period.contract_end ? ` · avtal upphör ${period.contract_end}` : ''}</summary>
        {period.contract_end && period.confirmed_end !== period.contract_end && <p role="status">Fakturabytet behöver stämmas av med Blocket.</p>}
        {!period.cancelled && <ProgramForm key={`edit:${period.version}`} {...common} operation="period" storeId={store.id} period={period}/>}
        {!period.cancelled && !period.confirmed_start && <ProgramForm key={`cancel:${period.version}`} {...common} operation="cancel" storeId={store.id} period={period}/>}
      </details>)}
      <details><summary>Ny avtalsperiod</summary><ProgramForm {...common} operation="period" storeId={store.id}/></details>
    </section>)}
  </main>;
}
