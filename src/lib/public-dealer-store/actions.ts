'use server';
import { revalidatePath } from 'next/cache';
import { requirePublicStoreContext } from './context';
import { PublicStoreError, parsePublicStoreReadInput, parsePublishPublicStoreInput, parseUnpublishPublicStoreInput, parsePublicStorePage, parsePublicStoreReceipt } from './validation';
import type { PublicStoreCode, PublicStorePage, PublicStoreReceipt, PublicStoreResult } from './types';
function failure(error: unknown): PublicStoreResult<never> {
  const raw = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const code: PublicStoreCode = raw === 'unauthenticated' ? raw : raw === 'access_denied' || raw === '42501' ? 'access_denied' : raw === 'invalid_input' || raw === '22023' ? 'invalid_input' : raw === 'conflict' || raw === '40001' || raw === '23505' ? 'conflict' : 'unavailable';
  const messages = { unauthenticated: 'Logga in igen för att fortsätta.', access_denied: 'Din aktuella åtkomst till butiken kunde inte verifieras.', invalid_input: 'Kontrollera butikens adress och valda uppgifter och bekräfta granskningen.', conflict: 'Butiken, profilen eller en vald annons har ändrats. Läs in och granska uppgifterna igen.', unavailable: 'Resultatet kunde inte verifieras. Försök igen med samma uppgifter och begäran.' };
  return { ok: false, code, message: messages[code] };
}
async function fresh(ctx: Awaited<ReturnType<typeof requirePublicStoreContext>>) {
  const now = await requirePublicStoreContext(ctx.companyId);
  if (now.userId !== ctx.userId || now.role !== ctx.role) throw new PublicStoreError('access_denied');
}
export async function getCompanyPublicStoreAction(value: unknown): Promise<PublicStoreResult<PublicStorePage>> {
  try { const input = parsePublicStoreReadInput(value), ctx = await requirePublicStoreContext(input.companyId);
    const result = await ctx.db.rpc('get_company_public_store', { p_company_id: input.companyId }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) throw result.error; const page = parsePublicStorePage(result.data, ctx); await fresh(ctx); return { ok:true, ...page };
  } catch(error) { return failure(error); }
}
export async function publishCompanyPublicStoreAction(value: unknown): Promise<PublicStoreResult<{receipt:PublicStoreReceipt}>> { return mutate('publish',value); }
export async function unpublishCompanyPublicStoreAction(value: unknown): Promise<PublicStoreResult<{receipt:PublicStoreReceipt}>> { return mutate('unpublish',value); }
async function mutate(action:'publish'|'unpublish', value:unknown):Promise<PublicStoreResult<{receipt:PublicStoreReceipt}>> {
  try { const publishing = action === 'publish' ? parsePublishPublicStoreInput(value) : null;
    const input = publishing ?? parseUnpublishPublicStoreInput(value), ctx = await requirePublicStoreContext(input.companyId);
    const common = { p_company_id: input.companyId, p_expected_version: input.expectedVersion, p_acknowledged:true, p_request_id:input.requestId };
    const result = publishing ? await ctx.db.rpc('publish_company_public_store', { ...common, p_slug:publishing.slug, p_profile_version:publishing.profileVersion, p_listings:publishing.listings }).abortSignal(AbortSignal.timeout(15000)) : await ctx.db.rpc('unpublish_company_public_store', common).abortSignal(AbortSignal.timeout(15000));
    if(result.error) throw result.error; const receipt = parsePublicStoreReceipt(result.data,ctx,input,action); await fresh(ctx);
    try { revalidatePath('/settings'); revalidatePath('/handlare/'+receipt.store.slug); } catch { /* The durable receipt remains valid. */ }
    return { ok:true, receipt };
  } catch(error) { return failure(error); }
}
