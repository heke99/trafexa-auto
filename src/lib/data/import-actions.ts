'use server';

import { revalidatePath } from 'next/cache';
import { getActiveCompanyContext } from './company-context';
import { canManageStockIntake } from '@/lib/access/dealer-capabilities';
import { MAX_IMPORT_BYTES, parseStockCsv, validateStockRows, type ImportIssue, type StockMapping } from './stock-import.mjs';

export type StockImportResult = { ok: boolean; message: string; count?: number; issues?: ImportIssue[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function reviewStockImportAction(form: FormData): Promise<StockImportResult> {
  const text = form.get('csv'), rawMapping = form.get('mapping'), expectedCompany = form.get('company_id');
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES || typeof rawMapping !== 'string' || rawMapping.length > 4000 || typeof expectedCompany !== 'string' || !uuid.test(expectedCompany)) return { ok: false, message: 'Importunderlaget är ogiltigt.' };
  let mapping: StockMapping;
  try {
    const input: unknown = JSON.parse(rawMapping);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid mapping');
    mapping = input as StockMapping;
  } catch { return { ok: false, message: 'Kolumnmappningen är ogiltig.' }; }
  const parsed = parseStockCsv(text), checked = validateStockRows(parsed, mapping);
  if (!checked.canImport) return { ok: false, message: 'Rätta radfelen innan du fortsätter.', issues: checked.issues };
  try {
    const { db, company, role } = await getActiveCompanyContext();
    if (!canManageStockIntake(role)) return { ok: false, message: 'Endast företagets ägare och administratörer kan granska lagerimporter.' };
    if (company.toLowerCase() !== expectedCompany.toLowerCase()) return { ok: false, message: 'Det aktiva företaget har ändrats. Öppna lagerimporten igen.' };
    const { data, error } = await db.rpc('stock_import_duplicate_registrations', { company, registrations: checked.rows.map((row) => row.registration_number) });
    if (error) return { ok: false, message: 'Befintligt lager kunde inte kontrolleras. Försök igen.' };
    const reviewed = validateStockRows(parsed, mapping, data ?? []);
    return { ok: reviewed.canImport, message: reviewed.canImport ? 'Hela företagets lager har kontrollerats. Inga dubbletter hittades.' : 'Rätta dubbletterna innan du fortsätter.', issues: reviewed.issues };
  } catch (error) { return { ok: false, message: error instanceof Error && !('code' in error) ? error.message : 'Lagret kunde inte kontrolleras. Försök igen.' }; }
}

/** Inputs are re-parsed on the server. Browser previews never authorize writes. */
export async function importStockAction(form: FormData): Promise<StockImportResult> {
  const text = form.get('csv');
  const rawMapping = form.get('mapping');
  const submission = form.get('submission_id');
  const expectedCompany = form.get('company_id');
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES || typeof rawMapping !== 'string' || rawMapping.length > 4000 || typeof submission !== 'string' || !uuid.test(submission) || typeof expectedCompany !== 'string' || !uuid.test(expectedCompany)) {
    return { ok: false, message: 'Importunderlaget är ogiltigt. Välj filen igen och kontrollera kolumnerna.' };
  }
  let mapping: StockMapping;
  try {
    const input: unknown = JSON.parse(rawMapping);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid mapping');
    mapping = input as StockMapping;
  } catch { return { ok: false, message: 'Kolumnmappningen är ogiltig.' }; }
  const parsed = parseStockCsv(text);
  const checked = validateStockRows(parsed, mapping);
  if (!checked.canImport) return { ok: false, message: 'Rätta radfelen innan du importerar. Inga bilar har sparats.', issues: checked.issues };
  try {
    const { db, company, role } = await getActiveCompanyContext();
    if (!canManageStockIntake(role)) return { ok: false, message: 'Endast företagets ägare och administratörer kan importera lagerinköp.' };
    if (company.toLowerCase() !== expectedCompany.toLowerCase()) return { ok: false, message: 'Det aktiva företaget har ändrats. Öppna lagerimporten igen.' };
    const registrations = checked.rows.map((row) => row.registration_number);
    const { data: existing, error: lookupError } = await db.rpc('stock_import_duplicate_registrations', { company, registrations });
    if (lookupError) return { ok: false, message: 'Befintligt lager kunde inte kontrolleras. Inga bilar har sparats.' };
    const duplicateReview = validateStockRows(parsed, mapping, existing ?? []);
    // The RPC checks its receipt before duplicates, so a lost successful response can
    // be retried with the same UUID and normalized payload even after stock exists.
    const { data, error } = await db.rpc('import_stock_batch', { company, submission, payload: checked.rows });
    if (error) {
      if (error.code === '23505') return { ok: false, message: 'Ett registreringsnummer finns redan i lagret. Hela importen avvisades.', issues: duplicateReview.issues.length ? duplicateReview.issues : [{ row: null, field: 'registration_number', message: 'Lagret ändrades under importen. Förhandsgranska filen igen.' }] };
      if (error.code === '42501') return { ok: false, message: 'Du har inte längre behörighet att importera till företaget.' };
      if (error.message === 'Import submission payload changed') return { ok: false, message: 'Importunderlaget har ändrats. Välj filen igen för att starta en ny import.' };
      if (error.message === 'Import limit reached') return { ok: false, message: 'För många importer på kort tid. Försök igen senare.' };
      return { ok: false, message: 'Importen kunde inte sparas. Inga bilar har sparats. Kontrollera underlaget och försök igen.' };
    }
    if (!Number.isInteger(data) || data !== checked.rows.length) return { ok: false, message: 'Importens resultat kunde inte bekräftas. Försök igen med samma underlag.' };
    revalidatePath('/inventory');
    revalidatePath('/dashboard');
    return { ok: true, count: data, message: `${data} bilar finns nu i lagret efter importen.` };
  } catch (error) { return { ok: false, message: error instanceof Error && !('code' in error) ? error.message : 'Importen kunde inte kontrolleras. Försök igen.' }; }
}
