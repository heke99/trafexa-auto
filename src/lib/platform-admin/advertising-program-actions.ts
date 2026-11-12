'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { PlatformAdminError, requirePlatformAdminContext } from './context';
import { parseProgramIdentity, parseProgramReceipt, parseProgramSave, ProgramValidationError } from '@/lib/advertising-program/validation';
import type { ProgramIdentity, ProgramReceipt } from '@/lib/advertising-program/validation';

type Failure = { ok: false; code: 'invalid_input' | 'conflict' | 'overlap' | 'duplicate' | 'unauthenticated' | 'access_denied' | 'unavailable'; message: string; fields?: Record<string, string> };
function failure(error: unknown): Failure {
  if (error instanceof ProgramValidationError) return { ok: false, code: 'invalid_input', message: error.message, fields: error.fields };
  if (error instanceof PlatformAdminError) return { ok: false, code: error.code === 'unauthenticated' ? 'unauthenticated' : error.code === 'forbidden' ? 'access_denied' : 'unavailable', message: error.code === 'unauthenticated' ? 'Din session har gått ut. Logga in i en ny flik och återvänd hit. Dina uppgifter är kvar.' : error.code === 'forbidden' ? 'Du har inte längre tillgång till annonsprogrammet.' : 'Resultatet kunde inte verifieras. Kontrollera samma sparning innan du fortsätter.' };
  const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const code = raw === '42501' ? 'access_denied' : raw === '40001' ? 'conflict' : raw === '23P01' ? 'overlap' : raw === '23505' ? 'duplicate' : ['22023', '22P02', '23514', '23502', '22003', '22007', '22008'].includes(raw) ? 'invalid_input' : 'unavailable';
  const messages = { access_denied: 'Du har inte längre tillgång till annonsprogrammet.', conflict: 'Avtalet eller begäran har ändrats. Läs in aktuellt underlag innan du granskar en ny ändring.', overlap: 'Perioden överlappar ett annat avtal för butiken. Dina värden är kvar.', duplicate: 'Butikskoden är redan registrerad. Dina värden är kvar.', invalid_input: 'Kontrollera datum, belopp och avtalsuppgifter. Dina värden är kvar.', unavailable: 'Resultatet kunde inte verifieras. Kontrollera samma sparning innan du fortsätter.' };
  return { ok: false, code, message: messages[code] };
}
async function fresh(actorId: string) {
  if ((await currentActor()).userId !== actorId) throw new PlatformAdminError('forbidden');
}
async function currentActor() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([requirePlatformAdminContext(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new PlatformAdminError('unavailable')), 15000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function refresh(companyId: string) { try { revalidatePath(`/admin/annonsprogram/${companyId}`); } catch { /* A durable receipt does not depend on cache refresh. */ } }

export async function saveAdvertisingProgramRequestAction(value: unknown): Promise<{ ok: true; receipt: ProgramReceipt } | Failure> {
  try {
    const { input, payload } = parseProgramSave(value);
    const actor = await currentActor();
    if (actor.userId !== input.actorId) throw new PlatformAdminError('forbidden');
    const result = await actor.db.rpc('save_advertising_program_request', { p_company: input.companyId, p_store: input.storeId, p_input: payload, p_request_id: input.requestId }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) throw result.error;
    const receipt = parseProgramReceipt(result.data, { ...input, actorId: actor.userId });
    await fresh(actor.userId); refresh(input.companyId);
    return { ok: true, receipt };
  } catch (error) { return failure(error); }
}

/** Explicit recovery may close a missing request, preventing a delayed write. */
export async function resolveAdvertisingProgramRequestAction(value: unknown): Promise<{ ok: true; state: 'saved'; receipt: ProgramReceipt } | { ok: true; state: 'not_saved' } | Failure> {
  try {
    const outer = z.object({ actorId: z.uuid(), companyId: z.uuid(), identity: z.unknown() }).strict().safeParse(value);
    if (!outer.success) throw new ProgramValidationError();
    const companyId = outer.data.companyId.toLowerCase(), identity: ProgramIdentity = parseProgramIdentity(outer.data.identity);
    const actor = await currentActor();
    if (actor.userId !== outer.data.actorId.toLowerCase()) throw new PlatformAdminError('forbidden');
    const result = await actor.db.rpc('resolve_advertising_program_request', { p_company: companyId, p_request_id: identity.requestId }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) throw result.error;
    const row = z.object({ actorId: z.uuid(), companyId: z.uuid(), requestId: z.uuid(), state: z.enum(['saved', 'not_saved']), receipt: z.unknown() }).strict().parse(result.data);
    if (row.actorId !== actor.userId || row.companyId !== companyId || row.requestId !== identity.requestId) throw Error('Program request scope unavailable');
    const receipt = row.state === 'saved' ? parseProgramReceipt(row.receipt, { ...identity, companyId, actorId: actor.userId }) : null;
    if (row.state === 'not_saved' && row.receipt !== null) throw Error('Invalid unresolved program receipt');
    await fresh(actor.userId);
    if (receipt) { refresh(companyId); return { ok: true, state: 'saved', receipt }; }
    return { ok: true, state: 'not_saved' };
  } catch (error) { return failure(error); }
}
