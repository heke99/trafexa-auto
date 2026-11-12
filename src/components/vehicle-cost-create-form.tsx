'use client';

import { useState } from 'react';
import { createVehicleCostRequestAction } from '@/lib/data/vehicle-cost-actions';
import type { VehicleCostCreateInput, VehicleCostCreateReceipt } from '@/lib/data/vehicle-cost-create-types';
import { normalizeCreateMoney, normalizeCreateText, useCreateRequest } from './use-create-request';

type Props = { companyId: string; stockItemId: string; userId: string; role: string; demo?: boolean; disabled?: boolean; onCreated: () => void; onDenied?: () => void };
const labels = { repair: 'Reparation / rekond', transport: 'Transport', inspection: 'Besiktning', finance: 'Finanskostnad', other: 'Övrigt' };
function initialFields() { return { category: 'repair' as VehicleCostCreateInput['category'], description: '', amount: '', incurredOn: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date()) }; }

export function VehicleCostCreateForm(props: Props) {
  if (!['owner', 'admin'].includes(props.role)) return null;
  return <ScopedCostForm key={`${props.companyId}:${props.userId}:${props.role}:${props.stockItemId}:${!!props.demo}`} {...props}/>;
}
function ScopedCostForm({ companyId, stockItemId, userId, demo = false, disabled = false, onCreated, onDenied }: Props) {
  const [fields, setFields] = useState(initialFields), [reviewedConflict, setReviewedConflict] = useState(false);
  const request = useCreateRequest<Omit<VehicleCostCreateInput, 'requestId'>>({ companyId, actorId: userId, kind: 'vehicle_cost', action: createVehicleCostRequestAction,
    receiptMatches: (value, input) => { const receipt = value as VehicleCostCreateReceipt, [whole, fraction = ''] = input.amount.replace(',', '.').split('.'); const amountOre = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString(); return receipt.stockItemId === input.stockItemId && receipt.category === input.category && receipt.description === input.description && receipt.amountOre === amountOre && receipt.incurredOn === input.incurredOn; },
    onSuccess: () => { setFields(initialFields()); onCreated(); }, onDenied: () => { setFields(initialFields()); onDenied?.(); },
  });
  const unknown = request.state.status === 'unknown';
  const blocked = demo || disabled || request.pending || request.denied || request.conflicted || unknown;
  const change = (key: keyof typeof fields, value: string) => { request.edit(); setFields(current => ({ ...current, [key]: value })); };
  if (request.denied) return <p role="alert" className="quiet-empty">{request.state.message}</p>;
  return <form method="post" aria-label="Registrera kostnad på bilen" className="workspace-form" style={{ padding: 20, borderTop: '1px solid #e8edde' }} onSubmit={event => {
    event.preventDefault(); if (blocked) return;
    void request.submit({ companyId, stockItemId, category: fields.category, description: normalizeCreateText(fields.description), amount: normalizeCreateMoney(fields.amount), incurredOn: fields.incurredOn });
  }}>
    <input type="hidden" name="expected_company_id" value={companyId}/><input type="hidden" name="stock_item_id" value={stockItemId}/>
    {request.state.message ? <p role={request.state.status === 'success' ? 'status' : 'alert'}>{request.state.message}</p> : null}
    {unknown ? <><p>Samma kostnadsuppgifter och begäran bevaras tills resultatet har kontrollerats.</p><button type="button" className="button button-outline" onClick={request.retry}>Kontrollera samma kostnadsregistrering</button></> : null}
    {request.conflicted ? <section aria-label="Kontrollera tidigare kostnadsregistrering"><label><input type="checkbox" checked={reviewedConflict} onChange={event => setReviewedConflict(event.target.checked)}/>Jag har kontrollerat tidigare kostnader och vill förbereda en ny registrering.</label><button type="button" className="button button-outline" disabled={!reviewedConflict} onClick={() => { if (request.restartConflict()) setReviewedConflict(false); }}>Förbered ny kostnadsregistrering</button></section> : null}
    {demo ? <p className="form-privacy">Demonstration i läsläge. Ingen kostnad registreras.</p> : null}
    <label>Kostnadstyp<select name="category" required value={fields.category} disabled={blocked} onChange={event => change('category', event.target.value)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Beskrivning<input name="description" required maxLength={500} placeholder="Till exempel service och rekond" value={fields.description} disabled={blocked} onChange={event => change('description', event.target.value)}/></label>
    <div className="field-pair"><label>Totalbelopp inklusive eventuell moms, kr<input name="amount" type="number" required min="0" max="9999999999.99" step="0.01" value={fields.amount} disabled={blocked} onChange={event => change('amount', event.target.value)}/></label><label>Kostnadsdatum<input name="incurred_on" type="date" required min="0001-01-01" max="9999-12-31" value={fields.incurredOn} disabled={blocked} onChange={event => change('incurredOn', event.target.value)}/></label></div>
    <button type="submit" className="button button-outline button-small" disabled={blocked}>{request.pending ? 'Sparar…' : 'Registrera kostnad'}</button>
  </form>;
}
