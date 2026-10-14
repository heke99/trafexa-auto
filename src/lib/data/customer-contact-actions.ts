'use server';

import { revalidatePath } from 'next/cache';
import { requireCrmContext, CrmError, type CrmContext } from '@/lib/crm/context';
import type { Contact, ContactPage, ContactKind, CrmResult } from '@/lib/crm/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  return value as Record<string, unknown>;
}
function input(value: unknown, keys: string[]) {
  const row = record(value);
  if (Object.keys(row).some((key) => !keys.includes(key))) throw new Error('invalid');
  return row;
}
function id(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('invalid'); return value.toLowerCase(); }
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') throw new Error('invalid');
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('invalid');
  return value;
}
function text(value: unknown, min: number, max: number, multiline = true): string {
  if (typeof value !== 'string') throw new Error('invalid');
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(normalized)) throw new Error('invalid');
  return normalized;
}
function contact(value: unknown, ctx: CrmContext, customerId?: string, followup = false): Contact {
  const row = record(value);
  const companyId = id(row.companyId), actualCustomer = id(row.customerId), actor = id(row.createdBy);
  if (companyId !== ctx.companyId || customerId && actualCustomer !== customerId || !['call', 'email', 'meeting', 'note'].includes(String(row.kind)) || !['none', 'pending', 'done', 'cancelled'].includes(String(row.followUpStatus))) throw new Error('invalid');
  const contactOn = date(row.contactOn), followUpOn = row.followUpOn === null ? null : date(row.followUpOn);
  if (followUpOn !== null && followUpOn < contactOn || (followUpOn === null) !== (row.followUpStatus === 'none') || !Number.isSafeInteger(row.version) || Number(row.version) < 1 || Number(row.version) > 2147483647 || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw new Error('invalid');
  return { id: id(row.id), companyId, customerId: actualCustomer, kind: row.kind as ContactKind, contactOn, summary: text(row.summary, 2, 2000), followUpOn, followUpStatus: row.followUpStatus as Contact['followUpStatus'], version: row.version as number, createdAt: row.createdAt, actorLabel: actor === ctx.userId ? 'Du' : 'Kollega', ...(followup ? { customerName: text(row.customerName, 1, 160, false) } : {}) };
}
function failure(error: unknown, validation = false): CrmResult<never> {
  const code = error instanceof CrmError ? error.code : validation ? 'invalid_input' : recordCode(error);
  return { ok: false, code, message: code === 'invalid_input' ? 'Kontrollera kontaktens uppgifter och datum.' : code === 'conflict' ? 'Underlaget har ändrats. Uppdatera listan innan du försöker igen.' : code === 'access_denied' || code === 'unauthenticated' ? 'Din inloggning eller kundbehörighet kunde inte verifieras. Öppna kundlistan igen.' : 'Resultatet kunde inte bekräftas. Uppdatera listan; försök vid behov igen med samma uppgifter och samma begäran.' };
}
function recordCode(error: unknown): 'conflict' | 'access_denied' | 'unavailable' {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return code === '40001' ? 'conflict' : code === '42501' ? 'access_denied' : 'unavailable';
}
function assertScope(value: Record<string, unknown>, ctx: CrmContext) {
  if (id(value.companyId) !== ctx.companyId || id(value.actorUserId) !== ctx.userId || value.actorRole !== ctx.role) throw new Error('invalid scope');
}
async function list(value: unknown, followups: boolean): Promise<CrmResult<ContactPage>> {
  let companyId: string, customerId: string | undefined, pageKey: string | null, filter: string = 'due';
  try {
    const row = input(value, followups ? ['companyId', 'filter', 'pageKey'] : ['companyId', 'customerId', 'pageKey']);
    companyId = id(row.companyId); customerId = followups ? undefined : id(row.customerId); pageKey = row.pageKey === undefined || row.pageKey === null ? null : id(row.pageKey);
    if (followups) { if (!['due', 'upcoming', 'all'].includes(String(row.filter))) throw new Error('invalid'); filter = row.filter as string; }
  } catch (error) { return failure(error, true); }
  try {
    const ctx = await requireCrmContext(companyId);
    const response = followups
      ? await ctx.db.rpc('list_customer_follow_ups', { p_company_id: companyId, p_filter: filter, p_page_key: pageKey, p_limit: 50 })
      : await ctx.db.rpc('list_customer_contacts', { p_company_id: companyId, p_customer_id: customerId!, p_page_key: pageKey, p_limit: 50 });
    if (response.error) throw response.error;
    const page = record(response.data); assertScope(page, ctx);
    const businessDate = date(page.businessDate);
    if (!Array.isArray(page.contacts) || page.contacts.length > 50) throw new Error('invalid');
    const contacts = page.contacts.map((row) => contact(row, ctx, customerId, followups));
    if (new Set(contacts.map((row) => row.id)).size !== contacts.length || contacts.some((row) => row.contactOn > businessDate)) throw new Error('invalid');
    if (followups && contacts.some((row) => row.followUpStatus !== 'pending' || !row.followUpOn || filter === 'due' && row.followUpOn > businessDate || filter === 'upcoming' && row.followUpOn <= businessDate)) throw new Error('invalid');
    const nextPageKey = page.nextPageKey === null ? null : id(page.nextPageKey);
    if (nextPageKey !== null && (contacts.length !== 50 || nextPageKey !== contacts.at(-1)?.id)) throw new Error('invalid');
    const fresh = await requireCrmContext(companyId);
    if (fresh.userId !== ctx.userId || fresh.role !== ctx.role) throw new CrmError('access_denied');
    return { ok: true, companyId, businessDate, contacts, nextPageKey };
  } catch (error) { return failure(error); }
}
export async function listCustomerContactsAction(value: { companyId: string; customerId: string; pageKey?: string | null }): Promise<CrmResult<ContactPage>> { return list(value, false); }
export async function listCustomerFollowUpsAction(value: { companyId: string; filter: 'due' | 'upcoming' | 'all'; pageKey?: string | null }): Promise<CrmResult<ContactPage>> { return list(value, true); }

export async function createCustomerContactAction(value: { companyId: string; customerId: string; kind: ContactKind; contactOn: string; summary: string; followUpOn: string | null; requestId: string }): Promise<CrmResult<{ contact: Contact }>> {
  let args: { companyId: string; customerId: string; kind: ContactKind; contactOn: string; summary: string; followUpOn: string | null; requestId: string };
  try {
    const row = input(value, ['companyId', 'customerId', 'kind', 'contactOn', 'summary', 'followUpOn', 'requestId']);
    if (!['call', 'email', 'meeting', 'note'].includes(String(row.kind))) throw new Error('invalid');
    args = { companyId: id(row.companyId), customerId: id(row.customerId), kind: row.kind as ContactKind, contactOn: date(row.contactOn), summary: text(row.summary, 2, 2000), followUpOn: row.followUpOn === null ? null : date(row.followUpOn), requestId: id(row.requestId) };
    if (args.followUpOn && args.followUpOn < args.contactOn) throw new Error('invalid');
  } catch (error) { return failure(error, true); }
  try {
    const ctx = await requireCrmContext(args.companyId, 'write');
    const { data, error } = await ctx.db.rpc('create_customer_contact', { p_company_id: args.companyId, p_customer_id: args.customerId, p_kind: args.kind, p_contact_on: args.contactOn, p_summary: args.summary, p_follow_up_on: args.followUpOn, p_request_id: args.requestId });
    if (error) throw error;
    const receipt = record(data);
    if (id(receipt.companyId) !== ctx.companyId || id(receipt.actorUserId) !== ctx.userId || id(receipt.requestId) !== args.requestId) throw new Error('invalid receipt');
    const saved = contact(receipt.contact, ctx, args.customerId);
    if (saved.kind !== args.kind || saved.contactOn !== args.contactOn || saved.summary !== args.summary || saved.followUpOn !== args.followUpOn || saved.version !== 1 || saved.actorLabel !== 'Du' || saved.followUpStatus !== (args.followUpOn ? 'pending' : 'none')) throw new Error('invalid receipt');
    const fresh = await requireCrmContext(args.companyId, 'write');
    if (fresh.userId !== ctx.userId) throw new CrmError('access_denied');
    revalidatePath('/customers'); revalidatePath('/dashboard');
    return { ok: true, contact: saved };
  } catch (error) { return failure(error); }
}

export async function updateCustomerFollowUpAction(value: { companyId: string; customerId: string; contactId: string; expectedVersion: number; status: 'done' | 'cancelled'; reason: string; requestId: string }): Promise<CrmResult<{ contact: Contact }>> {
  let args: typeof value;
  try {
    const row = input(value, ['companyId', 'customerId', 'contactId', 'expectedVersion', 'status', 'reason', 'requestId']);
    if (!['done', 'cancelled'].includes(String(row.status)) || !Number.isSafeInteger(row.expectedVersion) || Number(row.expectedVersion) < 1 || Number(row.expectedVersion) >= 2147483647) throw new Error('invalid');
    args = { companyId: id(row.companyId), customerId: id(row.customerId), contactId: id(row.contactId), expectedVersion: row.expectedVersion as number, status: row.status as 'done' | 'cancelled', reason: text(row.reason, 2, 500, false), requestId: id(row.requestId) };
  } catch (error) { return failure(error, true); }
  try {
    const ctx = await requireCrmContext(args.companyId, 'write');
    const { data, error } = await ctx.db.rpc('update_customer_follow_up', { p_company_id: args.companyId, p_customer_id: args.customerId, p_contact_id: args.contactId, p_expected_version: args.expectedVersion, p_status: args.status, p_reason: args.reason, p_request_id: args.requestId });
    if (error) throw error;
    const receipt = record(data);
    if (id(receipt.companyId) !== ctx.companyId || id(receipt.actorUserId) !== ctx.userId || id(receipt.requestId) !== args.requestId) throw new Error('invalid receipt');
    const saved = contact(receipt.contact, ctx, args.customerId);
    if (saved.id !== args.contactId || saved.version !== args.expectedVersion + 1 || saved.followUpStatus !== args.status || saved.followUpOn === null) throw new Error('invalid receipt');
    const fresh = await requireCrmContext(args.companyId, 'write');
    if (fresh.userId !== ctx.userId) throw new CrmError('access_denied');
    revalidatePath('/customers'); revalidatePath('/dashboard');
    return { ok: true, contact: saved };
  } catch (error) { return failure(error); }
}
