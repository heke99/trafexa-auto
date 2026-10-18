'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { loadDealerRegisterPage } from '@/lib/data/register-actions';
import type { Customer, InventoryItem, WorkspaceSnapshot } from '@/lib/data/workspace';
import type { DealerRegisterDeal, DealerRegisterKind, DealerRegisterPage, DealerRegisterRole, DealerRegisterSort } from '@/lib/registers/types';

export type DealerRegistersProps = {
  kind: DealerRegisterKind;
  companyId: string;
  userId: string;
  role: string;
  demo?: boolean;
  snapshot: WorkspaceSnapshot;
  renderRows: (page: DealerRegisterPage) => ReactNode;
  onCriteriaChange?: () => void;
  onPage?: (page: DealerRegisterPage) => void;
};

const filters: Record<DealerRegisterKind, [string, string][]> = {
  inventory: [['all', 'Alla bilar'], ['available', 'Tillgängliga'], ['reserved', 'Reserverade'], ['sold', 'Sålda'], ['archived', 'Arkiverade']],
  customers: [['all', 'Alla kunder'], ['person', 'Privatpersoner'], ['business', 'Företag']],
  deals: [['all', 'Alla affärer'], ['draft', 'Utkast'], ['reserved', 'Reservationer'], ['cancelled', 'Avbrutna'], ['completed', 'Levererade']],
};
const nouns = { inventory: 'bilar', customers: 'kunder', deals: 'affärer' };
const placeholders = { inventory: 'Sök bil eller reg.nr', customers: 'Sök namn, mejl eller telefon', deals: 'Sök kund, bil eller reg.nr' };
const count = (value: number | undefined) => value === undefined ? '—' : new Intl.NumberFormat('sv-SE').format(value);
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv-SE');

function demoPage(props: DealerRegistersProps, query: string, status: string, sort: DealerRegisterSort, cursor: string | null): DealerRegisterPage {
  const offset = cursor?.startsWith('demo:') ? Number(cursor.slice(5)) : 0;
  const scope = { companyId: props.companyId, actorId: props.userId, role: props.role as DealerRegisterRole };
  const search = normalize(query);
  function select<T>(rows: T[], getStatus: (row: T) => string, getText: (row: T) => string, getPrice?: (row: T) => number) {
    const counts: Record<string, number> = { all: rows.length };
    for (const row of rows) counts[getStatus(row)] = (counts[getStatus(row)] ?? 0) + 1;
    const selected = rows.filter(row => (status === 'all' || getStatus(row) === status) && normalize(getText(row)).includes(search));
    if (sort !== 'recent' && getPrice) selected.sort((a, b) => (getPrice(a) - getPrice(b)) * (sort === 'price_desc' ? -1 : 1));
    const pageRows = selected.slice(offset, offset + 50);
    return { rows: pageRows, totalCount: rows.length, filteredCount: selected.length, counts, nextCursor: offset + 50 < selected.length ? `demo:${offset + 50}` : null };
  }
  if (props.kind === 'inventory') return { ...scope, kind: 'inventory', ...select<InventoryItem>(props.snapshot.inventory, row => row.status, row => `${row.vehicles.registration_number} ${row.vehicles.make} ${row.vehicles.model}`, row => row.asking_price_ore) };
  if (props.kind === 'customers') return { ...scope, kind: 'customers', ...select<Customer>(props.snapshot.customers, row => row.kind, row => `${row.name} ${row.email ?? ''} ${row.phone ?? ''}`) };
  const deals: DealerRegisterDeal[] = props.snapshot.deals.flatMap(deal => {
    const customer = props.snapshot.customers.find(row => row.id === deal.customer_id);
    const stockItem = props.snapshot.inventory.find(row => row.id === deal.stock_item_id);
    return customer && stockItem ? [{ ...deal, customer, stockItem }] : [];
  });
  return { ...scope, kind: 'deals', ...select(deals, row => row.status, row => `${row.customer.name} ${row.customer.email ?? ''} ${row.stockItem.vehicles.registration_number} ${row.stockItem.vehicles.make} ${row.stockItem.vehicles.model}`, row => row.sale_price_ore) };
}

export function DealerRegisters(props: DealerRegistersProps) {
  return <RegisterPanel key={`${props.companyId}:${props.userId}:${props.role}:${props.kind}:${!!props.demo}`} {...props} />;
}

function RegisterPanel(props: DealerRegistersProps) {
  const { kind, companyId, userId, role, demo = false, snapshot, renderRows, onCriteriaChange, onPage } = props;
  const prefix = useId();
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<DealerRegisterSort>('recent');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [position, setPosition] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; page: DealerRegisterPage | null; error: string; loading: boolean } | null>(null);
  const [, startRead] = useTransition();
  const sequence = useRef(0);
  const currentCursor = cursors[position] ?? null;
  const readKey = JSON.stringify([kind, companyId, userId, role, query, status, sort, currentCursor]);
  const localPage = demo ? demoPage(props, query, status, sort, currentCursor) : null;
  const current = state?.key === readKey ? state : null;
  const page = localPage ?? (current && !current.error ? current.page : null);
  const error = demo ? '' : current?.error ?? '';
  const loading = !demo && (!current || current.loading);

  useEffect(() => {
    if (demo) return;
    const token = ++sequence.current;
    let cancelled = false;
    // Same-scope refreshes keep row modules mounted so unsaved offer/retry state survives RSC updates.
    setState(previous => ({ key: readKey, page: previous?.key === readKey ? previous.page : null, error: '', loading: true }));
    startRead(async () => {
      try {
        const result = await loadDealerRegisterPage({ kind, expectedCompanyId: companyId, query, status, sort, cursor: currentCursor });
        if (cancelled || token !== sequence.current) return;
        if (!result.ok) { onCriteriaChange?.(); setState({ key: readKey, page: null, error: result.error, loading: false }); return; }
        if (result.page.kind !== kind || result.page.companyId.toLowerCase() !== companyId.toLowerCase() || result.page.actorId.toLowerCase() !== userId.toLowerCase() || result.page.role !== role) {
          onCriteriaChange?.(); setState({ key: readKey, page: null, error: 'Företaget eller behörigheten har ändrats. Läs in sidan igen för att fortsätta.', loading: false }); return;
        }
        onPage?.(result.page);
        setState({ key: readKey, page: result.page, error: '', loading: false });
      } catch {
        if (!cancelled && token === sequence.current) { onCriteriaChange?.(); setState({ key: readKey, page: null, error: 'Registret kunde inte hämtas. Försök igen.', loading: false }); }
      }
    });
    return () => { cancelled = true; sequence.current++; };
  }, [readKey, retry, snapshot, demo, kind, companyId, userId, role, query, status, sort, currentCursor, onCriteriaChange, onPage]);

  function resetPage() { setCursors([null]); setPosition(0); onCriteriaChange?.(); }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); resetPage(); setQuery(draftQuery.trim()); setRetry(value => value + 1); }
  function next() {
    if (!page?.nextCursor || loading) return;
    onCriteriaChange?.(); setCursors(current => [...current.slice(0, position + 1), page.nextCursor]); setPosition(value => value + 1);
  }
  function previous() { if (position > 0 && !loading) { onCriteriaChange?.(); setPosition(value => value - 1); } }
  function refresh() { onCriteriaChange?.(); setRetry(value => value + 1); }
  function clearCriteria() { setDraftQuery(''); setQuery(''); setStatus('all'); resetPage(); setRetry(value => value + 1); }
  const canCreate = !demo && (kind === 'inventory' ? ['owner', 'admin'] : ['owner', 'admin', 'sales']).includes(role);
  const firstRecordGuidance = canCreate ? {
    inventory: 'Använd ”Lägg till bil” ovan för att registrera företagets första bil.',
    customers: 'Använd ”Lägg till kund” ovan för att registrera företagets första kund.',
    deals: 'Registrera en kund och en tillgänglig bil. Använd sedan ”Ny affär” ovan.',
  }[kind] : demo ? 'Demonstrationen är i läsläge och använder endast fiktiva exempeldata.' : 'Registret fylls när en behörig medarbetare registrerar företagets uppgifter.';

  return <section className="surface" aria-label={`${kind === 'inventory' ? 'Fordons' : kind === 'customers' ? 'Kund' : 'Affärs'}register`} aria-busy={loading}>
    <div className="table-toolbar" style={{ alignItems: 'flex-end' }}>
      <form onSubmit={search} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, minWidth: 0, flex: 1 }}>
        <label className="search-field" style={{ flex: 1, minWidth: 150 }}><Search size={16}/><span className="sr-only">{placeholders[kind]}</span><input type="search" maxLength={120} value={draftQuery} onChange={event => setDraftQuery(event.target.value)} placeholder={placeholders[kind]}/></label>
        <button type="submit" className="button button-outline button-small">Sök</button>
      </form>
      <div className="table-controls" style={{ flexWrap: 'wrap', minWidth: 0 }}>
        <label htmlFor={`${prefix}-status`} className="sr-only">{kind === 'inventory' ? 'Lagerstatus' : kind === 'customers' ? 'Kundtyp' : 'Affärsstatus'}</label>
        <select id={`${prefix}-status`} className="compact-select" value={status} onChange={event => { resetPage(); setStatus(event.target.value); }}>
          {filters[kind].map(([value, text]) => <option key={value} value={value}>{text} ({count(page ? page.counts[value] ?? 0 : undefined)})</option>)}
        </select>
        <label htmlFor={`${prefix}-sort`} className="sr-only">Sortera {nouns[kind]}</label>
        <select id={`${prefix}-sort`} className="compact-select" value={sort} onChange={event => { resetPage(); setSort(event.target.value as DealerRegisterSort); }}>
          <option value="recent">Senast tillagda</option>
          {kind !== 'customers' ? <><option value="price_asc">Lägsta pris</option><option value="price_desc">Högsta pris</option></> : null}
        </select>
      </div>
    </div>
    {demo ? <p className="settings-note">Demonstration · sökning och sidvisning använder endast fiktiva exempeldata.</p> : null}
    {loading ? <p className="quiet-empty" role="status">Hämtar {nouns[kind]} från hela registret…</p> : null}
    {error ? <div className="quiet-empty"><p role="alert">{error}</p><button type="button" className="button button-outline button-small" onClick={refresh}>Försök igen</button>{position > 0 ? <button type="button" className="button button-outline button-small" onClick={() => { resetPage(); setRetry(value => value + 1); }}>Till första sidan</button> : null}</div> : null}
    {page ? page.rows.length ? renderRows(page) : !loading ? <div className="empty-state"><h3>{position > 0 && page.filteredCount > 0 ? 'Sidan är tom efter en ändring i registret.' : page.totalCount === 0 ? `Inga ${nouns[kind]} har registrerats ännu.` : `Inga ${nouns[kind]} matchar sökningen eller filtret.`}</h3><p>{position > 0 && page.filteredCount > 0 ? 'Gå till föregående sida eller uppdatera registret.' : page.totalCount === 0 ? firstRecordGuidance : 'Ändra sökningen eller välj ett annat filter.'}</p>{page.totalCount > 0 && page.filteredCount === 0 ? <button type="button" className="button button-outline button-small" onClick={clearCriteria}>Visa alla {nouns[kind]}</button> : null}</div> : null : null}
    <div className="table-footer" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <span>{page ? `Visar ${count(page.rows.length)} av ${count(page.filteredCount)} träffar · ${count(page.totalCount)} ${nouns[kind]} totalt` : 'Antalet visas när registret har verifierats.'}</span>
      <nav aria-label="Registersidor" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="button button-outline button-small" disabled={loading || position === 0} onClick={previous}>Tidigare</button>
        <span>Sida {position + 1}</span>
        <button type="button" className="button button-outline button-small" disabled={loading || !page?.nextCursor} onClick={next}>Nästa</button>
        <button type="button" className="text-link" disabled={loading} onClick={refresh}>Uppdatera</button>
      </nav>
    </div>
  </section>;
}
