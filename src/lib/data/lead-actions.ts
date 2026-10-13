'use server';

import { revalidatePath } from 'next/cache';
import { getActiveCompanyContext } from './company-context';
import { enumField, requiredField, textField, uuidField } from './validation';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'closed';
export type LeadSummary = { id: string; status: LeadStatus; subject: string; createdAt: string; customer: { id: string; name: string; email: string | null; phone: string | null } | null };
export type LeadCursor = { createdAt: string; id: string };
export type LeadListResult = { ok: boolean; message: string; companyId?: string; leads?: LeadSummary[]; nextBefore?: LeadCursor };
export type LeadMutationResult = { ok: boolean; message: string; leadId?: string; conflict?: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses: LeadStatus[] = ['new', 'contacted', 'qualified', 'closed'];
const companyChanged = 'Det aktiva företaget har ändrats. Öppna kundlistan igen.';

function validCursor(value: unknown): value is LeadCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cursor = value as Partial<LeadCursor>;
  if (typeof cursor.id !== 'string' || !uuid.test(cursor.id) || typeof cursor.createdAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt)) return false;
  const date = new Date(`${cursor.createdAt.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(new Date(cursor.createdAt).getTime()) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === cursor.createdAt.slice(0, 10);
}

export async function listCustomerLeadsAction(expectedCompany: string, before?: LeadCursor): Promise<LeadListResult> {
  if (typeof expectedCompany !== 'string' || !uuid.test(expectedCompany) || (before !== undefined && !validCursor(before))) return { ok: false, message: 'Listans företag eller sidmarkör är ogiltig. Uppdatera kundlistan.' };
  try {
    const { db, company } = await getActiveCompanyContext();
    if (company.toLowerCase() !== expectedCompany.toLowerCase()) return { ok: false, message: companyChanged };
    let query = db.from('leads').select('id,status,subject,created_at,customers!leads_company_id_customer_id_fkey(id,name,email,phone)')
      .eq('company_id', company).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(51);
    if (before) query = query.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);
    const { data, error } = await query;
    if (error) return { ok: false, message: 'Kundförfrågningarna kunde inte hämtas. Försök igen.' };
    const rows = (data ?? []).slice(0, 50);
    const leads: LeadSummary[] = rows.map((row) => ({ id: row.id, status: row.status as LeadStatus, subject: row.subject, createdAt: row.created_at, customer: row.customers }));
    const last = leads.at(-1);
    return { ok: true, message: '', companyId: company, leads, nextBefore: (data?.length ?? 0) > 50 && last ? { createdAt: last.createdAt, id: last.id } : undefined };
  } catch { return { ok: false, message: 'Kundförfrågningarna kunde inte hämtas. Kontrollera din inloggning och företagsvalet.' }; }
}

/** The RPC derives the actor from auth.uid() and creates the contact and lead atomically. */
export async function createCustomerLeadAction(form: FormData): Promise<LeadMutationResult> {
  let expectedCompany: string, submission: string, name: string, email: string, phone: string, subject: string;
  try {
    expectedCompany = uuidField(form, 'company_id'); submission = uuidField(form, 'submission_id');
    name = requiredField(form, 'name', 2, 160); email = textField(form, 'email', 254).toLowerCase();
    phone = textField(form, 'phone', 60); subject = requiredField(form, 'subject', 1, 2000);
    if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('Ange namnet utan kontrolltecken.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ange en giltig e-postadress.');
    if (phone && (!/^[+0-9() .-]+$/.test(phone) || phone.replace(/[^0-9]/g, '').length < 3)) throw new Error('Ange ett giltigt telefonnummer.');
    if (!email && !phone) throw new Error('Ange e-post eller telefon så att kunden kan kontaktas.');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(subject)) throw new Error('Anteckningen innehåller ogiltiga kontrolltecken.');
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Kontrollera kundens uppgifter.' }; }
  try {
    const { db, company, role } = await getActiveCompanyContext();
    if (company.toLowerCase() !== expectedCompany.toLowerCase()) return { ok: false, message: companyChanged };
    if (!['owner', 'admin', 'sales'].includes(role)) return { ok: false, message: 'Din roll har läsbehörighet till kundförfrågningar.' };
    const { data, error } = await db.rpc('create_customer_lead', { company, submission, contact_name: name, contact_email: email, contact_phone: phone, lead_subject: subject });
    if (error) {
      const message = error.code === '42501' ? 'Du har inte längre behörighet att skapa kundförfrågningar.'
        : error.code === '22023' ? 'Kontrollera uppgifterna. Om underlaget har ändrats behöver du starta en ny förfrågan.'
        : error.code === 'P0001' ? 'Företaget har nått gränsen för nya förfrågningar. Försök igen senare.'
        : 'Sparandet kunde inte bekräftas. Försök igen med samma uppgifter inom sju dagar.';
      return { ok: false, message };
    }
    if (typeof data !== 'string' || !uuid.test(data)) return { ok: false, message: 'Sparandet kunde inte bekräftas. Försök igen med samma uppgifter inom sju dagar.' };
    revalidatePath('/customers'); revalidatePath('/dashboard');
    return { ok: true, message: 'Kundförfrågan och kontakten har sparats.', leadId: data };
  } catch { return { ok: false, message: 'Sparandet kunde inte bekräftas. Kontrollera din inloggning och försök igen med samma uppgifter inom sju dagar.' }; }
}

export async function updateLeadStatusAction(form: FormData): Promise<LeadMutationResult> {
  let lead: string, expectedCompany: string, previous: string, status: string;
  try {
    lead = uuidField(form, 'lead_id'); expectedCompany = uuidField(form, 'company_id');
    previous = enumField(form, 'previous_status', statuses); status = enumField(form, 'status', statuses);
    if (previous === status) throw new Error('Välj en annan status innan du sparar.');
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Välj en giltig förfrågan och status.' }; }
  try {
    const { db, company, role } = await getActiveCompanyContext();
    if (company.toLowerCase() !== expectedCompany.toLowerCase()) return { ok: false, message: companyChanged };
    if (!['owner', 'admin', 'sales'].includes(role)) return { ok: false, message: 'Din roll har läsbehörighet till kundförfrågningar.' };
    const { data, error } = await db.from('leads').update({ status }).eq('company_id', company).eq('id', lead).eq('status', previous).select('id');
    if (error) return { ok: false, message: error.code === '42501' ? 'Du har inte längre behörighet att uppdatera förfrågan.' : 'Statusen kunde inte sparas. Uppdatera listan och försök igen.' };
    if (!data?.length) return { ok: false, conflict: true, message: 'Statusen har ändrats eller förfrågan är inte längre tillgänglig. Listan uppdateras; kontrollera aktuell status innan du försöker igen.' };
    revalidatePath('/customers');
    return { ok: true, message: 'Statusen har sparats.', leadId: lead };
  } catch { return { ok: false, message: 'Statusen kunde inte bekräftas. Uppdatera listan innan du försöker igen.' }; }
}
