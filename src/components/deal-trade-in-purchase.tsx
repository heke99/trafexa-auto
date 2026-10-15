'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { getTradeInAcquisitionAction, recordTradeInAcquisitionAction } from '@/lib/data/trade-in-acquisition-actions';
import { TRADE_IN_ACQUISITION_ATTESTATION_VERSION, type RecordTradeInAcquisitionInput, type TradeInAcquisition, type TradeInAcquisitionPage, type TradeInAcquisitionReceipt, type TradeInAcquisitionReason, type TradeInAcquisitionSource } from '@/lib/trade-in-acquisition/types';
import { formatOre, kronorToOre } from '@/lib/calculations/vehicle-calculation';

export type DealTradeInPurchaseProps = { companyId: string; dealId: string; userId: string; role: string; demo?: boolean };
type Draft = {
  acquiredOn: string; purchaseAgreementReference: string; debtAmount: string; debtConfirmedOn: string; debtEvidenceReference: string;
  fuel: '' | TradeInAcquisition['fuel']; gearbox: '' | TradeInAcquisition['gearbox']; askingPrice: string;
  purchaseConfirmed: boolean; receivedConfirmed: boolean; debtConfirmed: boolean;
};
type ReviewedInput = Omit<RecordTradeInAcquisitionInput, 'requestId' | 'reviewAcknowledged'>;
type Review = { source: TradeInAcquisitionSource; input: ReviewedInput };
const blank = (): Draft => ({ acquiredOn: '', purchaseAgreementReference: '', debtAmount: '', debtConfirmedOn: '', debtEvidenceReference: '', fuel: '', gearbox: '', askingPrice: '', purchaseConfirmed: false, receivedConfirmed: false, debtConfirmed: false });
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const fuelLabels = { petrol: 'Bensin', diesel: 'Diesel', electric: 'El', hybrid: 'Hybrid', other: 'Annat' };
const gearboxLabels = { automatic: 'Automat', manual: 'Manuell' };
const reasonLabels: Record<TradeInAcquisitionReason, string> = {
  no_accepted_trade_in: 'Affären behöver en accepterad offertversion med ett fryst inbytesunderlag.',
  contract_incomplete: 'Försäljningsavtalet för exakt den accepterade offerten måste vara färdigsignerat av båda parter.',
  deal_unavailable: 'Affärens aktuella status tillåter inte ett nytt inbytesköp.',
  vehicle_exists: 'Registreringsnumret finns redan i företagets fordonsregister, även om bilen är historisk. Ett nytt lagerintag kan inte registreras här.',
  already_acquired: 'Inbytesköpet och lagerintaget har redan registrerats.',
};

export function DealTradeInPurchase(props: DealTradeInPurchaseProps) {
  if (!['owner', 'admin', 'finance'].includes(props.role)) return null;
  return <PurchasePanel key={`${props.companyId}:${props.userId}:${props.role}:${props.dealId}:${!!props.demo}`} {...props} />;
}

function PurchasePanel({ companyId, dealId, userId, role, demo = false }: DealTradeInPurchaseProps) {
  const field = useId();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [page, setPage] = useState<TradeInAcquisitionPage | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [review, setReview] = useState<Review | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [readError, setReadError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [writing, setWriting] = useState(false);
  const [receipt, setReceipt] = useState<TradeInAcquisition | null>(null);
  const [, startAction] = useTransition();
  const alive = useRef(false), sequence = useRef(0), locked = useRef(false);
  const retries = useRef(new Map<string, string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSource = useRef<string | null>(null);
  const canWrite = !demo && ['owner', 'admin'].includes(role);
  const busy = writing || phase === 'loading';
  const current = phase === 'ready' ? page : null;
  const source = current?.source ?? null;
  const acquisition = receipt ?? current?.acquisition ?? null;

  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);

  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(current => ({ ...current, [key]: value })); }
  function matchesScope(value: { companyId: string; dealId: string; actorId: string; role: string }) {
    return sameId(value.companyId, companyId) && sameId(value.dealId, dealId) && sameId(value.actorId, userId) && value.role === role;
  }
  function matchesSource(value: TradeInAcquisitionSource) {
    return sameId(value.companyId, companyId) && sameId(value.dealId, dealId) && sameId(value.offerSnapshot.company.id, companyId) && sameId(value.offerSnapshot.deal_id, dealId) && value.offerVersion === value.offerSnapshot.version && sameId(value.tradeInId, value.offerSnapshot.trade_in.id) && value.tradeInVersion === value.offerSnapshot.trade_in.version && sameId(value.sellerCustomerId, value.offerSnapshot.customer.id) && value.signingRevision === 3;
  }
  function clearPrivate() {
    setPage(null); setReceipt(null); setDraft(blank()); setReview(null); setAcknowledged(false); previousSource.current = null; retries.current.clear(); setPhase('error');
  }
  function refresh() {
    if (demo || locked.current) return;
    locked.current = true;
    const token = ++sequence.current;
    setPhase('loading'); setReadError('');
    startAction(async () => {
      try {
        const result = await getTradeInAcquisitionAction({ companyId, dealId });
        if (!alive.current || token !== sequence.current) return;
        if (!result.ok) {
          if (['access_denied', 'unauthenticated'].includes(result.code)) clearPrivate();
          else { setPhase('error'); setPage(null); setReceipt(null); }
          setReadError(result.error); return;
        }
        if (!matchesScope(result) || result.source && !matchesSource(result.source) || result.acquisition && (!sameId(result.acquisition.companyId, companyId) || !sameId(result.acquisition.dealId, dealId) || !matchesSource(result.acquisition.source))) {
          clearPrivate(); setReadError('Inbytesköpets företag, konto eller underlag kunde inte verifieras. Läs in affären igen.'); return;
        }
        if (previousSource.current && previousSource.current !== result.source?.sourceSha256) {
          setReview(null); setAcknowledged(false);
          setDraft(current => ({ ...current, purchaseConfirmed: false, receivedConfirmed: false, debtConfirmed: false }));
          setWriteError('Det frysta underlaget har ändrats. Granska uppgifterna och intygen igen.');
        }
        previousSource.current = result.source?.sourceSha256 ?? null;
        setPage(result); setPhase('ready'); setReceipt(null);
        if (result.acquisition) { setReview(null); setAcknowledged(false); retries.current.clear(); setWriteError(''); }
      } catch {
        if (alive.current && token === sequence.current) { setPage(null); setReceipt(null); setPhase('error'); setReadError('Inbytesköpets underlag kunde inte hämtas. Dina inmatade uppgifter finns kvar. Försök igen.'); }
      } finally { locked.current = false; }
    });
  }

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || busy || !current?.canAcquire || !source || !draft.purchaseConfirmed || !draft.receivedConfirmed || !draft.debtConfirmed || !event.currentTarget.reportValidity()) return;
    try {
      const debtConfirmedOre = kronorToOre(draft.debtAmount), askingPriceOre = kronorToOre(draft.askingPrice);
      if (debtConfirmedOre === null || debtConfirmedOre !== source.offerSnapshot.trade_in.debt_ore) throw Error('Det avstämda skuldbeloppet måste exakt matcha den frysta skuldens belopp, även 0 kr.');
      if (askingPriceOre === null || BigInt(askingPriceOre) < 1n || BigInt(askingPriceOre) > 999999999999n) throw Error('Ange ett utpris från 0,01 till 9 999 999 999,99 kr med högst två decimaler.');
      if (!draft.fuel || !draft.gearbox) throw Error('Välj drivmedel och växellåda för inbytesbilen.');
      const purchaseAgreementReference = draft.purchaseAgreementReference.trim(), debtEvidenceReference = draft.debtEvidenceReference.trim();
      if (purchaseAgreementReference.length < 2 || debtEvidenceReference.length < 2) throw Error('Ange verifierad inköpsavtalsreferens och skuldavstämningens underlagsreferens, även när skulden är 0 kr.');
      setReview({ source, input: { companyId, dealId, expectedSourceSha256: source.sourceSha256, acquiredOn: draft.acquiredOn, purchaseAgreementReference, debtConfirmedOre, debtConfirmedOn: draft.debtConfirmedOn, debtEvidenceReference, fuel: draft.fuel, gearbox: draft.gearbox, askingPriceOre, purchaseConfirmed: true, receivedConfirmed: true, debtConfirmed: true, attestationVersion: TRADE_IN_ACQUISITION_ATTESTATION_VERSION } });
      setAcknowledged(false); setWriteError('');
    } catch (error) { setWriteError(error instanceof Error ? error.message : 'Kontrollera inköpsuppgifterna.'); }
  }

  function matchesReceipt(result: TradeInAcquisitionReceipt, confirmed: Review, requestId: string) {
    const value = result.acquisition, input = confirmed.input;
    return matchesScope(result) && sameId(result.requestId, requestId) && sameId(value.companyId, companyId) && sameId(value.dealId, dealId) && matchesSource(value.source) && value.source.sourceSha256 === input.expectedSourceSha256 && value.source.signingDocumentSha256 === confirmed.source.signingDocumentSha256 && sameId(value.source.signingId, confirmed.source.signingId) && sameId(value.source.offerId, confirmed.source.offerId) && value.purchasePriceOre === confirmed.source.offerSnapshot.trade_in.value_ore && value.vatScheme === 'unknown' && value.actorLabel === 'Du' && value.attestationVersion === input.attestationVersion && (['acquiredOn', 'purchaseAgreementReference', 'debtConfirmedOre', 'debtConfirmedOn', 'debtEvidenceReference', 'fuel', 'gearbox', 'askingPriceOre'] as const).every(key => value[key] === input[key]);
  }
  function confirm() {
    if (!review || !acknowledged || !canWrite || locked.current || acquisition) return;
    const confirmed = review, values = { ...confirmed.input, reviewAcknowledged: true };
    const fingerprint = JSON.stringify(values);
    let requestId = retries.current.get(fingerprint);
    if (!requestId) {
      try { requestId = crypto.randomUUID(); }
      catch { setWriteError('Webbläsaren kunde inte skapa en säker begäran. Läs in sidan igen.'); return; }
      retries.current.set(fingerprint, requestId);
    }
    const nonce = requestId;
    locked.current = true;
    const token = ++sequence.current;
    setWriting(true); setWriteError('');
    startAction(async () => {
      try {
        const result = await recordTradeInAcquisitionAction({ ...values, requestId: nonce });
        if (!alive.current || token !== sequence.current) return;
        if (!result.ok) {
          if (['access_denied', 'unauthenticated'].includes(result.code)) clearPrivate();
          else if (result.code === 'conflict') { setReview(null); setAcknowledged(false); setPage(null); setPhase('error'); setReadError('Kontrollera aktuell inköpsstatus innan du granskar uppgifterna igen.'); setDraft(current => ({ ...current, purchaseConfirmed: false, receivedConfirmed: false, debtConfirmed: false })); }
          setWriteError(result.error); return;
        }
        if (!matchesReceipt(result, confirmed, nonce)) { clearPrivate(); setWriteError('Lagerintaget kunde inte verifieras för det här kontot och det granskade underlaget. Kontrollera aktuell status.'); return; }
        retries.current.delete(fingerprint); setReceipt(result.acquisition); setReview(null); setAcknowledged(false);
      } catch {
        if (alive.current && token === sequence.current) setWriteError('Inköpet och lagerintaget kunde inte bekräftas. Försök igen med samma granskade uppgifter och begäran, eller kontrollera aktuell status.');
      } finally { locked.current = false; if (alive.current && token === sequence.current) setWriting(false); }
    });
  }

  return <details className="offer-panel" style={{ minWidth: 0 }} onToggle={event => { if (event.currentTarget.open && phase === 'idle') refresh(); }}>
    <summary>Inbytesköp &amp; lagerintag</summary>
    <section aria-labelledby={`${field}-title`} style={{ paddingTop: 16, minWidth: 0, overflowWrap: 'anywhere' }}>
      <h3 id={`${field}-title`}>Registrera faktiskt inbytesköp</h3>
      <p className="muted">Inköp och lagerintag är ett separat steg efter accepterad offert och färdigsignerat försäljningsavtal. Referera ett separat, verifierat inköpsavtal. Ingen betalning, skuldlösen eller extern ägarregistrering genomförs här.</p>
      {demo ? <p className="inline-note">Demonstration i läsläge. Inga inköpsuppgifter hämtas och inget lagerintag registreras.</p> : null}
      {phase === 'loading' ? <p role="status">Hämtar verifierat underlag för inbytesköpet…</p> : null}
      {writing ? <p role="status">Registrerar inbytesköp och lagerintag…</p> : null}
      {readError ? <p role="alert">{readError}</p> : null}{writeError ? <p role="alert">{writeError}</p> : null}
      {acquisition ? <section aria-label="Registrerat inbytesköp"><h4>Inbytesköpet och lagerintaget är registrerade.</h4><FrozenSource source={acquisition.source}/><ReceiptFields acquisition={acquisition}/><p>Lagerstatus vid intag: Tillgänglig. Momsmodell vid intag: Ej klassificerad. Inköpspriset är hela inbytesvärdet och har inte minskats med skulden.</p><a href="/inventory" className="button button-outline">Öppna lagret</a></section> : null}
      {!acquisition && current?.reason ? <p className="inline-note">{reasonLabels[current.reason]}</p> : null}
      {!acquisition && source && !review ? <FrozenSource source={source}/> : null}
      {!demo && !acquisition && role === 'finance' && current ? <p className="muted">Du kan granska underlaget. Företagets ägare eller administratör registrerar inköp och lagerintag.</p> : null}
      {canWrite && !acquisition && current?.canAcquire && source && !review ? <form onSubmit={prepare} className="workspace-form" style={{ marginTop: 18, minWidth: 0 }}>
        <label htmlFor={`${field}-acquired`}>Datum för faktiskt inköp<input id={`${field}-acquired`} type="date" min="1900-01-01" max={current.businessDate} value={draft.acquiredOn} required disabled={busy} onChange={event => change('acquiredOn', event.target.value)}/></label>
        <label htmlFor={`${field}-agreement`}>Verifierad extern inköpsavtalsreferens<input id={`${field}-agreement`} value={draft.purchaseAgreementReference} required minLength={2} maxLength={160} disabled={busy} onChange={event => change('purchaseAgreementReference', event.target.value)}/></label>
        <label htmlFor={`${field}-debt`}>Avstämd skuld (kr), även 0<input id={`${field}-debt`} inputMode="decimal" value={draft.debtAmount} required maxLength={22} disabled={busy} onChange={event => change('debtAmount', event.target.value)}/></label>
        <label htmlFor={`${field}-debt-date`}>Datum för skuldavstämning<input id={`${field}-debt-date`} type="date" min="1900-01-01" max={current.businessDate} value={draft.debtConfirmedOn} required disabled={busy} onChange={event => change('debtConfirmedOn', event.target.value)}/></label>
        <label htmlFor={`${field}-debt-ref`}>Underlagsreferens för skuldavstämning, även vid 0 kr<input id={`${field}-debt-ref`} value={draft.debtEvidenceReference} required minLength={2} maxLength={160} disabled={busy} onChange={event => change('debtEvidenceReference', event.target.value)}/></label>
        <div className="field-pair"><label htmlFor={`${field}-fuel`}>Inbytesbilens drivmedel<select id={`${field}-fuel`} value={draft.fuel} required disabled={busy} onChange={event => change('fuel', event.target.value as Draft['fuel'])}><option value="">Välj drivmedel</option>{Object.entries(fuelLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label><label htmlFor={`${field}-gearbox`}>Inbytesbilens växellåda<select id={`${field}-gearbox`} value={draft.gearbox} required disabled={busy} onChange={event => change('gearbox', event.target.value as Draft['gearbox'])}><option value="">Välj växellåda</option>{Object.entries(gearboxLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label></div>
        <label htmlFor={`${field}-asking`}>Utpris inklusive eventuell moms (kr)<input id={`${field}-asking`} inputMode="decimal" value={draft.askingPrice} required maxLength={22} disabled={busy} onChange={event => change('askingPrice', event.target.value)}/></label>
        <Attestation checked={draft.purchaseConfirmed} disabled={busy} onChange={value => change('purchaseConfirmed', value)}>Jag bekräftar att köpet faktiskt är genomfört. Jag har kontrollerat säljarens ägande eller rätt att sälja bilen och verifierat det separata inköpsavtalet.</Attestation>
        <Attestation checked={draft.receivedConfirmed} disabled={busy} onChange={value => change('receivedConfirmed', value)}>Jag bekräftar att företaget faktiskt har tagit emot inbytesbilen och att den ska registreras som tillgänglig i lagret.</Attestation>
        <Attestation checked={draft.debtConfirmed} disabled={busy} onChange={value => change('debtConfirmed', value)}>Jag har stämt av skuldbeloppet mot underlaget för angivet datum, även om beloppet är 0 kr.</Attestation>
        <button type="submit" className="button button-green" disabled={busy || !draft.purchaseConfirmed || !draft.receivedConfirmed || !draft.debtConfirmed}>Granska inbytesköp och lagerintag</button>
      </form> : null}
      {review && !acquisition ? <section aria-labelledby={`${field}-review`} className="workspace-form surface" style={{ padding: 18, marginTop: 18, minWidth: 0 }}><h4 id={`${field}-review`} ref={heading} tabIndex={-1}>Granska faktiskt inbytesköp och lagerintag</h4><FrozenSource source={review.source}/><p>Inköpsdatum: {review.input.acquiredOn}<br/>Verifierad extern inköpsavtalsreferens: {review.input.purchaseAgreementReference}<br/>Avstämd skuld: {formatOre(review.input.debtConfirmedOre)}<br/>Skuldavstämning: {review.input.debtConfirmedOn} · {review.input.debtEvidenceReference}<br/>Drivmedel: {fuelLabels[review.input.fuel]} · Växellåda: {gearboxLabels[review.input.gearbox]}<br/>Utpris inklusive eventuell moms: {formatOre(review.input.askingPriceOre)}</p><p>Du har intygat genomfört köp och kontrollerad rätt att sälja, mottagen bil samt avstämd skuld. Lagerstatus blir Tillgänglig och momsmodellen Ej klassificerad. Skulden minskar inte det registrerade inköpspriset.</p><Attestation checked={acknowledged} disabled={busy} onChange={setAcknowledged}>Jag har granskat exakt offert, signerat försäljningsavtal, externt inköpsavtal, intyg, skuld och lageruppgifter. Jag vill registrera det faktiska inbytesköpet och lagerintaget.</Attestation><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" className="button button-green" disabled={busy || !acknowledged} onClick={confirm}>Bekräfta faktiskt inbytesköp och lagerintag</button><button type="button" className="button button-outline" disabled={busy} onClick={() => { setReview(null); setAcknowledged(false); }}>Tillbaka och ändra</button></div></section> : null}
      {!demo && phase !== 'idle' ? <button type="button" className="button button-outline" style={{ marginTop: 16 }} disabled={busy} onClick={refresh}>Kontrollera inköpsstatus</button> : null}
    </section>
  </details>;
}

function Attestation({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; children: string }) {
  return <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} style={{ width: 'auto', flexShrink: 0 }}/><span>{children}</span></label>;
}
function FrozenSource({ source }: { source: TradeInAcquisitionSource }) {
  const offer = source.offerSnapshot, trade = offer.trade_in;
  return <div style={{ minWidth: 0, marginBlock: 16 }}><p><strong>{trade.registration} · {trade.make} {trade.model}</strong><br/>Modellår {trade.model_year} · {trade.mileage_km.toLocaleString('sv-SE')} km<br/>Säljare enligt den frysta offerten: {offer.customer.name}<br/>Accepterad offertversion {source.offerVersion} · Inbytesversion {source.tradeInVersion}<br/>Färdigsignerat försäljningsavtal · Revision {source.signingRevision}</p><p>Inköpspris för lagerintaget, hela inbytesvärdet: <strong>{formatOre(trade.value_ore)}</strong><br/>Skuld i det frysta underlaget: {formatOre(trade.debt_ore)}</p><p className="form-note">Signerat dokuments SHA-256: <span style={{ wordBreak: 'break-all' }}>{source.signingDocumentSha256}</span></p></div>;
}
function ReceiptFields({ acquisition }: { acquisition: TradeInAcquisition }) {
  return <p>Inköpsdatum: {acquisition.acquiredOn}<br/>Inköpsavtalsreferens: {acquisition.purchaseAgreementReference}<br/>Avstämd skuld: {formatOre(acquisition.debtConfirmedOre)} · {acquisition.debtConfirmedOn}<br/>Skuldunderlag: {acquisition.debtEvidenceReference}<br/>Inköpspris vid intag: {formatOre(acquisition.purchasePriceOre)}<br/>Utpris vid intag inklusive eventuell moms: {formatOre(acquisition.askingPriceOre)}<br/>Drivmedel: {fuelLabels[acquisition.fuel]} · Växellåda: {gearboxLabels[acquisition.gearbox]}<br/>Registrerat {new Date(acquisition.createdAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })} · {acquisition.actorLabel}</p>;
}
