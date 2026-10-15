'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight } from 'lucide-react';
import { createDealAction } from '@/lib/data/actions';
import { searchDealOptions } from '@/lib/data/register-actions';
import { formatOre } from '@/lib/calculations/vehicle-calculation';
import type { Customer, InventoryItem, WorkspaceSnapshot } from '@/lib/data/workspace';
import type { DealOptionsKind, DealOptionsPage } from '@/lib/registers/types';

type Option = Customer | InventoryItem;
type PickerProps = {
  kind: DealOptionsKind; companyId: string; actorId: string; role: string; demo: boolean;
  demoRows: Option[]; selected: Option | null;
  onSelect: (row: Option | null) => void; onReadyChange: (ready: boolean) => void;
};
const isCustomer = (row: Option): row is Customer => 'name' in row;
const isInventory = (row: Option): row is InventoryItem => 'vehicles' in row;
function inputPrice(ore: number): string {
  if (!Number.isSafeInteger(ore) || ore < 0) return '';
  const amount = BigInt(ore);
  return `${amount / BigInt(100)}.${(amount % BigInt(100)).toString().padStart(2, '0')}`;
}
function optionLabel(row: Option): string {
  if (isCustomer(row)) return [row.name, row.email || row.phone].filter(Boolean).join(' · ');
  const price = Number.isSafeInteger(row.asking_price_ore) && row.asking_price_ore >= 0 ? formatOre(String(row.asking_price_ore)) : 'Pris behöver verifieras';
  return `${row.vehicles.make} ${row.vehicles.model} · ${row.vehicles.registration_number} · ${price}`;
}

function DealOptionPicker({ kind, companyId, actorId, role, demo, demoRows, selected, onSelect, onReadyChange }: PickerProps) {
  const fieldId = useId();
  const { pending } = useFormStatus();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [page, setPage] = useState<DealOptionsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectionNotice, setSelectionNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);
  const selectedId = selected?.id ?? null;
  const customer = kind === 'customers';

  useEffect(() => {
    const sequence = ++request.current;
    let cancelled = false;
    setLoading(true); setError(''); onReadyChange(false);
    function receive(next: DealOptionsPage) {
      if (cancelled || sequence !== request.current) return;
      if (next.kind !== kind || next.companyId.toLowerCase() !== companyId.toLowerCase() || next.actorId.toLowerCase() !== actorId.toLowerCase() || next.role !== role) {
        setPage(null); setError('Företagskontot eller din behörighet har ändrats. Öppna affärsformuläret igen.'); return;
      }
      setPage(next);
      if (selectedId && (!next.selected || next.selected.id !== selectedId)) {
        onSelect(null);
        setSelectionNotice(kind === 'inventory' ? 'Den valda bilen är inte längre tillgänglig. Välj en annan bil.' : 'Den valda kunden kunde inte verifieras. Välj kund igen.');
        return;
      }
      if (next.selected) onSelect(next.selected);
      onReadyChange(true);
    }
    const timer = setTimeout(async () => {
      try {
        if (demo) {
          const customers = demoRows.filter(isCustomer);
          const inventory = demoRows.filter(isInventory).filter((row) => row.status === 'available');
          const all = customer ? customers : inventory;
          const matches = all.filter((row) => optionLabel(row).toLocaleLowerCase('sv-SE').includes(query.trim().toLocaleLowerCase('sv-SE')));
          const offset = cursor ? Number(cursor.slice('demo:'.length)) : 0;
          const common = { companyId, actorId, totalCount: all.length, filteredCount: matches.length, nextCursor: offset + 50 < matches.length ? `demo:${offset + 50}` : null };
          // Demo preserves the displayed role while making no server calls.
          const demoRole = ['owner', 'admin', 'sales', 'finance', 'viewer'].find((value) => value === role) ?? 'viewer';
          if (demoRole !== 'owner' && demoRole !== 'admin' && demoRole !== 'sales' && demoRole !== 'finance' && demoRole !== 'viewer') return;
          const next: DealOptionsPage = customer
            ? { ...common, role: demoRole, kind: 'customers', rows: matches.filter(isCustomer).slice(offset, offset + 50), selected: customers.find((row) => row.id === selectedId) ?? null }
            : { ...common, role: demoRole, kind: 'inventory', rows: matches.filter(isInventory).slice(offset, offset + 50), selected: inventory.find((row) => row.id === selectedId) ?? null };
          receive(next);
        } else {
          const result = await searchDealOptions({ kind, expectedCompanyId: companyId, query, cursor, selectedId });
          if (cancelled || sequence !== request.current) return;
          if (!result.ok) { setError(result.error); return; }
          receive(result.page);
        }
      } catch { if (!cancelled && sequence === request.current) setError('Valen kunde inte hämtas. Försök igen.'); }
      finally { if (!cancelled && sequence === request.current) setLoading(false); }
    }, query && !demo ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [kind, companyId, actorId, role, demo, demoRows, query, cursor, selectedId, refresh, customer, onSelect, onReadyChange]);

  const rows: Option[] = page?.rows ?? [];
  const options = selected && !rows.some((row) => row.id === selected.id) ? [selected, ...rows] : rows;
  const changePage = (next: string | null, previous = false) => {
    request.current++; setLoading(true); onReadyChange(false);
    setHistory((current) => previous ? current.slice(0, -1) : [...current, cursor]); setCursor(next);
  };
  return <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <label htmlFor={`${fieldId}-query`}>{customer ? 'Sök kund' : 'Sök tillgänglig bil'}
      <input id={`${fieldId}-query`} type="search" value={query} maxLength={120} placeholder={customer ? 'Namn, e-post eller telefon' : 'Märke, modell eller registreringsnummer'} disabled={pending} onChange={(event) => {
        request.current++; setLoading(true); onReadyChange(false); setQuery(event.target.value); setCursor(null); setHistory([]);
      }} />
    </label>
    <label htmlFor={`${fieldId}-select`} style={{ marginTop: 12 }}>{customer ? 'Kund' : 'Bil'}
      <select id={`${fieldId}-select`} name={customer ? 'customer_id' : 'stock_item_id'} required value={selectedId ?? ''} disabled={pending || loading || Boolean(error)} aria-describedby={`${fieldId}-status`} onChange={(event) => {
        request.current++; onReadyChange(false); setSelectionNotice('');
        onSelect(options.find((row) => row.id === event.target.value) ?? null);
      }}>
        <option value="" disabled>{customer ? 'Välj kund' : 'Välj tillgänglig bil'}</option>
        {options.map((row) => <option key={row.id} value={row.id}>{optionLabel(row)}</option>)}
      </select>
    </label>
    <p id={`${fieldId}-status`} className="form-privacy" aria-live="polite" style={{ marginTop: 8 }}>
      {loading ? 'Hämtar val…' : error ? 'Valen kunde inte verifieras.' : page ? `${page.filteredCount} ${customer ? 'kunder' : 'tillgängliga bilar'} matchar · ${page.totalCount} ${customer ? 'i kundregistret' : 'tillgängliga bilar i företaget'}. Visar högst 50 per sida.` : ''}
    </p>
    {!!page?.filteredCount && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      <button className="button button-outline button-small" type="button" disabled={pending || loading || !history.length} onClick={() => changePage(history.at(-1) ?? null, true)}>Föregående {customer ? 'kunder' : 'bilar'}</button>
      <button className="button button-outline button-small" type="button" disabled={pending || loading || !page.nextCursor} onClick={() => changePage(page.nextCursor)}>Nästa {customer ? 'kunder' : 'bilar'}</button>
    </div>}
    {!loading && !error && page?.filteredCount === 0 && <p className="form-privacy">{query ? 'Inga val matchar sökningen.' : customer ? 'Lägg till en kund innan du skapar affären.' : 'Det finns inga tillgängliga bilar att välja.'}</p>}
    {selectionNotice && <p role="alert">{selectionNotice}</p>}
    {error && <div style={{ marginTop: 8 }}><p role="alert">{error}</p><button type="button" className="button button-outline button-small" disabled={pending || loading} onClick={() => setRefresh((current) => current + 1)}>Försök igen med {customer ? 'kunder' : 'bilar'}</button></div>}
  </fieldset>;
}

function SubmitDeal({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="button button-green" disabled={disabled || pending}>{pending ? 'Sparar…' : 'Skapa affär'} <ArrowRight size={17} /></button>;
}

function ScopedDealForm({ snapshot, demo }: { snapshot: WorkspaceSnapshot; demo: boolean }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [stock, setStock] = useState<InventoryItem | null>(null);
  const [price, setPrice] = useState('');
  const [customerReady, setCustomerReady] = useState(false);
  const [stockReady, setStockReady] = useState(false);
  const previousStock = useRef<string | null>(null);
  const selectCustomer = useCallback((row: Option | null) => setCustomer(row && isCustomer(row) ? row : null), []);
  const selectStock = useCallback((row: Option | null) => {
    const next = row && isInventory(row) ? row : null;
    if (next?.id !== previousStock.current) setPrice(next ? inputPrice(next.asking_price_ore) : '');
    previousStock.current = next?.id ?? null; setStock(next);
  }, []);
  const companyId = snapshot.organization?.id ?? '';
  const scope = { companyId, actorId: snapshot.user.id, role: snapshot.membership?.role ?? 'viewer', demo };
  return <form action={demo ? undefined : createDealAction} className="workspace-form" onSubmit={(event) => {
    if (demo || !customer || !stock || !customerReady || !stockReady) event.preventDefault();
  }}>
    <p className="form-intro">Koppla ihop en kund och en tillgänglig bil. Affären sparas som utkast.</p>
    {demo && <p className="form-privacy">Demonstration i läsläge. Sök och välj bland exempeluppgifterna. Ingen affär sparas.</p>}
    <DealOptionPicker {...scope} kind="customers" demoRows={snapshot.customers} selected={customer} onSelect={selectCustomer} onReadyChange={setCustomerReady} />
    <DealOptionPicker {...scope} kind="inventory" demoRows={snapshot.inventory} selected={stock} onSelect={selectStock} onReadyChange={setStockReady} />
    <label>Totalpris, kr inklusive eventuell moms<input name="sale_price" type="text" inputMode="decimal" maxLength={24} required value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Till exempel 199000,29" /></label>
    <SubmitDeal disabled={demo || !customer || !stock || !customerReady || !stockReady || !price} />
  </form>;
}

/** Remount every picker when the displayed company, actor, role or mode changes. */
export function DealForm({ snapshot, demo = false }: { snapshot: WorkspaceSnapshot; demo?: boolean }) {
  if (!snapshot.organization || (!demo && !['owner', 'admin', 'sales'].includes(snapshot.membership?.role ?? ''))) return <p role="status">Du har inte behörighet att skapa en affär i det aktiva företaget.</p>;
  const scope = `${snapshot.organization.id}:${snapshot.user.id}:${snapshot.membership?.role ?? 'viewer'}:${demo}`;
  return <ScopedDealForm key={scope} snapshot={snapshot} demo={demo} />;
}
