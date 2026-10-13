'use server';

import { revalidatePath } from 'next/cache';
import { getActiveCompanyContext } from './company-context';
import { uuidField } from './validation';
import { parseOfferSnapshot } from '../documents/offer-pdf';

export type OfferSummary = { id: string; version: number; createdAt: string; validUntil: string; salePriceOre: string; vatScheme: 'standard' | 'vmb' | 'unknown' };
export type OfferListResult = { ok: boolean; message: string; companyId?: string; offers?: OfferSummary[]; nextBeforeVersion?: number };
export type OfferCreateResult = { ok: boolean; message: string; offerId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listDealOffersAction(dealId: string, expectedCompany?: string, beforeVersion?: number): Promise<OfferListResult> {
  if (typeof dealId !== 'string' || !uuid.test(dealId) || (expectedCompany !== undefined && (typeof expectedCompany !== 'string' || !uuid.test(expectedCompany))) || (beforeVersion !== undefined && (!Number.isSafeInteger(beforeVersion) || beforeVersion < 1))) return { ok: false, message: 'Affären är ogiltig. Öppna affärslistan igen.' };
  try {
    const { db, company } = await getActiveCompanyContext();
    if (expectedCompany && company.toLowerCase() !== expectedCompany.toLowerCase()) return { ok: false, message: 'Det aktiva företaget har ändrats. Öppna affärslistan igen.' };
    const { data: deal, error: dealError } = await db.from('deals').select('id').eq('company_id', company).eq('id', dealId).maybeSingle();
    if (dealError || !deal) return { ok: false, message: 'Affären kunde inte hämtas i det aktiva företaget.' };
    let query = db.from('offers').select('id,version,created_at,snapshot').eq('company_id', company).eq('deal_id', dealId).order('version', { ascending: false }).limit(51);
    if (beforeVersion !== undefined) query = query.lt('version', beforeVersion);
    const { data, error } = await query;
    if (error) return { ok: false, message: 'Offertversionerna kunde inte hämtas. Försök igen.' };
    const rows = (data ?? []).slice(0, 50);
    const offers = rows.map((row) => {
      const snapshot = parseOfferSnapshot(row.snapshot);
      return { id: row.id, version: row.version, createdAt: row.created_at, validUntil: snapshot.valid_until, salePriceOre: snapshot.sale_price_ore, vatScheme: snapshot.stock.vat_scheme };
    });
    return { ok: true, message: '', companyId: company, offers, nextBeforeVersion: (data?.length ?? 0) > 50 ? rows.at(-1)?.version : undefined };
  } catch { return { ok: false, message: 'Offertversionerna kunde inte hämtas. Kontrollera att du är inloggad i rätt företag och försök igen.' }; }
}

/** Actor and tenant come from verified auth/membership. The RPC snapshots all business data. */
export async function createOfferVersionAction(form: FormData): Promise<OfferCreateResult> {
  let deal: string, submission: string, expectedCompany: string, terms: string, validUntil: string;
  try {
    deal = uuidField(form, 'deal_id');
    submission = uuidField(form, 'submission_id');
    expectedCompany = uuidField(form, 'company_id');
    if (form.get('gross_confirmed') !== 'true') throw new Error('Bekräfta att affärspriset är totalpris inklusive eventuell moms innan du skapar offerten.');
    const rawTerms = form.get('terms'), rawDate = form.get('valid_until');
    if (typeof rawTerms !== 'string' || Array.from(rawTerms).length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(rawTerms)) throw new Error('Villkoren får innehålla högst 2000 tecken och inga kontrolltecken.');
    if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || rawDate.startsWith('0000')) throw new Error('Ange ett giltigt sista giltighetsdatum.');
    const parsed = new Date(`${rawDate}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== rawDate) throw new Error('Ange ett giltigt sista giltighetsdatum.');
    terms = rawTerms; validUntil = rawDate;
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Kontrollera offertens villkor och giltighetsdatum.' }; }
  try {
    const { db, company, role } = await getActiveCompanyContext();
    if (company.toLowerCase() !== expectedCompany.toLowerCase()) return { ok: false, message: 'Det aktiva företaget har ändrats. Öppna affärslistan igen.' };
    if (!['owner', 'admin', 'sales'].includes(role)) return { ok: false, message: 'Du har läsbehörighet och kan inte skapa en offertversion.' };
    const { data, error } = await db.rpc('create_offer_version', { company, deal, submission, terms, valid_until: validUntil, gross_confirmed: true });
    if (error) {
      const message = error.code === '42501' ? 'Du har inte behörighet att skapa offertversionen.' : error.code === '22023' ? 'Kontrollera att villkoren är högst 2000 tecken, datumet är inom 90 dagar och företagets kund- och fordonsuppgifter är giltiga. Använd samma underlag vid återförsök.' : error.code === 'P0002' ? 'Affären är inte tillgänglig i det aktiva företaget.' : 'Offertversionen kunde inte bekräftas. Försök igen med samma underlag.';
      return { ok: false, message };
    }
    if (typeof data !== 'string' || !uuid.test(data)) return { ok: false, message: 'Offertversionen kunde inte bekräftas. Försök igen med samma underlag.' };
    revalidatePath('/deals');
    return { ok: true, message: 'Offertversionen har sparats. Den skickas inte till kunden eller till en finanspartner.', offerId: data };
  } catch { return { ok: false, message: 'Offertversionen kunde inte bekräftas. Kontrollera din inloggning och försök igen med samma underlag.' }; }
}
