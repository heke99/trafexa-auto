'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { importStockAction, reviewStockImportAction, type StockImportResult } from '@/lib/data/import-actions';
import { MAX_IMPORT_BYTES, STOCK_FIELDS, parseStockCsv, suggestStockMapping, validateStockRows, type StockMapping } from '@/lib/data/stock-import.mjs';

const formatMoney = (ore: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(ore / 100);
const vatLabels: Record<string, string> = { standard: 'Vanlig moms', vmb: 'VMB', unknown: 'Ej klassificerad' };
const fuelLabels: Record<string, string> = { petrol: 'Bensin', diesel: 'Diesel', electric: 'El', hybrid: 'Hybrid', other: 'Annat' };
const fieldLabels = Object.fromEntries(STOCK_FIELDS.map((field) => [field.key, field.label]));

type Props = { canImport: boolean; demo?: boolean; companyId?: string; userId?: string; existingRegistrations: string[]; onBusyChange?: (busy: boolean) => void; onCompleted?: () => void; onAccessDenied?: (message: string) => void };
export function StockImport(props: Props) {
  return <ScopedStockImport key={`${props.companyId}:${props.userId}:${props.canImport}:${!!props.demo}`} {...props} />;
}
function ScopedStockImport({ canImport, demo = false, companyId, existingRegistrations, onBusyChange, onCompleted, onAccessDenied }: Props) {
  const id = useId();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(false), sequence = useRef(0), writeLock = useRef(false), uncertain = useRef(false), busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const attempt = useRef<{ csv: string; mapping: string; companyId: string; submissionId: string; count: number } | null>(null);
  const [unknown, setUnknown] = useState(false), [denied, setDenied] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; busyCallback.current?.(false); }; }, []);
  const [submission, setSubmission] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [mapping, setMapping] = useState<StockMapping>({});
  const [fileError, setFileError] = useState('');
  const [reading, setReading] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<StockImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const completed = result?.ok && result.count !== undefined;
  const parsed = useMemo(() => csv ? parseStockCsv(csv) : null, [csv]);
  const checked = useMemo(() => parsed ? validateStockRows(parsed, mapping, completed ? [] : existingRegistrations) : null, [parsed, mapping, existingRegistrations, completed]);
  const issues = [...(checked?.issues ?? []), ...(result?.issues ?? [])].filter((issue, index, all) => all.findIndex((other) => other.row === issue.row && other.field === issue.field && other.message === issue.message) === index);
  const busy = pending || reading;

  function denyImport(message: string) { uncertain.current = false; setUnknown(false); setDenied(true); setCsv(''); setMapping({}); setFilename(''); setReviewed(false); attempt.current = null; onAccessDenied?.(message); }
  function clearReview() { if (writeLock.current || uncertain.current) return; setReviewed(false); setResult(null); setSubmission(null); attempt.current = null; }
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    if (writeLock.current || uncertain.current || denied) return;
    const token = ++sequence.current, file = event.target.files?.[0];
    setCsv(''); setMapping({}); setFilename(''); setFileError(''); setShowAll(false); clearReview();
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { setFileError('CSV-filen får vara högst 1 MB.'); return; }
    setReading(true);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (!alive.current || token !== sequence.current) return;
      const data = parseStockCsv(text);
      setCsv(text); setFilename(file.name); setMapping(suggestStockMapping(data.headers));
      if (!text.trim()) setFileError('Filen är tom.');
    } catch { if (alive.current && token === sequence.current) setFileError('Filen kunde inte läsas som UTF-8. Exportera lagret som en CSV-fil i UTF-8.'); }
    finally { if (alive.current && token === sequence.current) setReading(false); }
  }
  function dataForServer() {
    const form = new FormData();
    form.set('csv', csv); form.set('mapping', JSON.stringify(mapping)); form.set('company_id', companyId ?? '');
    return form;
  }
  function review() {
    if (!checked?.canImport || busy || uncertain.current || denied) return;
    if (demo) { setReviewed(true); setResult({ ok: true, message: 'Förhandsgranskningen är klar. Demoläget sparar inga bilar.' }); return; }
    const token = ++sequence.current;
    startTransition(async () => {
      try {
        const response = await reviewStockImportAction(dataForServer());
        if (!alive.current || token !== sequence.current) return;
        setResult(response); setReviewed(response.ok); if (response.code === 'access_denied') denyImport(response.message);
      } catch { if (alive.current && token === sequence.current) setResult({ ok: false, message: 'Lagret kunde inte kontrolleras. Försök igen.' }); }
    });
  }
  function submit() {
    if (!canImport || demo || denied || !companyId || busy || writeLock.current || completed) return;
    if (!uncertain.current && (!reviewed || !checked?.canImport)) return;
    if (!attempt.current) attempt.current = { csv, mapping: JSON.stringify(mapping), companyId, submissionId: crypto.randomUUID(), count: checked!.rows.length };
    const current = attempt.current;
    setSubmission(current.submissionId);
    const form = new FormData(); form.set('csv', current.csv); form.set('mapping', current.mapping); form.set('company_id', current.companyId); form.set('submission_id', current.submissionId);
    writeLock.current = true; busyCallback.current?.(true); const token = ++sequence.current;
    startTransition(async () => {
      try {
        const response = await importStockAction(form);
        if (!alive.current || token !== sequence.current) return;
        if (response.ok && (!Number.isInteger(response.count) || response.count !== current.count)) throw Error('invalid count');
        setResult(response);
        if (response.ok) { uncertain.current = false; setUnknown(false); attempt.current = null; if (onCompleted) onCompleted(); else router.refresh(); }
        else if (response.code === 'access_denied') denyImport(response.message);
        else if (response.code === 'rejected') { uncertain.current = false; setUnknown(false); setReviewed(false); setSubmission(null); attempt.current = null; }
        else { uncertain.current = true; setUnknown(true); }
      } catch {
        if (alive.current && token === sequence.current) { uncertain.current = true; setUnknown(true); setResult({ ok: false, message: 'Importens resultat kunde inte bekräftas. Kontrollera samma import igen innan du byter fil eller kolumnmappning.' }); }
      } finally { writeLock.current = false; if (alive.current) busyCallback.current?.(uncertain.current); }
    });
  }
  return <details className="surface" style={{ marginBottom: 24 }} onClickCapture={event => { if ((writeLock.current || uncertain.current) && event.target instanceof Element && event.target.closest('summary') === event.currentTarget.querySelector('summary')) event.preventDefault(); }} onToggle={event => { if ((writeLock.current || uncertain.current) && !event.currentTarget.open) event.currentTarget.open = true; }}>
    <summary style={{ padding: 20, cursor: 'pointer', fontWeight: 600 }}><Upload size={16} style={{ display: 'inline', marginRight: 8 }} />Importera lager från CSV</summary>
    <div className="workspace-form" style={{ padding: 20 }}>
      <p className="form-intro">Välj en CSV-fil i UTF-8 med rubrikrad och högst 500 bilar, maximalt 1 MB. Komma och semikolon stöds. Priser anges i kronor och mätarställning i kilometer.</p>
      <p className="settings-note">Inköpspriset och försäljningspriset ska vara totalbelopp inklusive eventuell moms, enligt respektive underlag. Momsmodell måste anges uttryckligen som standard, vmb eller unknown för varje bil. Registreringsnummer som redan finns i företaget eller upprepas i filen måste rättas.</p>
      {demo ? <p className="inline-note">Demoläge: du kan förhandsgranska en fil. Inga bilar sparas.</p> : !canImport ? <p className="inline-note">Din roll kan förhandsgranska importer. En ägare, administratör eller säljare kan spara dem.</p> : null}
      <label htmlFor={`${id}-file`}>Lagerfil<input ref={fileRef} id={`${id}-file`} type="file" accept=".csv,text/csv" disabled={busy || unknown || denied || Boolean(completed)} onChange={chooseFile} /></label>
      {reading ? <p role="status">Läser CSV-filen…</p> : null}
      {fileError ? <p className="notice notice-error" role="alert">{fileError}</p> : null}
      {parsed?.headers.length ? <>
        <p className="small muted">{filename} · {parsed.rows.length} bilar · {parsed.delimiter === ';' ? 'Semikolon' : 'Komma'} som avgränsare</p>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy || unknown || denied || Boolean(completed)}><legend style={{ fontWeight: 600, marginBottom: 16 }}>Koppla filens kolumner</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 16 }}>
            {STOCK_FIELDS.map((field) => <label key={field.key} htmlFor={`${id}-${field.key}`}>{field.label}<select id={`${id}-${field.key}`} value={mapping[field.key] ?? -1} onChange={(event) => { setMapping((previous) => ({ ...previous, [field.key]: Number(event.target.value) })); clearReview(); }}><option value={-1}>Välj kolumn</option>{parsed.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></label>)}
          </div>
        </fieldset>
        {checked?.preview.length ? <div>
          <p className="small muted">Förhandsgranskning av {showAll ? checked.preview.length : Math.min(20, checked.preview.length)} av {checked.preview.length} bilar. CSV-radnumret räknar poster inklusive rubrikraden.</p>
          <div className="table-scroll"><table className="data-table"><caption className="sr-only">Förhandsgranskning av lagerimport</caption><thead><tr><th>Rad</th><th>Reg.nr / bil</th><th>Årsmodell / km</th><th>Drivlina</th><th>Inköpspris</th><th>Försäljningspris</th><th>Momsmodell</th><th>Kontroll</th></tr></thead><tbody>{(showAll ? checked.preview : checked.preview.slice(0, 20)).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td><strong>{row.registration}</strong><span className="cell-subtext">{row.make} {row.model}</span></td><td>{row.values ? <>{row.values.model_year}<span className="cell-subtext">{row.values.mileage_km.toLocaleString('sv-SE')} km</span></> : '—'}</td><td>{row.values ? <>{fuelLabels[row.values.fuel]}<span className="cell-subtext">{row.values.gearbox === 'automatic' ? 'Automat' : 'Manuell'}</span></> : '—'}</td><td className="numeric">{row.values ? formatMoney(row.values.purchase_price_ore) : '—'}</td><td className="numeric">{row.values ? formatMoney(row.values.asking_price_ore) : '—'}</td><td>{row.values ? vatLabels[row.values.vat_scheme] : '—'}</td><td>{issues.some((issue) => issue.row === row.rowNumber) ? 'Behöver rättas' : 'Kontrollerad i filen'}</td></tr>)}</tbody></table></div>
          {checked.preview.length > 20 ? <button type="button" className="button button-outline button-small" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Visa 20 bilar' : 'Visa alla bilar'}</button> : null}
        </div> : null}
        {issues.length ? <div role="alert"><p><strong>{issues.length} uppgifter behöver rättas.</strong> Hela filen måste vara giltig innan importen kan sparas.</p><ul>{issues.map((issue, index) => <li key={index}>{issue.row !== null ? `Rad ${issue.row} · ` : ''}{fieldLabels[issue.field] ? `${fieldLabels[issue.field]}: ` : ''}{issue.message}</li>)}</ul></div> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="button" className="button button-outline" disabled={busy || unknown || denied || !checked?.canImport || Boolean(completed) || Boolean(submission)} onClick={review}>{pending ? 'Kontrollerar…' : demo ? 'Granska filen' : 'Kontrollera mot hela lagret'}</button>
          {!demo && canImport ? <button type="button" className="button button-green" disabled={busy || denied || (!unknown && (!reviewed || !checked?.canImport)) || Boolean(completed)} onClick={submit}>{pending ? 'Bearbetar…' : submission ? 'Bekräfta importen igen' : `Importera ${checked?.rows.length ?? 0} bilar`}</button> : null}
        </div>
      </> : null}
      {result ? <p className={`notice notice-${result.ok ? 'success' : 'error'}`} role={result.ok ? 'status' : 'alert'}>{result.message}</p> : null}
      {completed ? <button type="button" className="button button-outline button-small" onClick={() => { setCsv(''); setMapping({}); setFilename(''); clearReview(); if (fileRef.current) fileRef.current.value = ''; }}>Välj nästa lagerfil</button> : null}
    </div>
  </details>;
}
