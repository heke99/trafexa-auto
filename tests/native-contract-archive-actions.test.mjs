import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSourceLoader } from './helpers/source-loader.mjs';
import * as actualPdf from '../src/lib/documents/signed-contract-pdf.ts';
import { completedArchiveSource, archiveId, ARCHIVE_COMPANY as companyId, ARCHIVE_SIGNING as signingId, ARCHIVE_DEALER as actorId, ARCHIVE_REQUEST as requestId } from './helpers/native-archive-fixture.mjs';

async function fixture(options = {}) {
  const state = { contexts: 0, renders: 0, uploads: 0, rpc: [], customerContexts: 0 };
  const raw = completedArchiveSource(); raw.draft.actorLabel = 'Du';
  let CrmError;
  const db = { rpc(name, args) {
    state.rpc.push({ name, args });
    const query = { abortSignal() { return query; }, then(resolve, reject) { return Promise.resolve({ data: { actorId, companyId, signingId, archive: null }, error: null }).then(resolve, reject); } };
    return query;
  }, storage: { from() { return { async upload() { state.uploads++; throw Error('must not upload'); } }; } } };
  const loader = await createSourceLoader({
    'node:process': { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_public_1234567890', ...(options.configured ? { SUPABASE_SECRET_KEY: 'sb_secret_fixture_private_1234567890' } : {}) } },
    '../contracts/signing-context': {
      async requireDealerSigningContext() { state.contexts++; if (state.contexts === options.denyContext) throw new CrmError('access_denied'); return { db, userId: options.changedActor && state.contexts > 1 ? archiveId(99) : actorId, companyId, role: options.role ?? 'owner' }; },
      async requireCustomerSigningContext() { state.customerContexts++; return { db, userId: actorId, email: 'archive-customer@example.invalid' }; },
    },
    './contract-signing-actions': { async getContractSigningAction() { return { ok: true, signing: raw }; } },
    './signed-contract-pdf.ts': { ...actualPdf, async generateSignedContractArtifacts() { state.renders++; throw Error('must stop before rendering'); } },
  });
  CrmError = loader.load('src/lib/crm/context.ts').CrmError;
  return { state, actions: loader.load('src/lib/data/contract-archive-actions.ts') };
}

test('actual archive action stops missing registration capability before rendering/upload and returns product wording', async () => {
  const { state, actions } = await fixture();
  const result = await actions.archiveContractAction({ companyId, signingId, requestId });
  assert.equal(result.ok, false); assert.equal(result.code, 'configuration_missing');
  assert.equal(result.error, 'Originalarkivet är inte aktiverat. Kontakta Trafexa.');
  assert.equal(state.renders, 0); assert.equal(state.uploads, 0);
  assert.ok(state.rpc.every(call => call.name === 'get_contract_signing_archive'));
});

test('actual authorize dependency preserves a fresh CrmError denial after prepare instead of becoming unavailable', async () => {
  const { state, actions } = await fixture({ configured: true, denyContext: 2 });
  const result = await actions.archiveContractAction({ companyId, signingId, requestId });
  assert.equal(result.ok, false); assert.equal(result.code, 'access_denied');
  assert.equal(state.contexts, 2); assert.equal(state.renders, 0); assert.equal(state.uploads, 0);
});

test('finance can read a null archive without a server key while only owner/admin can create', async () => {
  const { state, actions } = await fixture({ role: 'finance' });
  const read = await actions.getContractArchiveAction({ signingId, companyId });
  assert.equal(read.ok, true); assert.equal(read.archive, null); assert.equal(read.role, 'finance');
  assert.equal(read.actorId, actorId); assert.equal(read.companyId, companyId);
  const previous = state.rpc.length;
  const write = await actions.archiveContractAction({ signingId, companyId, requestId });
  assert.equal(write.ok, false); assert.equal(write.code, 'access_denied'); assert.equal(state.rpc.length, previous);
  assert.equal(state.renders, 0); assert.equal(state.uploads, 0);
});

test('customer read uses its recipient context without membership and rejects caller-supplied paths/actors/hashes before Auth', async () => {
  const { state, actions } = await fixture();
  const read = await actions.getContractArchiveAction({ signingId });
  assert.equal(read.ok, true); assert.equal(read.role, 'customer'); assert.equal(state.customerContexts, 2); assert.equal(state.contexts, 0);
  assert.equal(state.rpc[0].args.p_company_id, null);
  const before = state.rpc.length;
  for (const extras of [{ actorUserId: actorId }, { pdfSha256: 'a'.repeat(64) }, { objectPath: 'foreign/document.pdf' }]) {
    const result = await actions.archiveContractAction({ signingId, companyId, requestId, ...extras });
    assert.equal(result.ok, false); assert.equal(result.code, 'invalid_input');
  }
  assert.equal(state.rpc.length, before); assert.equal(state.contexts, 0);
});
