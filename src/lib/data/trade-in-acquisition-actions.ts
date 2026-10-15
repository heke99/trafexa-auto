'use server';

import { revalidatePath } from 'next/cache';
import { requireTradeInAcquisitionContext } from '../trade-in-acquisition/context';
import type { TradeInAcquisitionContext } from '../trade-in-acquisition/context';
import { parseRecordTradeInAcquisitionInput, parseTradeInAcquisitionPage, parseTradeInAcquisitionReadInput, parseTradeInAcquisitionReceipt } from '../trade-in-acquisition/validation';
import type { RecordTradeInAcquisitionInput, TradeInAcquisitionCode, TradeInAcquisitionPage, TradeInAcquisitionReadInput, TradeInAcquisitionReceipt, TradeInAcquisitionResult } from '../trade-in-acquisition/types';

function failure(error: unknown, validation = false): TradeInAcquisitionResult<never> {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code: TradeInAcquisitionCode = validation ? 'invalid_input' : raw === 'unauthenticated' ? 'unauthenticated' : raw === 'access_denied' || raw === '42501' ? 'access_denied' : raw === 'conflict' || raw === '40001' || raw === '23505' ? 'conflict' : raw === '22023' ? 'invalid_input' : 'unavailable';
  const messages: Record<TradeInAcquisitionCode, string> = {
    unauthenticated: 'Logga in igen för att visa inbytesinköpet.',
    access_denied: 'Din aktuella behörighet till inbytesinköpet kunde inte verifieras.',
    invalid_input: 'Kontrollera inköpsreferensen, datumen, skuldbekräftelsen och biluppgifterna. Bekräfta alla intyg innan du fortsätter.',
    conflict: 'Inbytesunderlaget har ändrats eller bilen finns redan i registret. Uppdatera underlaget innan du fortsätter.',
    unavailable: 'Resultatet kunde inte bekräftas. Uppdatera och försök vid behov igen med samma uppgifter och begäran.',
  };
  return { ok: false, code, error: messages[code] };
}
async function fresh(first: TradeInAcquisitionContext, mode: 'read' | 'write') {
  const current = await requireTradeInAcquisitionContext(first.companyId, mode);
  if (current.companyId !== first.companyId || current.userId !== first.userId || current.role !== first.role) throw { code: 'access_denied' };
}
function operation() {
  const controller = new AbortController();
  return async function bounded<T>(work: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Intaget kunde inte bekräftas.')); }, 15000); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
}

export async function getTradeInAcquisitionAction(value: TradeInAcquisitionReadInput): Promise<TradeInAcquisitionResult<TradeInAcquisitionPage>> {
  let input: TradeInAcquisitionReadInput;
  try { input = parseTradeInAcquisitionReadInput(value); } catch (error) { return failure(error, true); }
  try {
    const bounded = operation(), current = await bounded(() => requireTradeInAcquisitionContext(input.companyId));
    const result = await bounded(signal => current.db.rpc('get_trade_in_acquisition', { p_company_id: input.companyId, p_deal_id: input.dealId }).abortSignal(signal));
    if (result.error) throw result.error;
    const page = parseTradeInAcquisitionPage(result.data, { ...current, dealId: input.dealId });
    await bounded(() => fresh(current, 'read'));
    return { ok: true, ...page };
  } catch (error) { return failure(error); }
}

/** Only references/manual attestations enter the RPC. It derives the vehicle,
 * seller and full gross purchase value from the accepted immutable source. */
export async function recordTradeInAcquisitionAction(value: RecordTradeInAcquisitionInput): Promise<TradeInAcquisitionResult<TradeInAcquisitionReceipt>> {
  let input: RecordTradeInAcquisitionInput;
  try { input = parseRecordTradeInAcquisitionInput(value); } catch (error) { return failure(error, true); }
  try {
    const bounded = operation(), current = await bounded(() => requireTradeInAcquisitionContext(input.companyId, 'write'));
    // No mutable preflight is allowed here: SQL resolves an authorized historical
    // same-request replay before current source/date/vehicle-conflict checks.
    const result = await bounded(signal => current.db.rpc('record_trade_in_acquisition', {
      p_company_id: input.companyId, p_deal_id: input.dealId, p_expected_source_sha256: input.expectedSourceSha256,
      p_acquired_on: input.acquiredOn, p_purchase_agreement_reference: input.purchaseAgreementReference,
      p_debt_confirmed_ore: input.debtConfirmedOre, p_debt_confirmed_on: input.debtConfirmedOn, p_debt_evidence_reference: input.debtEvidenceReference,
      p_fuel: input.fuel, p_gearbox: input.gearbox, p_asking_price_ore: input.askingPriceOre,
      p_purchase_confirmed: input.purchaseConfirmed, p_received_confirmed: input.receivedConfirmed, p_debt_confirmed: input.debtConfirmed,
      p_acknowledged: input.reviewAcknowledged, p_attestation_version: input.attestationVersion, p_request_id: input.requestId,
    }).abortSignal(signal));
    if (result.error) throw result.error;
    const receipt = parseTradeInAcquisitionReceipt(result.data, current, input);
    await bounded(() => fresh(current, 'write'));
    try { revalidatePath('/inventory'); revalidatePath('/deals'); revalidatePath('/dashboard'); } catch { /* A verified committed acquisition remains successful. */ }
    return { ok: true, ...receipt };
  } catch (error) { return failure(error); }
}
