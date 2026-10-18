import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createDatabase } from './crm-db/helpers.mjs';
import { fixture, capability, createSigning, approveContract, rpc, service, id, U, C, D, S, strokes } from './guest-customer-db/helpers.mjs';
const migration = await readFile(new URL('../supabase/migrations/20261018095005_guest_contract_fulfilment_source.sql', import.meta.url), 'utf8');
const original = await readFile(new URL('../supabase/migrations/20261015214506_deal_fulfilment.sql', import.meta.url), 'utf8');
const previousSource = 'create or replace function private.deal_fulfilment_source' + original.split('create function private.deal_fulfilment_source')[1].split('\ncreate function private.deal_fulfilment_page')[0];
async function signingFixture(order = 'guest-first', complete = true) {
  const h = await fixture();
  const offerCap = await capability(h.db, 'offer_invitation', h.review.id);
  const signing = await createSigning(h, offerCap);
  const cap = await capability(h.db, 'contract_invitation', signing.id);
  if (order === 'dealer-first') await rpc(h.db, U, 'sign_contract', [signing.id, C, 1, signing.documentHash, 'Dealer Owner', strokes, true, '2026-10-14', id(31)]);
  await approveContract(h.db, cap, order === 'dealer-first' ? 2 : 1);
  if (order === 'guest-first' && complete) await rpc(h.db, U, 'sign_contract', [signing.id, C, 2, signing.documentHash, 'Dealer Owner', strokes, true, '2026-10-14', id(31)]);
  return { ...h, signing, cap };
}
async function archive(h) {
  const pdfHash = 'a'.repeat(64), evidenceHash = 'b'.repeat(64), prefix = C + '/native-contracts/' + h.signing.id + '/v1/';
  // Local catalog fixtures prove SQL gating only, not actual Storage file bytes.
  await h.db.query("insert into storage.objects(bucket_id,name,metadata)values('native-contract-originals',$1,$2),('native-contract-originals',$3,$4)", [prefix + 'signed-' + pdfHash + '.pdf', { size: 42, mimetype: 'application/pdf' }, prefix + 'evidence-' + evidenceHash + '.json', { size: 84, mimetype: 'application/json' }]);
  return service(h.db, 'register_contract_signing_archive', [C, h.signing.id, U, id(40), h.signing.documentHash, 3, pdfHash, 42, evidenceHash, 84, 'trafexa-native-v1']);
}
const page = h => rpc(h.db, U, 'get_deal_fulfilment', [C, D]);
const mutation = (h, operation, version, patch = {}, actor = U) => rpc(h.db, actor, 'mutate_deal_fulfilment', [C, D, { companyId: C, dealId: D, requestId: id(operation === 'payment' ? 70 : 71), expectedVersion: version, operation, reason: 'Manuellt kontrollerat testunderlag', ...patch }]);
for (const order of ['guest-first', 'dealer-first']) test(`guest ${order}: reproduce old fulfilment refusal, then accept exact archived signing through payment and completed delivery`, async () => {
  const h = await signingFixture(order);
  try {
    const a = await archive(h); await rpc(h.db, U, 'reserve_vehicle', [C, D, 48]);
    assert.equal((await h.db.query('select count(*)::int n from private.contract_signatures')).rows[0].n, 1);
    assert.equal((await h.db.query('select count(*)::int n from private.guest_contract_signatures')).rows[0].n, 1);
    await h.db.exec(previousSource);
    assert.equal((await page(h)).blockedReason, 'contract_required');
    await assert.rejects(mutation(h, 'payment', 0, { amountOre: '200', bankReference: 'GUEST-PAID-001', bookedOn: new Date().toISOString().slice(0, 10) }), e => e.code === '40001');
    await h.db.exec(migration);
    const read = await page(h); assert.equal(read.blockedReason, null); assert.equal(read.source.archiveId, a.archive.id); assert.equal(read.source.amountDueOre, '200');
    const paid = await mutation(h, 'payment', 0, { amountOre: '200', bankReference: 'GUEST-PAID-001', bookedOn: read.businessDate });
    assert.equal(paid.registeredOre, '200'); assert.equal(paid.canDeliver, true);
    const delivered = await mutation(h, 'deliver', 1); assert.ok(delivered.delivery); assert.equal(delivered.source.archiveId, a.archive.id);
    assert.equal((await h.db.query('select status from public.deals where id=$1', [D])).rows[0].status, 'completed');
    assert.equal((await h.db.query('select status from public.stock_items where id=$1', [S])).rows[0].status, 'sold');
    assert.equal((await rpc(h.db, U, 'get_contract_signing_archive', [h.signing.id, C])).archive.id, a.archive.id);
    assert.equal((await h.db.query('select count(*)::int n from auth.users')).rows[0].n, 1);
  } finally { await h.db.close(); }
});
test('incomplete guest signing remains blocked; completed guest without original reaches original_required and cannot take payment', async () => {
  const h = await signingFixture('guest-first', false);
  try {
    assert.equal((await page(h)).blockedReason, 'contract_required');
    await rpc(h.db, U, 'sign_contract', [h.signing.id, C, 2, h.signing.documentHash, 'Dealer Owner', strokes, true, '2026-10-14', id(31)]);
    assert.equal((await page(h)).blockedReason, 'original_required');
    await assert.rejects(mutation(h, 'payment', 0, { amountOre: '200', bankReference: 'GUEST-NO-ARCHIVE', bookedOn: (await page(h)).businessDate }), e => e.code === '40001');
    assert.equal((await h.db.query('select count(*)::int n from private.deal_payment_entries')).rows[0].n, 0);
  } finally { await h.db.close(); }
});
test('guest source fix preserves finance readonly, sales/viewer privacy, scoped company and private archive checks', async () => {
  const h = await signingFixture();
  try {
    await archive(h);
    for (const [n, role] of [[80, 'finance'], [81, 'sales'], [82, 'viewer']]) {
      await h.db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())', [id(n), role + '@guest-fulfilment.invalid']);
      await h.db.query("insert into private.account_approvals(user_id,status,updated_by)values($1,'approved',$2)", [id(n), U]);
      await h.db.query('insert into public.memberships(company_id,user_id,role)values($1,$2,$3)', [C, id(n), role]);
      if (role === 'finance') assert.equal((await rpc(h.db, id(n), 'get_deal_fulfilment', [C, D])).source.amountDueOre, '200');
      else await assert.rejects(rpc(h.db, id(n), 'get_deal_fulfilment', [C, D]), e => e.code === '42501');
      await assert.rejects(mutation(h, 'payment', 0, { amountOre: '200', bankReference: 'GUEST-NO-WRITE', bookedOn: (await page(h)).businessDate }, id(n)), e => e.code === '42501');
    }
    await assert.rejects(rpc(h.db, U, 'get_deal_fulfilment', [id(99), D]), e => e.code === '42501');
    await h.db.exec("update storage.buckets set public=true where id='native-contract-originals'");
    await assert.rejects(page(h), e => e.code === '42501');
    await h.db.exec("update storage.buckets set public=false where id='native-contract-originals';alter table private.guest_document_invitations disable trigger guest_invitation_immutable");
    // Privileged corruption probe: an unrelated invitation cannot contribute a
    // customer party even when a raw guest signature row still exists.
    await h.db.query('update private.guest_document_invitations set reference_id=$1 where id=$2', [id(99), h.cap.invitationId]);
    await h.db.exec('alter table private.guest_document_invitations enable trigger guest_invitation_immutable');
    assert.equal((await page(h)).blockedReason, 'contract_required');
  } finally { await h.db.close(); }
});
test('historical authenticated customer plus company signatures remain eligible without guest signatures', async () => {
  const db = await createDatabase({ approveEstablishedFixtures: false });
  const fixed = n => `fc110000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  try {
    const text = await readFile(new URL('../supabase/tests/native_contract_archive.sql', import.meta.url), 'utf8');
    await db.exec('begin;' + text.split('-- BEGIN NATIVE ARCHIVE FIXTURES')[1].split('-- END NATIVE ARCHIVE FIXTURES')[0] + 'commit;');
    const p = await rpc(db, fixed(1), 'get_deal_fulfilment', [fixed(101), fixed(501)]);
    assert.equal(p.blockedReason, 'original_required');
    assert.equal((await db.query('select count(*)::int n from private.guest_contract_signatures')).rows[0].n, 0);
    const signing = (await db.query('select id,document_hash from private.contract_signings where deal_id=$1', [fixed(501)])).rows[0];
    const prefix = fixed(101) + '/native-contracts/' + signing.id + '/v1/';
    await db.query("insert into storage.objects(bucket_id,name,metadata)values('native-contract-originals',$1,$2),('native-contract-originals',$3,$4)", [prefix + 'signed-' + 'a'.repeat(64) + '.pdf', {size:42,mimetype:'application/pdf'}, prefix + 'evidence-' + 'b'.repeat(64) + '.json', {size:84,mimetype:'application/json'}]);
    const a = await service(db, 'register_contract_signing_archive', [fixed(101), signing.id, fixed(1), fixed(90), signing.document_hash, 3, 'a'.repeat(64), 42, 'b'.repeat(64), 84, 'trafexa-native-v1']);
    assert.equal((await rpc(db, fixed(1), 'get_deal_fulfilment', [fixed(101), fixed(501)])).source.archiveId, a.archive.id);
  } finally { await db.close(); }
});
test('hosted rollback proof has no Storage/provider writes and leaves eleven fixture counters zero', async () => {
  const db = await createDatabase({ approveEstablishedFixtures: false });
  try {
    await db.exec(await readFile(new URL('../supabase/tests/guest_contract_fulfilment.sql', import.meta.url), 'utf8'));
    const value = (await db.query(await readFile(new URL('../supabase/tests/guest_contract_fulfilment_cleanup.sql', import.meta.url), 'utf8'))).rows[0].result;
    assert.equal(Object.keys(value).length, 11); assert.ok(Object.values(value).every(n => n === 0), JSON.stringify(value));
  } finally { await db.close(); }
});
