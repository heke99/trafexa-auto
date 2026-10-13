import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

const company = 'bb759a30-281a-4ff0-983c-6bb23442db58';
const foreign = 'bb759a30-281a-4ff0-983c-6bb23442db59';
const leadId = 'bb759a30-281a-4ff0-983c-6bb23442db60';
const validationUrl = new URL('../src/lib/data/validation.ts', import.meta.url).href;
let sequence = 0;

// Load the real server functions with framework/database boundaries replaced.
// No Supabase client, session cookies, network connection or credentials are used.
async function actions({ role = 'sales', selectedCompany = company, rows = [], queryError = null, rpcData = leadId, rpcError = null, authError = false } = {}) {
  const calls = [], revalidated = [];
  const db = {
    from(table) {
      const steps = [['from', table]]; calls.push(steps);
      const query = { then(resolve, reject) { return Promise.resolve({ data: rows, error: queryError }).then(resolve, reject); } };
      for (const method of ['select', 'eq', 'order', 'limit', 'or', 'update']) query[method] = (...args) => { steps.push([method, ...args]); return query; };
      return query;
    },
    async rpc(name, payload) { calls.push(['rpc', name, payload]); return { data: rpcData, error: rpcError }; }
  };
  const token = `leadTest${sequence++}`;
  globalThis[token] = {
    revalidatePath(path) { revalidated.push(path); },
    async getActiveCompanyContext() { if (authError) throw new Error('private auth details'); return { db, company: selectedCompany, role, user: leadId }; }
  };
  let source = stripTypeScriptTypes(await readFile(new URL('../src/lib/data/lead-actions.ts', import.meta.url), 'utf8'));
  source = source.replace("import { revalidatePath } from 'next/cache';", `const { revalidatePath } = globalThis.${token};`)
    .replace("import { getActiveCompanyContext } from './company-context';", `const { getActiveCompanyContext } = globalThis.${token};`)
    .replace("from './validation'", `from ${JSON.stringify(validationUrl)}`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  delete globalThis[token];
  return { module, calls, revalidated };
}
function intake(patch = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ company_id: company, submission_id: foreign, name: '  Test Contact  ', email: ' Buyer+fleet@Example.com ', phone: '', subject: ' Wants a family car\nBudget to discuss. ', ...patch })) form.set(key, value);
  return form;
}
function statusForm(patch = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ company_id: company, lead_id: leadId, previous_status: 'new', status: 'contacted', ...patch })) form.set(key, value);
  return form;
}

test('creation normalizes contact text and sends only verified tenant plus bounded intake fields', async () => {
  const { module, calls, revalidated } = await actions();
  const result = await module.createCustomerLeadAction(intake({ created_by: foreign, status: 'closed', customer_id: foreign }));
  assert.equal(result.ok, true); assert.equal(result.leadId, leadId);
  assert.deepEqual(calls[0], ['rpc', 'create_customer_lead', { company, submission: foreign, contact_name: 'Test Contact', contact_email: 'buyer+fleet@example.com', contact_phone: '', lead_subject: 'Wants a family car\nBudget to discuss.' }]);
  assert.deepEqual(revalidated, ['/customers', '/dashboard']);
});

test('viewer and finance roles can read leads but cannot create or update them', async () => {
  for (const role of ['viewer', 'finance']) {
    const { module, calls } = await actions({ role });
    assert.equal((await module.listCustomerLeadsAction(company)).ok, true);
    const count = calls.length;
    assert.equal((await module.createCustomerLeadAction(intake())).ok, false);
    assert.equal((await module.updateLeadStatusAction(statusForm())).ok, false);
    assert.equal(calls.length, count);
  }
});

test('expected company mismatch blocks every action before database access', async () => {
  const { module, calls } = await actions({ selectedCompany: foreign });
  for (const result of [await module.listCustomerLeadsAction(company), await module.createCustomerLeadAction(intake()), await module.updateLeadStatusAction(statusForm())]) {
    assert.equal(result.ok, false); assert.match(result.message, /företaget har ändrats/);
  }
  assert.deepEqual(calls, []);
});

test('missing sessions produce safe failures without raw authentication details', async () => {
  const { module, calls } = await actions({ authError: true });
  for (const result of [await module.listCustomerLeadsAction(company), await module.createCustomerLeadAction(intake()), await module.updateLeadStatusAction(statusForm())]) {
    assert.equal(result.ok, false); assert.ok(!result.message.includes('private auth'));
  }
  assert.deepEqual(calls, []);
});

test('invalid contact, file values, missing contact, overflow and controls never reach the RPC', async () => {
  const { module, calls } = await actions();
  for (const patch of [{ name: ' ' }, { name: 'x'.repeat(161) }, { name: 'Bad\nName' }, { email: 'a@b@c.example' }, { email: '', phone: '' }, { email: '', phone: '...' }, { email: '', phone: 'call-me' }, { subject: 'x'.repeat(2001) }, { subject: 'note\u0001' }, { company_id: 'foreign' }, { submission_id: 'wrong' }, { name: new File(['contact'], 'contact.txt') }]) {
    assert.equal((await module.createCustomerLeadAction(intake(patch))).ok, false);
  }
  assert.deepEqual(calls, []);
});

test('phone-only contacts and multiline notes remain supported', async () => {
  const { module, calls } = await actions();
  assert.equal((await module.createCustomerLeadAction(intake({ email: '', phone: '+46 (70) 123-45-67' }))).ok, true);
  assert.equal(calls[0][2].contact_phone, '+46 (70) 123-45-67');
});

test('unsafe provider details and unconfirmed creation results are never success', async () => {
  for (const options of [{ rpcError: { code: 'XX000', message: 'private database detail' } }, { rpcData: null }, { rpcData: {} }, { rpcData: 'not-a-uuid' }]) {
    const { module, revalidated } = await actions(options);
    const result = await module.createCustomerLeadAction(intake());
    assert.equal(result.ok, false); assert.ok(!result.message.includes('private database')); assert.deepEqual(revalidated, []);
  }
});

test('lead pagination returns fifty rows ordered by timestamp and UUID with precise cursor', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ id: `bb759a30-281a-4ff0-983c-${String(index).padStart(12, '0')}`, status: 'new', subject: `Request ${index}`, created_at: '2026-10-13T12:34:56.123456+00:00', customers: { id: leadId, name: 'Contact', email: null, phone: '0701234567' } }));
  const { module, calls } = await actions({ rows });
  const result = await module.listCustomerLeadsAction(company);
  assert.equal(result.ok, true); assert.equal(result.leads.length, 50);
  assert.deepEqual(result.nextBefore, { createdAt: rows[49].created_at, id: rows[49].id });
  assert.deepEqual(calls[0].filter(([name]) => ['eq', 'order', 'limit'].includes(name)), [['eq', 'company_id', company], ['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: false }], ['limit', 51]]);
  await module.listCustomerLeadsAction(company, result.nextBefore);
  assert.ok(calls[1].some(([name, value]) => name === 'or' && value.includes(rows[49].created_at) && value.includes(`id.lt.${rows[49].id}`)));
});

test('cursor validation rejects filter injection, non-objects and invalid dates before querying', async () => {
  const { module, calls } = await actions();
  for (const before of [null, [], {}, { id: 'invalid', createdAt: '2026-10-13T00:00:00Z' }, { id: leadId, createdAt: '2026-10-13T00:00:00Z),company_id.eq.foreign' }, { id: leadId, createdAt: '2026-02-30T00:00:00Z' }, { id: leadId, createdAt: '2026-10-13T00:00:00.1234567Z' }]) assert.equal((await module.listCustomerLeadsAction(company, before)).ok, false);
  assert.deepEqual(calls, []);
});

test('status updates constrain tenant, lead and previous status while touching only status', async () => {
  const { module, calls, revalidated } = await actions({ role: 'owner', rows: [{ id: leadId }] });
  const result = await module.updateLeadStatusAction(statusForm({ company_id_to_set: foreign, customer_id: foreign, subject: 'Attempted overwrite' }));
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], [['from', 'leads'], ['update', { status: 'contacted' }], ['eq', 'company_id', company], ['eq', 'id', leadId], ['eq', 'status', 'new'], ['select', 'id']]);
  assert.deepEqual(revalidated, ['/customers']);
});

test('a stale status returns a refresh conflict and never claims a successful update', async () => {
  const { module, revalidated } = await actions({ rows: [] });
  const result = await module.updateLeadStatusAction(statusForm());
  assert.equal(result.ok, false); assert.equal(result.conflict, true); assert.match(result.message, /kontrollera aktuell status/);
  assert.deepEqual(revalidated, []);
});

test('forged and unchanged statuses do not query the database', async () => {
  const { module, calls } = await actions();
  for (const patch of [{ status: 'reserved' }, { previous_status: 'submitted' }, { status: 'new' }, { lead_id: 'invalid' }]) assert.equal((await module.updateLeadStatusAction(statusForm(patch))).ok, false);
  assert.deepEqual(calls, []);
});
