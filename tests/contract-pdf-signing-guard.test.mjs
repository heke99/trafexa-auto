import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import fontkit from '@pdf-lib/fontkit';
import { createSourceLoader } from './helpers/source-loader.mjs';
import { asRole } from './crm-db/helpers.mjs';
import { fixture, capability, createSigning, approveOffer, rpc, id, U, C, D, EMAIL, strokes } from './guest-customer-db/helpers.mjs';
import { CONTRACT_PDF_FONT_RANGES, CONTRACT_PDF_FONT_SHA256 } from '../src/lib/contracts/pdf-font-coverage.ts';
import { contractPdfTextSupported } from '../src/lib/documents/contract-pdf-font.ts';

const migration = new URL('../supabase/migrations/20261112205929_contract_pdf_signature_guard.sql', import.meta.url);
const customer = id(301);
const unsupportedNames = ['李文', 'Kund 🚗'];

async function setup(t, options = {}) {
  const h = await fixture(options);
  t.after(() => h.db.close());
  await h.db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [customer, EMAIL]);
  await h.db.query("insert into private.account_approvals(user_id,status,updated_by) values($1,'approved',$1)", [customer]);
  const offerCap = await capability(h.db, 'offer_invitation', h.review.id);
  let signing;
  if (options.unrenderableDraft) {
    await approveOffer(h.db,offerCap);
    const template=(await rpc(h.db,U,'create_contract_template_version',[C,randomUUID(),0,'Unrenderable source','Avtal 李文',randomUUID()])).template;
    await rpc(h.db,U,'review_contract_template',[C,template.id,1,'approved','Reviewed source',randomUUID()]);
    const draft=(await rpc(h.db,U,'create_sale_contract_draft',[C,D,h.offer,template.id,2,randomUUID()])).draft;
    signing=(await rpc(h.db,U,'request_contract_signing',[C,D,draft.id,true,randomUUID()])).signing;
  } else signing = await createSigning(h, offerCap);
  const cap = await capability(h.db, 'contract_invitation', signing.id);
  const calls = [];
  async function call(role, actor, name, args) {
    return asRole(h.db, role, actor, async tx => (await tx.query(`select public.${name}(${Object.keys(args).map((key, n) => `"${key}" => $${n + 1}`).join(',')}) result`, Object.values(args))).rows[0].result);
  }
  function client(role, actor) {
    return { async rpc(name, args) {
      calls.push({ name, args, actor });
      try { return { data: await call(role, actor, name, args), error: null }; }
      catch (error) { return { data: null, error }; }
    } };
  }
  const dealerDb = client('authenticated', U), customerDb = client('authenticated', customer), serviceDb = client('service_role', null);
  const loader = await createSourceLoader({
    ...(options.fontBytes ? { 'node:fs/promises': { async readFile() { return options.fontBytes; } } } : {}),
    'next/cache': { revalidatePath() {} },
    '@/lib/contracts/signing-context': {
      async requireDealerSigningContext(companyId) { assert.equal(companyId, C); return { userId: U, companyId: C, role: 'owner', db: dealerDb }; },
      async requireCustomerSigningContext() { return { userId: customer, email: EMAIL, db: customerDb }; },
    },
    '@/lib/guest-customer/context': {
      GuestDocumentError: class extends Error { constructor(code) { super(code); this.code = code; } },
      async requireGuestCustomerContext() { return { db: serviceDb, invitationId: cap.invitationId, tokenHash: cap.tokenHash }; },
    },
    '@/lib/email/server': { async dispatchTransactionalEvent() {}, contractEmailConfigurationStatus() { return { transport: 'unconfigured' }; } },
  });
  const native = loader.load('@/lib/data/contract-signing-actions'), guest = loader.load('@/lib/data/guest-customer-actions');
  const nativeInput = (party, fullName, revision = 1) => ({ signingId: signing.id, ...(party === 'company' ? { companyId: C } : {}), expectedRevision: revision, documentHash: signing.documentHash, fullName, strokes, acknowledged: true, consentVersion: '2026-10-14', requestId: randomUUID() });
  const guestInput = (fullName, revision = 1) => ({ signingId: signing.id, expectedRevision: revision, documentHash: signing.documentHash, fullName, acknowledged: true, consentVersion: '2026-10-14', requestId: randomUUID() });
  const guestSql = input => call('service_role', null, 'sign_guest_contract', { p_invitation_id: cap.invitationId, p_token_hash: cap.tokenHash, p_expected_revision: input.expectedRevision, p_document_hash: input.documentHash, p_full_name: input.fullName, p_strokes: [], p_acknowledged: true, p_consent_version: input.consentVersion, p_request_id: input.requestId });
  const nativeSql = (party, input) => call('authenticated', party === 'company' ? U : customer, 'sign_contract', { p_signing_id: signing.id, p_company_id: party === 'company' ? C : null, p_expected_revision: input.expectedRevision, p_document_hash: input.documentHash, p_full_name: input.fullName, p_strokes: input.strokes, p_acknowledged: true, p_consent_version: input.consentVersion, p_request_id: input.requestId });
  async function state() {
    return (await h.db.query(`select jsonb_build_object(
      'native',(select count(*)::int from private.contract_signatures),
      'guest',(select count(*)::int from private.guest_contract_signatures),
      'nativeAudit',(select count(*)::int from private.contract_signing_audit),
      'guestAudit',(select count(*)::int from private.guest_document_audit),
      'completionMail',(select count(*)::int from private.transactional_email_outbox where kind in('contract_completed','contract_completed_company'))
    ) state`)).rows[0].state;
  }
  return { ...h, signing, cap, calls, loader, native, guest, nativeInput, guestInput, nativeSql, guestSql, state };
}

test('versioned font coverage, actual PDF font and SQL guard agree including every cmap point and gap', async t => {
  const h = await fixture(); t.after(() => h.db.close());
  const bytes = await readFile(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), CONTRACT_PDF_FONT_SHA256);
  const actual = fontkit.create(bytes).characterSet;
  assert.deepEqual(CONTRACT_PDF_FONT_RANGES.flatMap(([first,last]) => Array.from({length:last-first+1}, (_,i) => first+i)), actual);
  const samples = [...new Set([...actual, ...CONTRACT_PDF_FONT_RANGES.flatMap(([lo,hi]) => [lo-1,hi+1]), 0x674e, 0x6587, 0x1f697])].filter(code => code>0 && code<=0x10ffff && (code<0xd800 || code>0xdfff));
  const rows = (await h.db.query("select code,private.contract_pdf_name_supported_v1('A'||chr(code)||'A') supported from unnest($1::integer[]) code", [samples])).rows;
  for (const row of rows) assert.equal(row.supported, contractPdfTextSupported('A'+String.fromCodePoint(row.code)+'A'), 'codepoint '+row.code);
  const source = await readFile(migration, 'utf8'); assert.ok(source.includes(CONTRACT_PDF_FONT_SHA256));
  assert.equal((await h.db.query("select count(*)::int n from information_schema.routine_privileges where routine_schema='private' and routine_name in('contract_pdf_name_supported_v1','guard_contract_pdf_signature_v1') and grantee in('PUBLIC','anon','authenticated','service_role')")).rows[0].n, 0);
});

test('dealer, account customer and guest actions reject unrenderable names before mutation, preserve SQL and then accept the exact supported name', async t => {
  const h = await setup(t), before = await h.state();
  for (const name of unsupportedNames) {
    for (const party of ['company','customer']) {
      const result = await h.native.signContractAction(h.nativeInput(party, name));
      assert.equal(result.code, 'invalid_input'); assert.match(result.message, /Ingen ny underskrift har sparats/);
    }
    const result = await h.guest.signGuestContractAction(h.guestInput(name));
    assert.equal(result.code, 'invalid_input'); assert.match(result.message, /Kontakta bilhandlaren/);
  }
  assert.equal(h.calls.some(call => ['sign_contract','sign_guest_contract'].includes(call.name)), false);
  assert.deepEqual(await h.state(), before);
  const dealerInput = h.nativeInput('company', 'Åke Åberg');
  assert.equal((await h.native.signContractAction(dealerInput)).ok, true);
  assert.equal((await h.native.signContractAction(dealerInput)).ok, true, 'lost-response retry still returns its stored receipt');
  const guestInput = h.guestInput('Zoë Öström', 2);
  const completed = await h.guest.signGuestContractAction(guestInput);
  assert.equal(completed.ok, true); assert.equal(completed.document.signing.status, 'completed');
  assert.equal(completed.document.signing.customerSignature.fullName, 'Zoë Öström');
  assert.equal(completed.document.signing.companySignature.fullName, 'Åke Åberg');
  const artifacts = await h.loader.load('@/lib/documents/signed-contract-pdf').generateSignedContractArtifacts(completed.document.signing);
  assert.equal(Buffer.from(artifacts.pdf.subarray(0,5)).toString(), '%PDF-');
  assert.equal(JSON.parse(new TextDecoder().decode(artifacts.evidence)).signedPdfSha256, createHash('sha256').update(artifacts.pdf).digest('hex'));
});

test('direct authenticated dealer/customer and service guest SQL cannot bypass the same name guard or enqueue false completion mail', async t => {
  const h = await setup(t), before = await h.state();
  for (const name of unsupportedNames) {
    for (const party of ['company','customer']) await assert.rejects(h.nativeSql(party, h.nativeInput(party, name)), e => e.code==='22023');
    await assert.rejects(h.guestSql(h.guestInput(name)), e => e.code==='22023');
  }
  assert.deepEqual(await h.state(), before);
  await h.nativeSql('company', h.nativeInput('company','Åke Åberg'));
  const pending = await h.state();
  await assert.rejects(h.guestSql(h.guestInput('李文',2)), e => e.code==='22023');
  await assert.rejects(h.nativeSql('customer',h.nativeInput('customer','李文',2)), e => e.code==='22023');
  assert.deepEqual(await h.state(), pending);
  assert.equal(pending.native,1); assert.equal(pending.guest,0); assert.equal(pending.completionMail,0);
});

test('font file drift fails closed before any signing mutation instead of silently accepting a different cmap', async t => {
  const original = await readFile(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url));
  const altered = Buffer.from(original); altered[altered.length-1] ^= 1;
  const h=await setup(t,{fontBytes:altered}),before=await h.state();
  for(const party of ['company','customer'])assert.equal((await h.native.signContractAction(h.nativeInput(party,'Åke Åberg'))).code,'unavailable');
  assert.equal((await h.guest.signGuestContractAction(h.guestInput('Zoë Öström'))).code,'unavailable');
  assert.equal(h.calls.some(call=>['sign_contract','sign_guest_contract'].includes(call.name)),false);
  assert.deepEqual(await h.state(),before);
});

test('migration preserves old immutable unsupported signatures and blocks a second signature through action or direct RPC', async t => {
  const h = await setup(t, { throughMigration:'20261108121336_advertising_store_program.sql' });
  await h.guestSql(h.guestInput('李文'));
  const before = await h.state(); assert.equal(before.guest,1); assert.equal(before.native,0);
  await h.db.exec(await readFile(migration,'utf8'));
  assert.deepEqual(await h.state(),before);
  const input = h.nativeInput('company','Åke Åberg',2);
  const action = await h.native.signContractAction(input);
  assert.equal(action.code,'invalid_input');
  await assert.rejects(h.nativeSql('company',input), e => e.code==='22023');
  assert.deepEqual(await h.state(),before);
  assert.equal((await h.db.query('select full_name from private.guest_contract_signatures')).rows[0].full_name,'李文');
});


test('account customer can still sign the exact supported name and dealer completion renders both receipts', async t => {
  const h=await setup(t);
  assert.equal((await h.native.signContractAction(h.nativeInput('customer','Zoë Öström'))).ok,true);
  const completed=await h.native.signContractAction(h.nativeInput('company','Åke Åberg',2));
  assert.equal(completed.ok,true);assert.equal(completed.signing.status,'completed');
  assert.equal(completed.signing.customerSignature.fullName,'Zoë Öström');
  const files=await h.loader.load('@/lib/documents/signed-contract-pdf').generateSignedContractArtifacts(completed.signing);
  assert.equal(Buffer.from(files.pdf.subarray(0,5)).toString(),'%PDF-');
});

test('supported new names do not let either action sign an existing unrenderable draft', async t => {
  const h=await setup(t,{unrenderableDraft:true}),before=await h.state();
  const dealer=await h.native.signContractAction(h.nativeInput('company','Åke Åberg'));
  const guest=await h.guest.signGuestContractAction(h.guestInput('Zoë Öström'));
  for(const result of [dealer,guest]){assert.equal(result.code,'invalid_input');assert.match(result.message,/Avtalsunderlaget/);}
  assert.equal(h.calls.some(call=>['sign_contract','sign_guest_contract'].includes(call.name)),false);
  assert.deepEqual(await h.state(),before);
});
