import assert from 'node:assert/strict';
import {createSourceLoader} from './source-loader.mjs';
import {archiveId, ARCHIVE_COMPANY, ARCHIVE_DEALER, ARCHIVE_CUSTOMER, ARCHIVE_REQUEST, ARCHIVE_SIGNING, completedArchiveSource, digest} from './native-archive-fixture.mjs';

const BUCKET = 'native-contract-originals';
const TEST_KEY = 'sb_secret_native_archive_fixture_only';
const TEST_PUBLIC_KEY = 'sb_publishable_native_archive_fixture_only';
const TEST_USER_TOKEN = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({role: 'authenticated', sub: ARCHIVE_DEALER})).toString('base64url')}.fixture_signature`;
const clone = value => structuredClone(value);

/**
 * Actual actions, contexts, parsers, renderer, archive core/transport and GET exports.
 * Only SDK I/O, selected company, config and service HTTP transport are controlled.
 * This is not a real Auth session, HTTP server, Storage service or RLS proof.
 */
export async function integration(options = {}) {
  const source = completedArchiveSource();
  const state = {
    actor: 'dealer', role: 'owner', accountStatus: 'approved', authenticated: true,
    bucketPrivate: true, archive: null, objects: new Map(), serviceCalls: [], sdkCalls: [],
    renders: [], renderAttempts: 0, invalidations: [], rendererUnavailable: false, failEvidenceUpload: false,
    onDownload: null, onRpc: null, source,
  };
  const actorId = () => state.actor === 'customer' ? ARCHIVE_CUSTOMER : ARCHIVE_DEALER;
  const actorEmail = () => state.actor === 'customer' ? source.customerEmail : 'archive-dealer@example.invalid';
  const allowed = () => state.authenticated && state.accountStatus === 'approved';
  const archiveEnvelope = actor => ({actorId: actor, companyId: ARCHIVE_COMPANY, signingId: ARCHIVE_SIGNING, archive: clone(state.archive)});
  const denied = () => ({data: null, error: {code: '42501', message: 'PRIVATE fixture denial'}});
  const db = {
    auth: {async getUser(token) {
      if (token !== undefined) assert.equal(token, TEST_USER_TOKEN);
      state.sdkCalls.push(['auth']);
      return {data: {user: state.authenticated ? {id: actorId(), email: actorEmail(), email_confirmed_at: '2026-10-14T09:00:00Z', is_anonymous: false} : null}, error: null};
    }, async getSession() { return {data: {session: {access_token: TEST_USER_TOKEN, user: {id: actorId()}}}, error: null}; }},
    from(table) {
      assert.equal(table, 'memberships');
      const filters = {};
      const query = {
        select() { return query; }, eq(key, value) { filters[key] = value; return query; },
        async maybeSingle() {
          state.sdkCalls.push(['membership', clone(filters)]);
          return {data: state.actor === 'dealer' && allowed() ? {company_id: ARCHIVE_COMPANY, user_id: ARCHIVE_DEALER, role: state.role, status: 'active', companies: {id: ARCHIVE_COMPANY, status: 'active'}} : null, error: null};
        },
      };
      return query;
    },
    rpc(name, args) {
      state.sdkCalls.push(['rpc', name, clone(args)]);
      const request = Promise.resolve().then(async () => {
        if(state.onRpc)await state.onRpc(name,args);
        if (name === 'get_account_access') return {data: {userId: actorId(), email: actorEmail(), emailVerified: true, status: state.accountStatus, version: 1, isPlatformAdmin: false}, error: null};
        assert.ok(['get_contract_signing', 'get_contract_signing_archive'].includes(name), `Unexpected user RPC ${name}`);
        if (!allowed() || args.p_signing_id !== ARCHIVE_SIGNING || args.p_company_id !== null && args.p_company_id !== ARCHIVE_COMPANY) return denied();
        const dealer = args.p_company_id !== null;
        if (dealer && (state.actor !== 'dealer' || !['owner', 'admin', 'finance'].includes(state.role))) return denied();
        if (!dealer && state.actor !== 'customer') return denied();
        if (name === 'get_contract_signing_archive') return state.bucketPrivate ? {data: archiveEnvelope(actorId()), error: null} : denied();
        return {data: {
          actorUserId: actorId(), actorRole: dealer ? state.role : 'customer',
          companyId: ARCHIVE_COMPANY, recipientEmail: dealer ? null : actorEmail(),
          signing: {...clone(source), party: dealer ? ['owner', 'admin'].includes(state.role) ? 'company' : null : 'customer'},
        }, error: null};
      });
      request.abortSignal = signal => { assert.ok(signal instanceof AbortSignal); return request; };
      return request;
    },
    storage: {from(bucket) {
      assert.equal(bucket, BUCKET);
      return {
        async upload() { throw Error('SDK upload bypasses the abortable HTTP transport'); },
        async download(path, _config, transport) {
          state.sdkCalls.push(['download', path]);
          assert.equal(transport.cache, 'no-store'); assert.ok(transport.signal instanceof AbortSignal);
          const object = state.objects.get(path);
          if (!allowed() || !state.bucketPrivate || !object) return denied();
          const bytes = new Uint8Array(object.bytes);
          if (state.onDownload) await state.onDownload(path,transport.signal);
          return {data: new Blob([bytes], {type: object.mime}), error: null};
        },
      };
    }},
  };
  let completeRace;
  const race = new Promise(resolve => { completeRace = resolve; });
  function registration(payload) {
    assert.equal(payload.p_company_id, ARCHIVE_COMPANY); assert.equal(payload.p_signing_id, ARCHIVE_SIGNING);
    assert.equal(payload.p_actor_user_id, ARCHIVE_DEALER); assert.equal(payload.p_document_content_sha256, source.documentHash);
    assert.equal(payload.p_revision, 3); assert.equal(payload.p_renderer_version, 'trafexa-native-v1');
    const base = `${ARCHIVE_COMPANY}/native-contracts/${ARCHIVE_SIGNING}/v1`;
    const file = (name, mime) => {
      const sha = payload[`p_${name}_sha256`], bytes = payload[`p_${name}_bytes`];
      const objectPath = `${base}/${name === 'pdf' ? 'signed' : 'evidence'}-${sha}.${name === 'pdf' ? 'pdf' : 'json'}`;
      const stored = state.objects.get(objectPath); assert.ok(stored, 'registration follows actual readback of both files');
      assert.equal(stored.bytes.length, bytes); assert.equal(digest(stored.bytes), sha); assert.equal(stored.mime, mime);
      return {objectPath, sha256: sha, bytes, mimeType: mime};
    };
    return {
      id: archiveId(20), signingId: ARCHIVE_SIGNING, companyId: ARCHIVE_COMPANY,
      dealId: source.dealId, draftId: source.draftId, draftVersion: source.draftVersion,
      documentContentSha256: source.documentHash, signingRevision: 3,
      rendererVersion: 'trafexa-native-v1', evidenceSchemaVersion: 1,
      pdf: file('pdf', 'application/pdf'), evidence: file('evidence', 'application/json'), archivedAt: '2026-10-15T10:04:00Z',
    };
  }
  async function serviceFetch(url, request) {
    assert.equal(String(url), 'https://native-archive-test.invalid/rest/v1/rpc/register_contract_signing_archive');
    assert.equal(request.method, 'POST'); assert.equal(request.headers.apikey, TEST_KEY);
    assert.equal(request.headers.Authorization, undefined); assert.equal(request.cache, 'no-store'); assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
    const payload = JSON.parse(request.body); state.serviceCalls.push(payload);
    assert.ok(allowed() && state.bucketPrivate && ['owner', 'admin'].includes(state.role));
    if (options.racingRenderers) {
      if (state.serviceCalls.length === 2) { state.archive = registration(state.serviceCalls[0]); completeRace(); }
      await race;
    } else state.archive ??= registration(payload);
    return Response.json(archiveEnvelope(payload.p_actor_user_id));
  }
  async function storageFetch(url, request) {
    const target = new URL(url), prefix = `/storage/v1/object/${BUCKET}/`;
    assert.equal(target.origin, 'https://native-archive-test.invalid'); assert.ok(target.pathname.startsWith(prefix));
    assert.equal(request.method, 'POST'); assert.equal(request.headers.apikey, TEST_PUBLIC_KEY);
    assert.equal(request.headers.Authorization, `Bearer ${TEST_USER_TOKEN}`); assert.equal(request.headers['x-upsert'], 'false');
    assert.equal(request.cache, 'no-store'); assert.equal(request.redirect, 'error'); assert.ok(request.signal instanceof AbortSignal);
    const path = target.pathname.slice(prefix.length), mime = request.headers['Content-Type'];
    state.sdkCalls.push(['upload', path]);
    if (!allowed() || !state.bucketPrivate || state.actor !== 'dealer' || !['owner', 'admin'].includes(state.role) || state.archive || state.objects.has(path) || state.failEvidenceUpload && path.endsWith('.json')) return Response.json({error: 'PRIVATE fixture upload refused'}, {status: 409});
    state.objects.set(path, {bytes: new Uint8Array(request.body), mime});
    return Response.json({Key: `${BUCKET}/${path}`});
  }
  const coreAdapter = {}, pdfAdapter = {};
  const loader = await createSourceLoader({
    'next/cache': {revalidatePath: path => state.invalidations.push(path)},
    'node:process': {env: {NEXT_PUBLIC_SUPABASE_URL: 'https://native-archive-test.invalid', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: TEST_PUBLIC_KEY, ...(options.missingKey ? {} : {SUPABASE_SECRET_KEY: TEST_KEY})}},
    '@/lib/supabase/server': {async createServerSupabaseClient() { return db; }},
    '@/lib/data/company-context': {async getActiveCompanyContext() { return {db, company: ARCHIVE_COMPANY, user: actorId(), role: state.role}; }},
    '../documents/native-contract-archive': coreAdapter,
    './native-contract-archive': coreAdapter,
    './contract-pdf.ts': pdfAdapter,
  });
  const actualPdf = loader.load('@/lib/documents/contract-pdf');
  let renderSequence = 0;
  Object.assign(pdfAdapter, actualPdf, {async renderContractPdf(...args) {
    state.renderAttempts++;
    if (state.rendererUnavailable) throw Error('PRIVATE fixture renderer is no longer available');
    const sequence = renderSequence++;
    const bytes = new Uint8Array(await actualPdf.renderContractPdf(...args));
    const rendered = options.racingRenderers ? new Uint8Array(Buffer.concat([bytes, Buffer.from(`\n% renderer variant ${sequence}\n`)])) : bytes;
    state.renders.push(rendered); return rendered;
  }});
  const core = loader.load('@/lib/documents/native-contract-archive');
  Object.assign(coreAdapter, core, {
    createNativeContractArchiveRegistrationClient: config => core.createNativeContractArchiveRegistrationClient({...config, fetchImpl: serviceFetch}),
    createNativeContractArchiveUploader: config => core.createNativeContractArchiveUploader({...config, fetchImpl: storageFetch}),
  });
  const actions = loader.load('@/lib/data/contract-archive-actions');
  const routes = {
    pdf: loader.load('src/app/api/contract-signings/[id]/pdf/route.ts'),
    evidence: loader.load('src/app/api/contract-signings/[id]/evidence/route.ts'),
  };
  return {
    state, actions, load: loader.load,
    archive: (requestId = ARCHIVE_REQUEST) => actions.archiveContractAction({companyId: ARCHIVE_COMPANY, signingId: ARCHIVE_SIGNING, requestId}),
    async get(format = 'pdf', customer = false) {
      state.actor = customer ? 'customer' : 'dealer';
      const suffix = customer ? '' : `?companyId=${ARCHIVE_COMPANY}`;
      return routes[format].GET(new Request(`https://app.trafexa.com/api/contract-signings/${ARCHIVE_SIGNING}/${format}${suffix}`), {params: Promise.resolve({id: ARCHIVE_SIGNING})});
    },
  };
}
