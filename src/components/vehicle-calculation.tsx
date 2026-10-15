'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { InventoryItem, VehicleCost } from '@/lib/data/workspace';
import { getVehicleCalculationAction, saveVehicleCalculationMetadataAction } from '@/lib/data/calculation-actions';
import { calculateVehicle, formatOre, kronorToOre, type VehicleCalculationSource } from '@/lib/calculations/vehicle-calculation';

const VMB_SOURCE = 'https://www.skatteverket.se/foretag/moms/sarskildamomsregler/vinstmarginalbeskattningavbegagnadevarormedmera.4.58d555751259e4d6616800010756.html';
const NORMAL_SOURCE = 'https://www.skatteverket.se/foretagorganisationer/moms/sarskildareglerforvissavarortjanster/bilarmoms.4.58d555751259e4d6616800010628.html';
function kronor(ore: string | null) { if (ore === null) return ''; const value = BigInt(ore); return `${value / 100n},${(value % 100n).toString().padStart(2, '0')}`; }
function demoOre(value: number | null) { if (value === null || !Number.isSafeInteger(value) || value < 0) throw new Error(); return String(value); }

export function VehicleCalculation({ item, costs, canEdit, demo }: { item: InventoryItem; costs: VehicleCost[]; canEdit: boolean; demo: boolean }) {
  const fieldId = useId();
  const [source, setSource] = useState<VehicleCalculationSource | null>(null);
  const [purchaseVat, setPurchaseVat] = useState('');
  const [costVat, setCostVat] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  // Snapshot numbers only invalidate reads. They never feed a live calculation.
  const basis = JSON.stringify([item.id, item.asking_price_ore, item.purchase_price_ore, item.vat_scheme, costs.map(cost => [cost.id, cost.amount_ore, cost.description])]);
  function accept(next: VehicleCalculationSource) {
    setSource(next); setPurchaseVat(kronor(next.purchaseVatOre)); setConfirmed(next.vatBasisConfirmed);
    setCostVat(Object.fromEntries(next.costs.map(cost => [cost.id, kronor(cost.deductibleVatOre)])));
  }
  async function load(scope: number) {
    setLoading(true); setSource(null); setError(''); setNotice('');
    try {
      if (demo) {
        const next: VehicleCalculationSource = { companyId: '00000000-0000-4000-8000-000000000001', stockItemId: item.id, version: '1', purchaseGrossOre: demoOre(item.purchase_price_ore), saleGrossOre: demoOre(item.asking_price_ore), vatScheme: 'unknown', purchaseVatOre: null, vatBasisConfirmed: false,
          costs: costs.map(cost => ({ id: cost.id, description: cost.description, grossOre: demoOre(cost.amount_ore), deductibleVatOre: null })) };
        if (generation.current === scope) accept(next);
      } else {
        const result = await getVehicleCalculationAction({ stockItemId: item.id });
        if (generation.current !== scope) return;
        if (!result.ok || result.source.stockItemId !== item.id) { setError(result.ok ? 'Kalkylen hör till ett annat lagerobjekt.' : result.message); return; }
        accept(result.source);
      }
    } catch { if (generation.current === scope) setError('Kalkylen kunde inte verifieras. Läs in underlaget igen.'); }
    finally { if (generation.current === scope) setLoading(false); }
  }
  // Fresh snapshot objects also trigger verification when their numeric fields
  // have rounded two different bigint prices to the same JavaScript number.
  useEffect(() => { const scope = ++generation.current; void load(scope); return () => { ++generation.current; }; }, [basis, demo, item, costs]);
  const calculation = source ? calculateVehicle(source) : null;
  function save() {
    if (!source || !canEdit || demo || pending || loading) return;
    const current = source, scope = generation.current;
    let payload;
    try { payload = { stockItemId: current.stockItemId, companyId: current.companyId, expectedVersion: current.version,
      purchaseVatOre: current.vatScheme === 'vmb' ? null : kronorToOre(purchaseVat), vatBasisConfirmed: current.vatScheme === 'vmb' && confirmed,
      costVat: current.costs.map(cost => ({ costId: cost.id, deductibleVatOre: kronorToOre(costVat[cost.id] ?? '') })) }; }
    catch { setError('Ange avdragsgill moms i kronor med högst två decimaler, eller lämna fältet tomt om underlag saknas.'); return; }
    startTransition(async () => {
      setError(''); setNotice('');
      try {
        const result = await saveVehicleCalculationMetadataAction(payload);
        if (generation.current !== scope) return;
        if (!result.ok) { setError(result.message); if (result.conflict) setSource(null); return; }
        if (result.source.companyId !== current.companyId || result.source.stockItemId !== current.stockItemId) { setError('Det sparade underlaget kunde inte verifieras.'); return; }
        accept(result.source); setNotice('Momsunderlaget har sparats för aktuell kalkyl.');
      } catch { if (generation.current === scope) setError('Sparandet kunde inte verifieras. Läs in aktuellt underlag igen.'); }
    });
  }
  return <section aria-labelledby={`${fieldId}-heading`} className="vehicle-costs" style={{ marginTop: 24 }}>
    <h3 id={`${fieldId}-heading`}>Fordonskalkyl</h3>
    <p className="muted">Inköp, försäljningspris och kostnader är registrerade totalbelopp inklusive eventuell moms. Momsavdrag används endast från uttryckligt sparat underlag.</p>
    {loading && <p role="status">Hämtar exakt kalkylunderlag…</p>}
    {calculation && source && <>
      <dl className="detail-list"><div><dt>Inköp inklusive moms</dt><dd>{formatOre(source.purchaseGrossOre)}</dd></div><div><dt>Försäljningspris inklusive moms</dt><dd>{formatOre(source.saleGrossOre)}</dd></div><div><dt>Kostnader inklusive moms</dt><dd>{formatOre(calculation.costGrossOre)}</dd></div><div><dt>Skillnad före momshantering</dt><dd>{formatOre(calculation.grossDifferenceOre)}</dd></div>
      {calculation.outputVatOre !== null && <div><dt>{source.vatScheme === 'vmb' ? 'Beräknad moms på positiv VMB-marginal' : 'Utgående moms, 25 %'}</dt><dd>{formatOre(calculation.outputVatOre)}</dd></div>}
      {calculation.netResultOre !== null && <div><dt>Kalkylresultat efter moms</dt><dd>{formatOre(calculation.netResultOre)}</dd></div>}</dl>
      <p className="muted">Skillnaden före momshantering = försäljningspris − inköp − kostnader, alla inklusive moms.</p>
      {calculation.netResultOre === null && <p role="status">Resultat efter moms visas när momsmodellen och avdragsunderlagen har bekräftats. Tomma avdragsfält betyder att underlag saknas; 0 betyder bekräftat utan avdrag.</p>}
      {source.vatScheme === 'vmb' && <p className="muted">Individuell VMB räknas på positiv skillnad mellan försäljningspris och fordonsinköp. Reparationer och andra kostnader minskar inte VMB-marginalen.</p>}
      {!demo && canEdit && source.vatScheme !== 'unknown' && <form className="workspace-form" onSubmit={event => { event.preventDefault(); save(); }}>
        {source.vatScheme === 'standard' && <label>Avdragsgill inköpsmoms enligt underlag, kr<input type="text" inputMode="decimal" value={purchaseVat} disabled={pending} onChange={event => setPurchaseVat(event.target.value)} maxLength={24}/></label>}
        {source.vatScheme === 'vmb' && <label style={{ flexDirection: 'row' }}><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} style={{ width: 'auto' }}/><span>Jag har underlag som bekräftar att individuell VMB får användas för detta fordon.</span></label>}
        {source.costs.map(cost => <label key={cost.id}>Avdragsgill moms för {cost.description}, kr<input type="text" inputMode="decimal" maxLength={24} value={costVat[cost.id] ?? ''} disabled={pending} onChange={event => setCostVat(previous => ({ ...previous, [cost.id]: event.target.value }))}/></label>)}
        <button className="button button-outline" disabled={pending} type="submit">{pending ? 'Sparar…' : 'Spara momsunderlag'}</button>
      </form>}
      {source.vatScheme === 'unknown' && <p className="muted">Momsmodellen behöver klassificeras innan resultat efter moms kan beräknas.</p>}
    </>}
    {!demo && <button className="text-link" type="button" disabled={pending || loading} onClick={() => { void load(++generation.current); }}>Läs in kalkylen igen</button>}
    {demo && <p className="muted">Demonstration i läsläge. Ingen moms har antagits för exempelunderlaget.</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <p className="muted"><a href={VMB_SOURCE} target="_blank" rel="noreferrer">Skatteverkets regler för VMB</a> · <a href={NORMAL_SOURCE} target="_blank" rel="noreferrer">Bilar och moms</a></p>
  </section>;
}
