import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';
const COMPANY = '10000000-0000-4000-8000-000000000001', STOCK = '20000000-0000-4000-8000-000000000001', USER = '30000000-0000-4000-8000-000000000001', OTHER = '40000000-0000-4000-8000-000000000001';
const source = { companyId: COMPANY, stockItemId: STOCK, version: '1', purchaseGrossOre: '10000000', saleGrossOre: '12500000', vatScheme: 'standard', purchaseVatOre: '2000000', vatBasisConfirmed: false, costs: [] };
async function fixture(options = {}) {
  const calls = [], invalidations = [];
  const state = { role: options.role ?? 'owner', approval: 'approved', user: options.user === undefined ? { id: USER, email: 'dealer@example.invalid', is_anonymous: false, email_confirmed_at: '2026-10-13T12:00:00Z' } : options.user };
  const db = { auth: { getUser: async () => { calls.push('auth'); return { data: { user: state.user }, error: null }; } },
    from(table) { assert.equal(table, 'memberships'); const query={select(){return query;},eq(){return query;},async maybeSingle(){calls.push('membership');return{data:{company_id:COMPANY,user_id:USER,role:state.role,status:'active',companies:{id:COMPANY,status:'active'}},error:null};}};return query;},
    rpc: async (name, args) => {
      if(name==='get_account_access'){calls.push('approval');return{data:{userId:state.user.id,email:state.user.email,emailVerified:Boolean(state.user.email_confirmed_at),status:state.approval,version:1,isPlatformAdmin:false},error:null};}
      calls.push({ name, args }); if (options.throws) throw new Error('private service key');
      options.afterRpc?.(state); return { data: options.source ?? source, error: options.error ?? null };
    } };
  const selected={getActiveCompanyContext:async()=>({db,user:USER,company:COMPANY,role:options.role??'owner'})};
  const loader = await createSourceLoader({ './company-context': selected, '@/lib/data/company-context':selected, '@/lib/supabase/server':{createServerSupabaseClient:async()=>db}, 'next/cache': { revalidatePath: path => invalidations.push(path) } });
  return { actions: loader.load('./src/lib/data/calculation-actions.ts'), calls, invalidations, state };
}
test('live calculations use only exact scoped RPC source after fresh Auth, never posted amounts', async () => {
  const { actions, calls } = await fixture();
  const result = await actions.getVehicleCalculationAction({ stockItemId: STOCK, companyId: COMPANY });
  assert.equal(result.ok, true); assert.equal(result.calculation.netResultOre, '2000000');
  assert.deepEqual(calls.filter(call=>typeof call==='object'), [{ name: 'get_vehicle_calculation', args: { p_company_id: COMPANY, p_stock_item_id: STOCK } }]);
  assert.equal(calls.filter(call=>call==='auth').length,4);
  assert.equal((await actions.getVehicleCalculationAction({ stockItemId: STOCK, saleGrossOre: '1' })).ok, false);
});
test('wrong company, unauthenticated user, identity mismatch and anonymous users never reach a financial RPC', async () => {
  for (const options of [{ user: null }, { user: { id: OTHER, email_confirmed_at: 'now' } }, { user: { id: USER, is_anonymous: true, email_confirmed_at: 'now' } }, { user: { id: USER } }]) {
    const { actions, calls } = await fixture(options);
    assert.equal((await actions.getVehicleCalculationAction({ stockItemId: STOCK })).ok, false);
    assert.ok(calls.every(call => call === 'auth'));
  }
  const { actions, calls } = await fixture();
  assert.equal((await actions.getVehicleCalculationAction({ stockItemId: STOCK, companyId: OTHER })).ok, false); assert.deepEqual(calls, []);
});
test('numeric/unsafe/wrong-identity/duplicate cost RPC responses fail closed and never leak diagnostics', async () => {
  for (const patch of [{ companyId: OTHER }, { stockItemId: OTHER }, { purchaseGrossOre: 10000000 }, { saleGrossOre: Number.MAX_SAFE_INTEGER + 1 }, { version: 1 }, { purchaseVatOre: '999999999999' }]) {
    const { actions } = await fixture({ source: { ...source, ...patch } });
    assert.equal((await actions.getVehicleCalculationAction({ stockItemId: STOCK })).ok, false);
  }
  const { actions } = await fixture({ throws: true }); const result = await actions.getVehicleCalculationAction({ stockItemId: STOCK });
  assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('key'), false);
});
const input = { stockItemId: STOCK, companyId: COMPANY, expectedVersion: '1', purchaseVatOre: '2000000', vatBasisConfirmed: false, costVat: [] };
test('metadata writes are explicit actor-scoped CAS RPCs for owner/admin only', async () => {
  for (const role of ['owner', 'admin']) {
    const { actions, calls, invalidations } = await fixture({ role });
    assert.equal((await actions.saveVehicleCalculationMetadataAction(input)).ok, true);
    const saved=calls.find(call=>call.name==='save_vehicle_calculation_metadata');
    assert.equal(saved.args.p_expected_version, '1');
    assert.equal('actorUserId' in saved.args, false); assert.deepEqual(invalidations, ['/inventory']);
  }
  for (const role of ['sales', 'finance', 'viewer']) {
    const { actions, calls } = await fixture({ role }); assert.equal((await actions.saveVehicleCalculationMetadataAction(input)).ok, false); assert.equal(calls.some(call=>typeof call==='object'),false);
  }
});
test('mutations reject forged actor/amounts, numeric versions and unverified save receipts', async () => {
  for (const patch of [{ actorUserId: USER }, { saleGrossOre: '1' }, { expectedVersion: 1 }, { purchaseVatOre: -1 }, { vatBasisConfirmed: 'true' }, { costVat: [{ costId: OTHER, deductibleVatOre: 1 }] }]) {
    const { actions, calls } = await fixture(); assert.equal((await actions.saveVehicleCalculationMetadataAction({ ...input, ...patch })).ok, false); assert.deepEqual(calls, []);
  }
  const { actions, invalidations } = await fixture({ source: { ...source, purchaseVatOre: '0' } });
  assert.equal((await actions.saveVehicleCalculationMetadataAction(input)).ok, false); assert.deepEqual(invalidations, []);
  const conflict = await fixture({ error: { code: '40001', message: 'private' } }); assert.equal((await conflict.actions.saveVehicleCalculationMetadataAction(input)).conflict, true);
});
test('dashboard totals retain full-company sums as exact text and validate tenant and count consistency', async () => {
  const totals = { companyId: COMPANY, activeStockCount: '501', availableStockCount: '500', purchaseValueOre: '4503606824564873493', activeDealCount: '1001', reservedDealCount: '501', customerCount: '1002' };
  const good = await fixture({ source: totals });
  assert.deepEqual(await good.actions.getInventoryDashboardTotalsAction(COMPANY), { ok: true, totals });
  for (const patch of [{ companyId: OTHER }, { purchaseValueOre: 4503606824564873493 }, { availableStockCount: '502' }, { reservedDealCount: '1002' }]) {
    const { actions } = await fixture({ source: { ...totals, ...patch } }); assert.equal((await actions.getInventoryDashboardTotalsAction(COMPANY)).ok, false);
  }
});

test('calculation reads allow owner/admin/finance and deny sales/viewer before a financial RPC',async()=>{
  for(const role of ['owner','admin','finance','sales','viewer']){
    const {actions,calls}=await fixture({role});const result=await actions.getVehicleCalculationAction({companyId:COMPANY,stockItemId:STOCK});
    const allowed=['owner','admin','finance'].includes(role);assert.equal(result.ok,allowed);
    assert.equal(calls.some(call=>call.name==='get_vehicle_calculation'),allowed);
    if(!allowed){assert.equal('source'in result,false);assert.equal('calculation'in result,false);}
  }
});
test('calculation bytes are discarded when actual membership or approval changes during the RPC',async()=>{
  for(const revoke of [state=>{state.role='sales';},state=>{state.role='viewer';},state=>{state.approval='suspended';},state=>{state.user={...state.user,id:OTHER};}]){
    const {actions}=await fixture({afterRpc:revoke});const result=await actions.getVehicleCalculationAction({companyId:COMPANY,stockItemId:STOCK});
    assert.equal(result.ok,false);assert.equal('source'in result,false);assert.equal('calculation'in result,false);
  }
});
test('restricted dashboards keep nonfinancial counts and null purchase totals, rejecting hidden totals instead of inventing zero',async()=>{
  const totals={companyId:COMPANY,activeStockCount:'501',availableStockCount:'500',purchaseValueOre:null,activeDealCount:'1001',reservedDealCount:'501',customerCount:'1002'};
  for(const role of ['sales','viewer']){
    const good=await fixture({role,source:totals});assert.deepEqual(await good.actions.getInventoryDashboardTotalsAction(COMPANY),{ok:true,totals});
    const bad=await fixture({role,source:{...totals,purchaseValueOre:'4503606824564873493'}});assert.equal((await bad.actions.getInventoryDashboardTotalsAction(COMPANY)).ok,false);
  }
});
