import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { PlatformAdminError, requirePlatformAdminContext } from '@/lib/platform-admin/context';
import type { Json } from '@/lib/supabase/database.types';

const id = z.uuid();
const dates = {
  desired_start: 'Önskad start',
  confirmed_start: 'Blockets bekräftade fakturastart',
  notice_date: 'Uppsägningsdatum',
  contract_end: 'Första dagen utanför avtalet',
  confirmed_end: 'Första dagen med ny fakturamottagare hos Blocket',
} as const;
const prices = {
  blocket_price_ore: 'Kundpris Blocket per annons',
  bytbil_price_ore: 'Kundpris Bytbil per annons',
  monthly_fee_ore: 'Kundens butiksavgift per månad',
  blocket_cost_ore: 'Trafexas inköpspris Blocket per annons',
  bytbil_cost_ore: 'Trafexas inköpspris Bytbil per annons',
  monthly_cost_ore: 'Trafexas egen butiksavgift per månad',
} as const;
const dateKeys = Object.keys(dates) as (keyof typeof dates)[];
const priceKeys = Object.keys(prices) as (keyof typeof prices)[];
const periodSchema = z.object({
  period_id: id,
  cancelled: z.boolean(),
  version: z.number().int().positive(),
  agreement_reference: z.string(),
  partial_month_rule: z.enum(['full', 'prorated']).nullable(),
}).extend(Object.fromEntries(dateKeys.map(key => [key, z.iso.date().nullable()])) as Record<keyof typeof dates, z.ZodNullable<z.ZodISODate>>)
  .extend(Object.fromEntries(priceKeys.map(key => [key, z.string().regex(/^\d+$/).nullable()])) as Record<keyof typeof prices, z.ZodNullable<z.ZodString>>);
const storesSchema = z.array(z.object({
  id, company_id: id, dealer_code: z.string(), store_name: z.string(), periods: z.array(periodSchema),
}));
type Period = z.infer<typeof periodSchema>;

function priceToOre(value: string) {
  const [whole, fraction = ''] = z.string().regex(/^\d{1,12}(?:[,.]\d{1,2})?$/).parse(value).split(/[,.]/);
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
function formatPrice(value: string | null | undefined) {
  if (value == null) return '';
  const amount = BigInt(value);
  return `${amount / 100n},${String(amount % 100n).padStart(2, '0')}`;
}

async function save(companyId: string, storeId: string | null, periodId: string | null, version: number, form: FormData) {
  'use server';
  const { db } = await requirePlatformAdminContext();
  const url = `/admin/annonsprogram/${id.parse(companyId)}`;
  const value = (key: string) => String(form.get(key) ?? '').trim();
  let payload: Record<string, Json>;
  try {
    payload = storeId && form.get('operation') === 'cancel' && periodId ? {
      period_id: periodId, version, cancelled: true,
    } : storeId ? {
      period_id: periodId,
      version,
      agreement_reference: z.string().min(1).max(300).parse(value('agreement_reference')),
      partial_month_rule: value('partial_month_rule') ? z.enum(['full', 'prorated']).parse(value('partial_month_rule')) : null,
      ...Object.fromEntries(dateKeys.map(key => [key, value(key) || key === 'desired_start' ? z.iso.date().parse(value(key)) : null])),
      ...Object.fromEntries(priceKeys.map(key => [key, value(key) ? priceToOre(value(key)) : null])),
    } : {
      store_name: z.string().min(1).max(160).parse(value('store_name')),
      dealer_code: z.string().min(1).max(160).parse(value('dealer_code')),
    };
  } catch { redirect(`${url}?result=invalid`); }
  const { error } = await db.rpc('save_advertising_program', { p_company: companyId, p_store: storeId, p_input: payload });
  const result = error ? ({ '40001': 'conflict', '23P01': 'overlap', '23505': 'duplicate', '23514': 'invalid' }[error.code] ?? 'error') : 'saved';
  redirect(`${url}?result=${result}`);
}

function PeriodForm({ companyId, storeId, period }: { companyId: string; storeId: string; period?: Period }) {
  return <form className="workspace-form" action={save.bind(null, companyId, storeId, period?.period_id ?? null, period?.version ?? 0)}>
    <label>Avtalsreferens<input name="agreement_reference" required maxLength={300} defaultValue={period?.agreement_reference}/></label>
    {dateKeys.map(key => <label key={key}>{dates[key]}<input name={key} type="date" required={key === 'desired_start'} defaultValue={period?.[key] ?? ''}/></label>)}
    {priceKeys.map(key => <label key={key}>{prices[key]} (kr exkl. moms)<input name={key} inputMode="decimal" defaultValue={formatPrice(period?.[key])}/></label>)}
    <label>Avgift för delmånad<select name="partial_month_rule" defaultValue={period?.partial_month_rule ?? ''}>
      <option value="">Ej beslutad</option><option value="full">Hel avgift</option><option value="prorated">Proportionerad avgift</option>
    </select></label>
    <button type="submit" className="button button-green">Spara avtalsperiod</button>
  </form>;
}
const messages: Record<string, string> = {
  saved: 'Sparat.', invalid: 'Kontrollera datum, belopp och avtalsuppgifter.',
  conflict: 'Avtalet har ändrats. Läs in aktuella uppgifter innan du sparar.',
  overlap: 'Perioden överlappar ett annat avtal för butiken.',
  duplicate: 'Butikskoden är redan registrerad.', error: 'Uppgifterna kunde inte sparas.',
};

export default async function AdvertisingProgramPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { companyId } = await params;
  if (!id.safeParse(companyId).success) notFound();
  const query = await searchParams;
  const nextPath = `/admin/annonsprogram/${companyId}${typeof query.result === 'string' ? `?${new URLSearchParams({ result: query.result })}` : ''}`;
  const { db } = await requirePlatformAdminContext().catch(error => {
    if (error instanceof PlatformAdminError && error.code === 'unauthenticated') redirect(`/login?${new URLSearchParams({ next: nextPath })}`);
    if (error instanceof PlatformAdminError && error.code === 'forbidden') notFound();
    throw error;
  });
  const response = await db.rpc('list_advertising_program', { p_company: companyId });
  if (response.error) throw Error('Annonsprogrammet kunde inte läsas in.');
  if (!response.data) notFound();
  const company = z.object({ companyId: id, name: z.string(), organisationNumber: z.string(), stores: storesSchema }).parse(response.data);
  const { stores } = company;
  if (company.companyId !== companyId || stores.some(store => store.company_id !== companyId)) throw Error('Felaktig butikslista.');
  const { result } = query;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());
  return <main className="surface">
    <Link href="/admin">Tillbaka till superadmin</Link>
    <h1>Annonsprogram · {company.name}</h1>
    <p>{company.organisationNumber} · Trafexa Nordic AB tar emot Blockets faktura enligt bekräftad avtalsperiod.</p>
    <p>Här sparas avtalsunderlag och priser inför publicering och fakturering.</p>
    {result && Object.hasOwn(messages, result) && <p role="status">{messages[result]}</p>}
    <details><summary>Registrera befintlig Blocketbutik</summary>
      <form className="workspace-form" action={save.bind(null, companyId, null, null, 0)}>
        <label>Butiksnamn<input name="store_name" required maxLength={160}/></label>
        <label>Butikens dealer_code<input name="dealer_code" required maxLength={160}/></label>
        <button className="button button-green" type="submit">Registrera butik</button>
      </form>
    </details>
    {stores.map(store => <section key={store.id}>
      <h2>{store.store_name} · {store.dealer_code}</h2>
      {store.periods.map(period => <details key={period.period_id}>
        <summary>{period.desired_start} · {period.cancelled ? 'Avbruten' : period.contract_end && period.contract_end <= today ? 'Avslutad' : !period.confirmed_start ? 'Väntar på Blocket' : period.confirmed_start > today || (period.desired_start && period.desired_start > today) ? 'Planerad' : 'Aktiv'} · version {period.version}{period.contract_end ? ` · avtal upphör ${period.contract_end}` : ''}</summary>
        {period.contract_end && period.confirmed_end !== period.contract_end && <p role="status">Fakturabytet behöver stämmas av med Blocket.</p>}
        {!period.cancelled && <PeriodForm companyId={companyId} storeId={store.id} period={period}/>}
        {!period.cancelled && !period.confirmed_start && <form action={save.bind(null, companyId, store.id, period.period_id, period.version)}>
          <input type="hidden" name="operation" value="cancel"/>
          <label><input type="checkbox" required/> Jag vill avbryta den väntande avtalsperioden</label>
          <button type="submit" className="button button-outline">Avbryt väntande period</button>
        </form>}
      </details>)}
      <details><summary>Ny avtalsperiod</summary><PeriodForm companyId={companyId} storeId={store.id}/></details>
    </section>)}
  </main>;
}
