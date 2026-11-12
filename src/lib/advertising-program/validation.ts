import { z } from 'zod';
import type { Json } from '@/lib/supabase/database.types';

export const programDates = {
  desired_start: 'Önskad start', confirmed_start: 'Blockets bekräftade fakturastart',
  notice_date: 'Uppsägningsdatum', contract_end: 'Första dagen utanför avtalet', confirmed_end: 'Första dagen med ny fakturamottagare hos Blocket',
} as const;
export const programPrices = {
  blocket_price_ore: 'Kundpris Blocket per annons', bytbil_price_ore: 'Kundpris Bytbil per annons', monthly_fee_ore: 'Kundens butiksavgift per månad',
  blocket_cost_ore: 'Trafexas inköpspris Blocket per annons', bytbil_cost_ore: 'Trafexas inköpspris Bytbil per annons', monthly_cost_ore: 'Trafexas egen butiksavgift per månad',
} as const;
const dateKeys = Object.keys(programDates) as (keyof typeof programDates)[];
const priceKeys = Object.keys(programPrices) as (keyof typeof programPrices)[];
const uuid = z.uuid();
export const programPeriodSchema = z.object({
  period_id: uuid, cancelled: z.boolean(), version: z.number().int().positive(), agreement_reference: z.string(), partial_month_rule: z.enum(['full', 'prorated']).nullable(),
}).extend(Object.fromEntries(dateKeys.map(key => [key, z.iso.date().nullable()])) as Record<keyof typeof programDates, z.ZodNullable<z.ZodISODate>>)
  .extend(Object.fromEntries(priceKeys.map(key => [key, z.string().regex(/^\d+$/).nullable()])) as Record<keyof typeof programPrices, z.ZodNullable<z.ZodString>>);
export const programCompanySchema = z.object({ companyId: uuid, name: z.string(), organisationNumber: z.string(), stores: z.array(z.object({
  id: uuid, company_id: uuid, dealer_code: z.string(), store_name: z.string(), periods: z.array(programPeriodSchema),
})) });
export type ProgramPeriod = z.infer<typeof programPeriodSchema>;
export type ProgramCompany = z.infer<typeof programCompanySchema>;
export type ProgramOperation = 'store' | 'period' | 'cancel';
export type ProgramIdentity = { requestId: string; operation: ProgramOperation; storeId: string | null; periodId: string | null; expectedVersion: number };
export type ProgramSaveInput = ProgramIdentity & { actorId: string; companyId: string; fields: Record<string, string>; acknowledged: boolean };
export type ProgramReceipt = { actorId: string; requestId: string; companyId: string; storeId: string; periodId: string | null; version: number; operation: ProgramOperation };
export class ProgramValidationError extends Error {
  constructor(readonly fields: Record<string, string> = {}) { super('Kontrollera markerade uppgifter. Dina värden är kvar.'); }
}
const identitySchema = z.object({ requestId: uuid, operation: z.enum(['store', 'period', 'cancel']), storeId: uuid.nullable(), periodId: uuid.nullable(), expectedVersion: z.number().int().min(0).max(2147483646) }).strict();
export function parseProgramIdentity(value: unknown): ProgramIdentity {
  const result = identitySchema.safeParse(value);
  if (!result.success) throw new ProgramValidationError();
  const input = result.data;
  if (input.operation === 'store' ? input.storeId !== null || input.periodId !== null || input.expectedVersion !== 0 : input.storeId === null || input.periodId === null || input.operation === 'cancel' && input.expectedVersion < 1) throw new ProgramValidationError();
  return { ...input, requestId: input.requestId.toLowerCase(), storeId: input.storeId?.toLowerCase() ?? null, periodId: input.periodId?.toLowerCase() ?? null };
}
export function parseProgramSave(value: unknown): { input: ProgramSaveInput; payload: Record<string, Json> } {
  const result = z.object({ actorId: uuid, companyId: uuid, requestId: uuid, operation: z.enum(['store', 'period', 'cancel']), storeId: uuid.nullable(), periodId: uuid.nullable(), expectedVersion: z.number(), fields: z.record(z.string(), z.string().max(5000)), acknowledged: z.boolean() }).strict().safeParse(value);
  if (!result.success) throw new ProgramValidationError();
  const raw = result.data, { actorId, companyId, fields, acknowledged, ...identity } = raw;
  const input = { ...parseProgramIdentity(identity), actorId: actorId.toLowerCase(), companyId: companyId.toLowerCase(), fields, acknowledged };
  if (!acknowledged) throw new ProgramValidationError({ acknowledged: 'Bekräfta åtgärden innan du fortsätter.' });
  const allowed = input.operation === 'store' ? ['store_name', 'dealer_code'] : input.operation === 'cancel' ? [] : ['agreement_reference', 'partial_month_rule', ...dateKeys, ...priceKeys];
  if (Object.keys(fields).some(key => !allowed.includes(key)) || Object.keys(fields).length !== allowed.length) throw new ProgramValidationError();
  const errors: Record<string, string> = {}, payload: Record<string, Json> = {};
  const text = (key: string, max: number) => {
    const value = fields[key].trim();
    if (!value || value.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) errors[key] = `Ange en text med 1–${max} tecken.`;
    return value;
  };
  if (input.operation === 'store') {
    payload.store_name = text('store_name', 160); payload.dealer_code = text('dealer_code', 160);
  } else if (input.operation === 'cancel') {
    Object.assign(payload, { period_id: input.periodId, version: input.expectedVersion, cancelled: true });
  } else {
    Object.assign(payload, { period_id: input.periodId, version: input.expectedVersion, agreement_reference: text('agreement_reference', 300) });
    for (const key of dateKeys) {
      const value = fields[key].trim();
      if (!value && key !== 'desired_start') payload[key] = null;
      else if (value.startsWith('0000-') || !z.iso.date().safeParse(value).success) errors[key] = 'Ange ett giltigt datum.';
      else payload[key] = value;
    }
    for (const key of priceKeys) {
      const value = fields[key].trim();
      if (!value) payload[key] = null;
      else if (!/^\d{1,12}(?:[,.]\d{1,2})?$/.test(value)) errors[key] = 'Ange kronor utan valutasymbol, till exempel 620,00.';
      else { const [whole, fraction = ''] = value.split(/[,.]/); payload[key] = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString(); }
    }
    const rule = fields.partial_month_rule.trim();
    if (rule && rule !== 'full' && rule !== 'prorated') errors.partial_month_rule = 'Välj hur en delmånad ska debiteras.';
    else payload.partial_month_rule = rule || null;
  }
  if (Object.keys(errors).length) throw new ProgramValidationError(errors);
  return { input, payload };
}
export function parseProgramReceipt(value: unknown, expected: ProgramIdentity & { companyId: string; actorId: string }): ProgramReceipt {
  const receipt = z.object({ actorId: uuid, requestId: uuid, companyId: uuid, storeId: uuid, periodId: uuid.nullable(), version: z.number().int().nonnegative(), operation: z.enum(['store', 'period', 'cancel']) }).strict().parse(value);
  if (receipt.actorId !== expected.actorId || receipt.companyId !== expected.companyId || receipt.requestId !== expected.requestId || receipt.operation !== expected.operation || receipt.periodId !== expected.periodId || expected.storeId !== null && receipt.storeId !== expected.storeId || receipt.version !== (expected.operation === 'store' ? 0 : expected.expectedVersion + 1)) throw Error('Program receipt unavailable');
  return receipt;
}
export function periodDraft(period?: ProgramPeriod): Record<string, string> {
  return { agreement_reference: period?.agreement_reference ?? '', partial_month_rule: period?.partial_month_rule ?? '',
    ...Object.fromEntries(dateKeys.map(key => [key, period?.[key] ?? ''])),
    ...Object.fromEntries(priceKeys.map(key => { const raw = period?.[key]; if (raw == null) return [key, '']; const amount = BigInt(raw); return [key, `${amount / 100n},${String(amount % 100n).padStart(2, '0')}`]; })),
  };
}
