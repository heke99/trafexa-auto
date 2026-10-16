'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { createOfferVersionAction, listDealOffersAction, type OfferSummary } from '@/lib/data/offer-actions';
import { listDealTradeInsAction } from '@/lib/data/trade-in-actions';
import type { TradeIn, TradeInPage } from '@/lib/trade-in/types';
import { formatOre } from '@/lib/calculations/vehicle-calculation';
import { archiveOfferAction } from '@/lib/data/offer-archive-actions';

const DealerOfferReviews = dynamic(() => import('./dealer-offer-reviews').then(module => module.DealerOfferReviews), { loading: () => <p role="status">Hämtar kundgranskningen…</p> });

export type DealOffersProps = { dealId: string; canCreate: boolean; canArchive?: boolean; companyId?: string; userId?: string; role?: string; demo?: boolean; demoOffers?: OfferSummary[] };
const emptyDemoOffers: OfferSummary[] = [];

function localDateAfter(days: number): string {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function money(value: string) { const amount = BigInt(value); return `${(amount / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${(amount % BigInt(100)).toString().padStart(2, '0')} kr`; }

export function DealOffers(props: DealOffersProps) { return <OfferPanel key={`${props.companyId}:${props.userId}:${props.role}:${props.dealId}:${props.canCreate}:${props.canArchive}:${!!props.demo}`} {...props}/>; }
function OfferPanel({ dealId, canCreate, canArchive = false, companyId, userId, role, demo = false, demoOffers = emptyDemoOffers }: DealOffersProps) {
  const fieldId = useId();
  const [offers, setOffers] = useState<OfferSummary[]>(demo ? demoOffers : []);
  const [resolvedCompany, setResolvedCompany] = useState(companyId);
  const [nextVersion, setNextVersion] = useState<number | undefined>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [lastOffer, setLastOffer] = useState<string>();
  const [terms, setTerms] = useState('');
  const [validUntil, setValidUntil] = useState(() => localDateAfter(30));
  const [grossConfirmed, setGrossConfirmed] = useState(false);
  const [tradePage,setTradePage]=useState<TradeInPage|null>(null),[tradeRows,setTradeRows]=useState<TradeIn[]>([]),[tradeId,setTradeId]=useState(''),[tradeConfirmed,setTradeConfirmed]=useState(false),[tradeLoading,setTradeLoading]=useState(false);
  const [latestOfferVersion,setLatestOfferVersion]=useState(0),[denied,setDenied]=useState(false);
  const alive=useRef(false),generation=useRef(0),tradeGeneration=useRef(0),writeLock=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  const selectedTrade=tradeRows.find(row=>row.id===tradeId);
  function clearPrivate(){tradeGeneration.current++;setTradeLoading(false);setDenied(true);setOffers([]);setNextVersion(undefined);setLatestOfferVersion(0);setTradeRows([]);setTradePage(null);setTradeId('');setTradeConfirmed(false);setTerms('');setGrossConfirmed(false);setLastOffer(undefined);setArchived({});retry.current=undefined;}
  async function loadTrade(company:string,older=false){
    setTradeLoading(true);const token=generation.current,read=++tradeGeneration.current;
    try{const result=await listDealTradeInsAction({companyId:company,dealId,...(older&&tradePage?.nextBeforeVersion?{beforeVersion:tradePage.nextBeforeVersion}:{})});if(!alive.current||token!==generation.current||read!==tradeGeneration.current)return;
      if(!result.ok){clearPrivate();setError(result.message);return;}
      if(result.companyId!==company||result.dealId!==dealId){clearPrivate();setError('Inbytesunderlagets företag och affär kunde inte verifieras.');return;}
      setTradePage(result);setTradeRows(current=>older?[...current,...result.versions].filter((row,index,all)=>all.findIndex(other=>other.id===row.id)===index):result.versions);
    }catch{if(alive.current&&token===generation.current&&read===tradeGeneration.current){setTradePage(null);setTradeRows([]);setTradeId('');setTradeConfirmed(false);setError('Inbytesunderlagen kunde inte hämtas. Uppdatera versionerna innan du skapar en offert.');}}
    finally{if(alive.current&&token===generation.current&&read===tradeGeneration.current)setTradeLoading(false);}
  }
  const retry = useRef<{ body: string; submission: string } | undefined>(undefined);
  const archiveRequests = useRef(new Map<string, string>());
  const [archived, setArchived] = useState<Record<string, string>>({});
  const scope = useRef({ dealId, companyId, demo });
  scope.current = { dealId, companyId, demo };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;generation.current++;setTradeRows([]);setTradePage(null);setTradeId('');setTradeConfirmed(false);
    if (demo) { setOffers(demoOffers); setLoading(false); return; }
    setLoading(true); setError(''); setMessage(''); setOffers([]); setArchived({}); setLastOffer(undefined); setResolvedCompany(companyId); setNextVersion(undefined); setGrossConfirmed(false);
    listDealOffersAction(dealId, companyId).then((result) => {
      if (cancelled) return;
      if (result.ok) { setDenied(false);setOffers(result.offers ?? []); setLatestOfferVersion(result.offers?.[0]?.version??0);setResolvedCompany(result.companyId); setNextVersion(result.nextBeforeVersion);if(canCreate&&result.companyId)void loadTrade(result.companyId); }
      else {clearPrivate();setError(result.message);}
    }).catch(() => { if (!cancelled) setError('Offertversionerna kunde inte hämtas. Försök igen.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true;generation.current++; };
  }, [open, dealId, companyId, demo, demoOffers]);

  function refresh(older = false) {
    if (demo) return;const token=generation.current;
    startTransition(async () => {
      try {
        const result = await listDealOffersAction(dealId, resolvedCompany, older ? nextVersion : undefined);
        if(!alive.current||token!==generation.current)return;
        if (!result.ok) { clearPrivate();setError(result.message); return; }
        if(!older){setLatestOfferVersion(result.offers?.[0]?.version??0);setTradeId('');setTradeConfirmed(false);setGrossConfirmed(false);}
        setOffers((current) => older ? [...current, ...(result.offers ?? [])].filter((offer, index, all) => all.findIndex((row) => row.id === offer.id) === index) : result.offers ?? []);
        setResolvedCompany(result.companyId); setNextVersion(result.nextBeforeVersion);setDenied(false);setError('');
        if(!older&&canCreate&&result.companyId)await loadTrade(result.companyId);
      } catch {if(alive.current&&token===generation.current)setError('Offertversionerna kunde inte hämtas. Försök igen.'); }
    });
  }

  function submit(form: FormData) {
    if (demo || !canCreate || !resolvedCompany || !grossConfirmed || denied || !tradePage?.canCreate || tradeLoading || writeLock.current || (tradeId&&(!selectedTrade||!selectedTrade.debtKnown||!tradeConfirmed))) return;
    form.set('expected_offer_version',String(latestOfferVersion));form.set('expected_sale_price_ore',tradePage.salePriceOre);form.set('trade_in_id',tradeId);if(selectedTrade){form.set('expected_trade_in_version',String(selectedTrade.version));form.set('trade_in_confirmed',tradeConfirmed?'true':'false');}
    form.set('deal_id', dealId); form.set('company_id', resolvedCompany);
    const body = JSON.stringify([dealId, resolvedCompany, form.get('terms'), form.get('valid_until'), form.get('gross_confirmed'),form.get('expected_offer_version'),form.get('expected_sale_price_ore'),form.get('trade_in_id'),form.get('expected_trade_in_version'),form.get('trade_in_confirmed')]);
    if (retry.current?.body !== body) retry.current = { body, submission: crypto.randomUUID() };
    form.set('submission_id', retry.current.submission);writeLock.current=true;const token=generation.current;
    startTransition(async () => {
      setError(''); setMessage('');
      try {
        const result = await createOfferVersionAction(form);
        if(!alive.current||token!==generation.current)return;
        if (!result.ok) { if(result.code==='access_denied')clearPrivate();if(result.code==='conflict'){setTradeId('');setTradeConfirmed(false);setGrossConfirmed(false);refresh();}setError(result.message); return; }
        setTradeId('');setTradeConfirmed(false);setMessage(result.message); setLastOffer(result.offerId); setGrossConfirmed(false); retry.current = undefined;
        try {
          const list = await listDealOffersAction(dealId, resolvedCompany);
          if(!alive.current||token!==generation.current)return;
          if (list.ok) { setOffers(list.offers ?? []);setLatestOfferVersion(list.offers?.[0]?.version??0); setNextVersion(list.nextBeforeVersion);await loadTrade(resolvedCompany); }
          else {clearPrivate();setError(list.message);}
        } catch { if(alive.current&&token===generation.current)setError('Offerten är sparad, men versionslistan kunde inte uppdateras. Hämta den sparade offerten eller uppdatera listan.'); }
      } catch { if(alive.current&&token===generation.current)setError('Sparandet kunde inte bekräftas. Försök igen med samma underlag; en bekräftad offert skapas inte dubbelt.'); }
      finally{writeLock.current=false;}
    });
  }

  function archiveOffer(offerId: string) {
    if (demo || !canArchive || !resolvedCompany || pending || loading) return;
    const company = resolvedCompany;
    const startedScope = scope.current;
    const requestKey = `${company}/${offerId}`;
    let submissionId = archiveRequests.current.get(requestKey);
    if (!submissionId) {
      submissionId = crypto.randomUUID();
      archiveRequests.current.set(requestKey, submissionId);
    }
    const currentScope = () => alive.current && scope.current.dealId === startedScope.dealId && scope.current.companyId === startedScope.companyId && scope.current.demo === startedScope.demo;
    startTransition(async () => {
      setError(''); setMessage('');
      try {
        const result = await archiveOfferAction({ offerId, companyId: company, submissionId });
        if (!currentScope()) return;
        if (!result.ok || !result.documentId || result.offerId !== offerId || result.companyId !== company || result.status !== 'archived') {
          setError(result.message || 'Arkiveringen kunde inte bekräftas. Försök igen med samma offertversion.');
          return;
        }
        setArchived((current) => ({ ...current, [offerId]: result.documentId! }));
        setMessage(result.message);
      } catch {
        if (currentScope()) setError('Arkiveringen kunde inte bekräftas. Försök igen med samma offertversion.');
      }
    });
  }

  return <details style={{ marginTop: 16 }} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary id={`${fieldId}-heading`}><strong>Offertversioner</strong></summary>
    {open && <section aria-labelledby={`${fieldId}-heading`} style={{ paddingTop: 12 }}>
    <p className="muted">Sparade versioner behåller kund, fordon, pris, momsmodell och villkor från när offerten skapades.</p>
    {demo && <p className="muted">Demoläge · läsvisning. Offertversioner och PDF-filer skapas först i ett inloggat företagskonto.</p>}
    {loading && <p role="status">Hämtar offertversioner…</p>}
    {!loading && !offers.length && <p className="muted">Inga offertversioner har sparats för affären.</p>}
    {!!offers.length && <ul style={{ paddingLeft: 20 }}>{offers.map((offer) => <li key={offer.id} style={{ marginBottom: 10 }}>
      <strong>Version {offer.version}</strong> · Totalpris inklusive eventuell moms: {money(offer.salePriceOre)} · Giltig till {offer.validUntil} · {offer.vatScheme === 'standard' ? 'Standardmoms' : offer.vatScheme === 'vmb' ? 'VMB' : 'Moms ej klassificerad'}{' '}
      {offer.tradeIn?<p>Inbyte: {offer.tradeIn.registration} · {offer.tradeIn.make} {offer.tradeIn.model} · Underlagsversion {offer.tradeIn.version}<br/>Inbytesvärde: {formatOre(offer.tradeIn.value_ore)} · Skuld enligt underlaget: {offer.tradeIn.debt_ore===null?'Okänd':formatOre(offer.tradeIn.debt_ore)}</p>:null}
      {demo ? <span className="muted">PDF visas i företagskontot</span> : <a href={`/api/offers/${offer.id}/pdf`} download>Hämta PDF</a>}
      {!demo && canArchive && <span style={{ display: 'block', marginTop: 6 }}>
        {archived[offer.id] ? <a href={`/api/documents/${archived[offer.id]}/pdf`} download>Hämta arkiverad PDF</a> : <button type="button" className="button button-outline button-small" disabled={pending || loading || !resolvedCompany} onClick={() => archiveOffer(offer.id)}>Spara i dokumentarkivet</button>}
      </span>}
    </li>)}</ul>}
    {!demo && <button type="button" className="button button-outline button-small" disabled={pending || loading} onClick={() => refresh()}>Uppdatera versioner</button>}
    {!demo && nextVersion && <button type="button" className="button button-outline button-small" disabled={pending || loading} onClick={() => refresh(true)}>Visa äldre versioner</button>}
    {!demo && canCreate && !denied && <form onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      submit(new FormData(form));
    }} className="workspace-form" style={{ marginTop: 16 }}>
      {tradeLoading?<p role="status">Hämtar inbytesunderlag…</p>:null}
      {tradePage?<p>Affärens aktuella försäljningspris: <strong>{formatOre(tradePage.salePriceOre)}</strong></p>:null}
      {tradePage&&!tradePage.canCreate?<p>Affären eller offertens status tillåter inte en ny offertversion.</p>:null}
      <label htmlFor={`${fieldId}-trade`}>Inbyte i den nya offerten<select id={`${fieldId}-trade`} value={tradeId} disabled={pending||tradeLoading||!tradePage?.canCreate} onChange={event=>{setTradeId(event.target.value);setTradeConfirmed(false);setGrossConfirmed(false);}}><option value="">Ingen inbytesbil i offerten</option>{tradeRows.map(row=><option key={row.id} value={row.id} disabled={!row.debtKnown||row.version!==tradePage?.latestVersion||row.salePriceOre!==tradePage?.salePriceOre}>Version {row.version} · {row.registration} · {row.make} {row.model}{!row.debtKnown?' · Skulden behöver kontrolleras':row.version!==tradePage?.latestVersion?' · Äldre underlag':row.salePriceOre!==tradePage?.salePriceOre?' · Försäljningspriset har ändrats':''}</option>)}</select></label>
      {tradeRows.some(row=>!row.debtKnown)?<p className="muted">Okänd skuld kan inte ingå i en kundoffert. Spara ett nytt granskat inbytesunderlag med känd skuld, även 0 om bilen är skuldfri enligt underlaget.</p>:null}
      {tradePage?.nextBeforeVersion?<button type="button" className="button button-outline" disabled={pending||tradeLoading} onClick={()=>resolvedCompany&&void loadTrade(resolvedCompany,true)}>Visa äldre inbytesunderlag</button>:null}
      {selectedTrade?<section aria-label="Inbyte som kunden får se" style={{overflowWrap:'anywhere'}}><h4>Inbyte som kunden får se</h4><p>{selectedTrade.registration} · {selectedTrade.make} {selectedTrade.model} · Modellår {selectedTrade.modelYear} · {selectedTrade.mileageKm} km · Underlagsversion {selectedTrade.version}</p><p>Inbytesvärde: {formatOre(selectedTrade.valueOre)}<br/>Kvarvarande skuld enligt underlaget: {selectedTrade.debtOre===null?'Okänd':formatOre(selectedTrade.debtOre)}<br/>Nettoinbyte: {selectedTrade.netTradeInOre===null?'Kan inte beräknas':formatOre(selectedTrade.netTradeInOre)}<br/>{selectedTrade.amountToPayOre!==null&&BigInt(selectedTrade.amountToPayOre)<0n?'Att betala till kunden enligt underlaget':'Att betala av kunden enligt underlaget'}: {selectedTrade.amountToPayOre===null?'Kan inte beräknas':formatOre((BigInt(selectedTrade.amountToPayOre)<0n?-BigInt(selectedTrade.amountToPayOre):BigInt(selectedTrade.amountToPayOre)).toString())}</p><p className="muted">Bara dessa biluppgifter och belopp kopieras till den nya offertversionen. Interna anteckningar och kreditgivaruppgifter visas inte. Skulden är manuellt registrerad och inte verifierad hos kreditgivaren. Underlaget innebär ingen genomförd betalning.</p><label style={{flexDirection:'row',alignItems:'flex-start'}}><input type="checkbox" checked={tradeConfirmed} onChange={event=>setTradeConfirmed(event.target.checked)} disabled={pending} style={{width:'auto'}}/><span>Jag har granskat inbytet och bekräftar att kunden får se dessa uppgifter och belopp i den nya offerten.</span></label></section>:null}
      <label htmlFor={`${fieldId}-date`}>Giltig till
      <input id={`${fieldId}-date`} name="valid_until" type="date" min={localDateAfter(0)} max={localDateAfter(90)} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} required disabled={pending} /></label>
      <label htmlFor={`${fieldId}-terms`}>Villkor · högst 2000 tecken
      <textarea id={`${fieldId}-terms`} name="terms" maxLength={2000} rows={3} value={terms} onChange={(event) => setTerms(event.target.value)} disabled={pending} /></label>
      <label htmlFor={`${fieldId}-gross`} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <input id={`${fieldId}-gross`} type="checkbox" name="gross_confirmed" value="true" required checked={grossConfirmed} onChange={(event) => setGrossConfirmed(event.target.checked)} disabled={pending} style={{ width: 'auto', marginTop: 2 }} />
        <span>Jag bekräftar att affärspriset är totalpris inklusive eventuell moms. Vid standardmoms används 25 %. Vid VMB och ej klassificerad moms redovisas moms inte separat.</span>
      </label>
      <p className="muted">Offerten innebär ingen signering eller kreditprövning och skickas inte till kunden.</p>
      <button type="submit" className="button button-green" disabled={pending || loading || tradeLoading || denied || !tradePage?.canCreate || !resolvedCompany || !grossConfirmed || !!tradeId&&!tradeConfirmed}>{pending ? 'Arbetar…' : 'Skapa ny offertversion'}</button>
    </form>}
    {!demo && !canCreate && <p className="muted">Din roll har läsbehörighet för offerterna.</p>}
    {!demo && canArchive && <p className="muted">Arkiveringen sparar den här offertversionen i företagets privata dokumentarkiv. Offerten är inte signerad.</p>}
    {message && <p role="status">{message}{lastOffer && !offers.some((offer) => offer.id === lastOffer) && <> <a href={`/api/offers/${lastOffer}/pdf`} download>Hämta den sparade offerten</a></>}</p>}
    {error && <p role="alert">{error}</p>}
    {resolvedCompany && !denied && <DealerOfferReviews key={`${resolvedCompany}:${dealId}:${canCreate}:${lastOffer ?? ''}`} companyId={resolvedCompany} dealId={dealId} userId={userId} role={role} canEdit={canCreate} demo={demo}/>}
    </section>}
  </details>;
}
