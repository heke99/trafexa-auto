'use server';
import { revalidatePath } from 'next/cache';
import { requireOwnershipContext, type OwnershipContext } from './context';
import { CompanyTeamError } from '../company-team/context';
import { AccountAccessError } from '../account-access/context';
import { acknowledgment, input, object, output, OwnershipError, page, reason, transfer, uuid, version } from './validation';
import { OWNERSHIP_ATTESTATION_VERSION, type OwnershipPage, type OwnershipReceipt, type OwnershipResult } from './types';

function rpcError(error: { code?: string } | null) {
  if (error) throw new OwnershipError(error.code === '42501' ? 'access_denied' : error.code === '40001' || error.code === '23505' ? 'conflict' : error.code === '22023' ? 'invalid_input' : 'unavailable');
}
function failure(error: unknown): OwnershipResult<never> {
  const code = error instanceof CompanyTeamError || error instanceof AccountAccessError || error instanceof OwnershipError ? error.code : 'unavailable';
  const messages = { unauthenticated: 'Logga in igen för att fortsätta.', access_denied: 'Din behörighet till företagets ägarroll kunde inte verifieras.', invalid_input: 'Kontrollera uppgifterna och bekräfta granskningen.', conflict: 'Ägarrollen, teamet eller begäran har ändrats. Läs in och granska aktuella uppgifter igen.', unavailable: 'Resultatet kunde inte verifieras. Försök igen med samma uppgifter och begäran.' };
  return { ok: false, code, message: messages[code] };
}
async function fresh(context: OwnershipContext, sameRole = false) {
  const current = await requireOwnershipContext(context.companyId);
  if (current.userId !== context.userId || sameRole && current.role !== context.role) throw new OwnershipError('access_denied');
}
function refresh() {
  try { revalidatePath('/settings'); revalidatePath('/dashboard'); } catch { /* The durable receipt remains valid. */ }
}
export async function getCompanyOwnershipTransferAction(value: unknown): Promise<OwnershipResult<OwnershipPage>> {
  try {
    const row = input(value, ['companyId', 'pageKey', 'limit']), companyId = uuid(row.companyId), after = row.pageKey == null ? null : uuid(row.pageKey);
    const limit = row.limit ?? 50;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new OwnershipError('invalid_input');
    const context = await requireOwnershipContext(companyId);
    const result = await context.db.rpc('get_company_ownership_transfer', { p_company_id: companyId, p_page_key: after, p_limit: limit });
    rpcError(result.error);
    const current = output(() => page(result.data, companyId, context.userId, context.role, after, limit));
    await fresh(context, true);
    return { ok: true, ...current };
  } catch (error) { return failure(error); }
}
const keys = ['companyId', 'transferId', 'expectedVersion', 'expectedTeamVersion', 'acknowledged', 'attestationVersion', 'requestId'];
export async function requestCompanyOwnershipTransferAction(value: unknown): Promise<OwnershipResult<{ receipt: OwnershipReceipt }>> { return mutate('request', value); }
export async function acceptCompanyOwnershipTransferAction(value: unknown): Promise<OwnershipResult<{ receipt: OwnershipReceipt }>> { return mutate('accept', value); }
export async function cancelCompanyOwnershipTransferAction(value: unknown): Promise<OwnershipResult<{ receipt: OwnershipReceipt }>> { return mutate('cancel', value); }
async function mutate(action: 'request' | 'accept' | 'cancel', value: unknown): Promise<OwnershipResult<{ receipt: OwnershipReceipt }>> {
  try {
    const row = input(value, action === 'request' ? ['companyId', 'targetMembershipId', 'expectedOwnerVersion', 'expectedTargetVersion', 'expectedTeamVersion', 'reason', 'acknowledged', 'attestationVersion', 'requestId'] : action === 'cancel' ? [...keys, 'reason'] : keys);
    const companyId = uuid(row.companyId), requestId = uuid(row.requestId), expectedTeamVersion = version(row.expectedTeamVersion);
    acknowledgment(row);
    const text = action === 'accept' ? null : reason(row.reason);
    const targetMembershipId = action === 'request' ? uuid(row.targetMembershipId) : null;
    const expectedOwnerVersion = action === 'request' ? version(row.expectedOwnerVersion) : null, expectedTargetVersion = action === 'request' ? version(row.expectedTargetVersion) : null;
    const transferId = action === 'request' ? null : uuid(row.transferId), expectedVersion = action === 'request' ? null : version(row.expectedVersion);
    const context = await requireOwnershipContext(companyId);
    const common = { p_company_id: companyId, p_expected_team_version: expectedTeamVersion, p_acknowledged: true, p_attestation_version: OWNERSHIP_ATTESTATION_VERSION, p_request_id: requestId };
    const result = action === 'request'
      ? await context.db.rpc('request_company_ownership_transfer', { ...common, p_target_membership_id: targetMembershipId!, p_expected_owner_version: expectedOwnerVersion!, p_expected_target_version: expectedTargetVersion!, p_reason: text! })
      : action === 'accept'
        ? await context.db.rpc('accept_company_ownership_transfer', { ...common, p_transfer_id: transferId!, p_expected_version: expectedVersion! })
        : await context.db.rpc('cancel_company_ownership_transfer', { ...common, p_transfer_id: transferId!, p_expected_version: expectedVersion!, p_reason: text! });
    rpcError(result.error);
    const receipt = output(() => {
      const raw = object(result.data), current = transfer(raw.transfer, companyId);
      if (uuid(raw.companyId) !== companyId || uuid(raw.actorUserId) !== context.userId || uuid(raw.requestId) !== requestId || version(raw.teamVersion) !== expectedTeamVersion + 1) throw Error('Invalid receipt');
      if (action === 'request' ? current.status !== 'pending' || current.version !== 1 || current.from.userId !== context.userId || current.to.membershipId !== targetMembershipId || current.from.version !== expectedOwnerVersion || current.to.version !== expectedTargetVersion || current.reason !== text || current.teamVersionAtRequest !== expectedTeamVersion + 1
        : current.id !== transferId || current.version !== expectedVersion! + 1 || current.status !== (action === 'accept' ? 'accepted' : 'cancelled') || (action === 'accept' ? current.to.userId !== context.userId : current.from.userId !== context.userId || current.cancelReason !== text)) throw Error('Invalid receipt binding');
      return { companyId, actorUserId: context.userId, requestId, teamVersion: version(raw.teamVersion), transfer: current };
    });
    // Accepted ownership changes the recipient's role; historical role labels are not authority.
    await fresh(context);
    refresh(); return { ok: true, receipt };
  } catch (error) { return failure(error); }
}
