// Reproduce: npm ci --prefix tests/crm-db --ignore-scripts
// Then: node tests/company-store-profile-db/cross-layer.test.mjs
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createDatabase, asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader} from '../helpers/source-loader.mjs';

const ORIGIN = 'https://app.trafexa.com';
const digest = value => createHash('sha256').update(value).digest('hex');
let database, seed, fixture;
before(async () => {
  database = await createDatabase({approveEstablishedFixtures: false});
  const proof = await readFile(new URL('../../supabase/tests/company_store_profile.sql', import.meta.url), 'utf8');
  seed = proof.split('-- BEGIN COMPANY STORE PROFILE FIXTURES')[1]?.split('-- END COMPANY STORE PROFILE FIXTURES')[0];
  assert.ok(seed, 'Reuse the native SQL fixture rather than synthetic RPC-shaped DTOs');
});
beforeEach(async () => {
  await database.exec(`begin; truncate auth.users cascade; ${seed} commit;`);
  const {rows} = await database.query(`select m.company_id,m.user_id,m.role,c.organisation_number
    from public.memberships m join public.companies c on c.id=m.company_id
    join auth.users u on u.id=m.user_id join private.account_approvals a on a.user_id=u.id
    where m.status='active' and c.status='active' and a.status='approved'
    and u.email_confirmed_at is not null and not u.is_anonymous order by m.company_id,m.role,m.user_id`);
  const owner = rows.find(row => row.role === 'owner'); assert.ok(owner);
  fixture = {company: owner.company_id, owner: owner.user_id,
    finance: rows.find(row => row.company_id === owner.company_id && row.role === 'finance')?.user_id,
    foreign: rows.find(row => row.company_id !== owner.company_id && row.role === 'owner')?.company_id};
});
after(async () => { await database?.close(); });

/** Actual Request/Response handlers, actions, contexts, parsers and migrated SQL.
 * Only SDK I/O and selected-company routing are adapted. This is not hosted Auth,
 * PostgREST or a browser session, and does not prove concurrent PostgreSQL locks. */
async function integration({actor = fixture.owner, company = fixture.company} = {}) {
  const state = {actor, company, authenticated: true, calls: [], databaseErrors: [], invalidations: [], cookieWrites: [], afterRpc: null, loseReceipt: null};
  const db = {
    auth: {async getUser() {
      state.calls.push(['auth']);
      if (!state.authenticated) return {data: {user: null}, error: null};
      const {rows} = await database.query('select id,email,email_confirmed_at::text,is_anonymous from auth.users where id=$1', [state.actor]);
      return {data: {user: rows[0] ?? null}, error: null};
    }},
    from(table) {
      assert.equal(table, 'memberships');
      const filters = {}, query = {
        select() { return query; }, eq(key, value) { filters[key] = value; return query; },
        async maybeSingle() {
          const data = await asRole(database, 'authenticated', state.actor, async tx => {
            const {rows} = await tx.query(`select m.company_id,m.user_id,m.role,m.status,
              jsonb_build_object('id',c.id,'status',c.status) companies
              from public.memberships m join public.companies c on c.id=m.company_id
              where m.company_id=$1 and m.user_id=$2 and m.status=$3 and c.status=$4`,
            [filters.company_id, filters.user_id, filters.status, filters['companies.status']]);
            return rows[0] ?? null;
          });
          state.calls.push(['membership']); return {data, error: null};
        },
      };
      return query;
    },
    rpc(name, args) {
      assert.ok(['get_account_access', 'create_company_with_profile', 'get_company_store_profile', 'save_company_store_profile', 'prepare_company_store_export', 'get_company_store_export'].includes(name), `Unexpected user RPC ${name}`);
      state.calls.push(['rpc', name, structuredClone(args)]);
      const request = Promise.resolve().then(async () => {
        try {
          const entries = Object.entries(args);
          assert.ok(entries.every(([key]) => /^p_[a-z_][a-z_0-9]*$/.test(key)));
          const parameters = entries.map(([key], index) => `${key} => $${index + 1}`).join(',');
          const data = await asRole(database, 'authenticated', state.actor, async tx =>
            (await tx.query(`select public.${name}(${parameters}) result`, entries.map(([, value]) => value))).rows[0].result);
          if (state.afterRpc) await state.afterRpc(name, data);
          if (state.loseReceipt === name) { state.loseReceipt = null; return {data: null, error: {code: 'FIXTURE_NETWORK', message: 'PRIVATE lost response after commit'}}; }
          return {data, error: null};
        } catch (error) { state.databaseErrors.push({code: error.code, message: error.message}); return {data: null, error: {code: error.code, message: 'PRIVATE database details'}}; }
      });
      request.abortSignal = signal => { assert.ok(signal instanceof AbortSignal); return request; };
      return request;
    },
  };
  const loader = await createSourceLoader({
    'next/cache': {revalidatePath: path => state.invalidations.push(path)},
    'next/headers': {async cookies() { return {set: (...args) => state.cookieWrites.push(args)}; }},
    '@/lib/supabase/server': {async createServerSupabaseClient() { return db; }},
    '../supabase/server': {async createServerSupabaseClient() { return db; }},
    '@/lib/data/company-context': {async getActiveCompanyContext() { return {db, company: state.company, user: state.actor, role: 'owner'}; }},
  });
  const actions = loader.load('@/lib/data/company-store-profile-actions');
  const routes = {
    company: loader.load('src/app/api/dealer-companies/route.ts'),
    profile: loader.load('src/app/api/company-store-profile/route.ts'),
    exports: loader.load('src/app/api/company-store-profile/exports/route.ts'),
    download: loader.load('src/app/api/company-store-profile/exports/[exportId]/route.ts'),
  };
  return {state, actions, routes};
}
function request(path, method = 'GET', body, headers = {}) {
  return new Request(`${ORIGIN}${path}`, {method, headers: {...(body === undefined ? {} : {'Content-Type': 'application/json', Origin: ORIGIN}), ...headers}, ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)})});
}
function privateHeaders(response) {
  assert.match(response.headers.get('cache-control'), /private,\s*no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
}
function fields(overrides = {}) {
  return {displayName: 'Fiktiv Bilhandel ÅÄÖ', addressLine1: 'Fiktivgatan 42', addressLine2: null,
    postalCode: '11122', city: 'Stockholm', countryCode: 'SE', publicEmail: 'butik@fixture.invalid', publicPhone: '+46 70 123 45 67',
    websiteUrl: 'https://trafexa.com/butik', logoUrl: 'https://trafexa.com/logo.png',
    description: 'Fiktiv publik butiksbeskrivning.\nÅterförsäljare med granskade uppgifter.', openingHoursText: 'Måndag–fredag 09–18\nLördag 10–14', ...overrides};
}
async function body(response, status = 200) {
  privateHeaders(response); const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value)); return value;
}
async function readProfile(h) {
  return body(await h.routes.profile.GET(request(`/api/company-store-profile?companyId=${h.state.company}`)));
}
async function saveProfile(h, overrides = {}) {
  const page = await readProfile(h), value = {companyId: h.state.company, expectedVersion: page.profile?.version ?? 0,
    fields: fields(overrides), reviewAcknowledged: true, requestId: randomUUID()};
  const saved = await body(await h.routes.profile.PUT(request('/api/company-store-profile', 'PUT', value)));
  assert.equal(saved.ok, true, JSON.stringify({saved, databaseErrors: h.state.databaseErrors}));
  return {saved, value};
}
function exportInput(page, overrides = {}) {
  return {companyId: page.companyId, expectedVersion: page.source.profileVersion, expectedSourceSha256: page.sourceSha256,
    channel: 'blocket', purpose: 'existing_store', reviewAcknowledged: true, attestationVersion: '2026-10-15', requestId: randomUUID(), ...overrides};
}
async function prepare(h, page, overrides = {}) {
  const value = exportInput(page, overrides), response = await h.routes.exports.POST(request('/api/company-store-profile/exports', 'POST', value));
  const prepared = await body(response, 201); assert.equal(prepared.ok, true, JSON.stringify({prepared, databaseErrors: h.state.databaseErrors}));
  return {prepared, value};
}
function download(h, exportId, {companyId = h.state.company, headers = {}, query = ''} = {}) {
  return h.routes.download.GET(request(`/api/company-store-profile/exports/${exportId}?companyId=${companyId}${query}`, 'GET', undefined, headers), {params: Promise.resolve({exportId})});
}

test('company profile cross-layer: an existing member atomically creates another company and recovers the historical creation receipt after an unknown response and later profile edit', async () => {
  const h = await integration(), selectedBefore = h.state.company;
  const input = {legalName: 'Fiktiv Ny Bilhandel AB', organisationNumber: '5568554884', fields: fields(), representationAcknowledged: true, requestId: randomUUID()};
  h.state.loseReceipt = 'create_company_with_profile';
  const lost = await body(await h.routes.company.POST(request('/api/dealer-companies', 'POST', input)), 503);
  assert.equal(lost.code, 'unavailable'); assert.equal(h.state.company, selectedBefore);
  const replay = await body(await h.routes.company.POST(request('/api/dealer-companies', 'POST', input)), 201);
  assert.equal(replay.ok, true); assert.notEqual(replay.companyId, selectedBefore); assert.equal(replay.role, 'owner'); assert.equal(replay.profile.version, 1);
  assert.deepEqual(replay.profile.fields, input.fields); assert.equal(replay.source.legalName, input.legalName);
  assert.equal(h.state.cookieWrites[0][0], 'trafexa-company'); assert.equal(h.state.cookieWrites[0][1], replay.companyId);
  assert.equal(h.state.cookieWrites[0][2].httpOnly, true); assert.equal(h.state.cookieWrites[0][2].sameSite, 'lax');
  const {rows} = await database.query(`select c.id,m.role,m.status,(select count(*)::integer from private.company_store_profile_versions p where p.company_id=c.id) profiles
    from public.companies c join public.memberships m on m.company_id=c.id where c.name=$1 and m.user_id=$2`, [input.legalName, fixture.owner]);
  assert.deepEqual(rows, [{id: replay.companyId, role: 'owner', status: 'active', profiles: 1}]);
  h.state.company = replay.companyId;
  const {saved} = await saveProfile(h, {displayName: 'Senare butiksnamn'}); assert.equal(saved.profile.version, 2);
  const historical = await body(await h.routes.company.POST(request('/api/dealer-companies', 'POST', input)), 201);
  assert.deepEqual(historical, replay); assert.equal((await readProfile(h)).profile.version, 2);
});

test('company profile cross-layer: save and reviewed export preserve exact persisted canonical bytes, checksum and historical identity after current data changes', async () => {
  const h = await integration(), {saved} = await saveProfile(h), {prepared, value} = await prepare(h, saved);
  const current = await readProfile(h); assert.equal(current.exports[0].id, prepared.export.id);
  const persisted = (await database.query('select canonical_content,export_sha256,snapshot from private.company_store_exports where id=$1', [prepared.export.id])).rows[0];
  const response = await download(h, prepared.export.id), bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200); privateHeaders(response); assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('content-disposition'), `attachment; filename="trafexa-butiksprofil-${prepared.export.id}.json"`);
  assert.equal(bytes.toString('utf8'), persisted.canonical_content); assert.equal(digest(bytes), persisted.export_sha256);
  assert.equal(response.headers.get('x-trafexa-content-sha256'), persisted.export_sha256); assert.equal(response.headers.get('etag'), `"${persisted.export_sha256}"`);
  assert.deepEqual(JSON.parse(bytes).profile, persisted.snapshot); assert.equal(JSON.parse(bytes).kind, 'trafexa_store_profile');
  assert.equal(JSON.parse(bytes).channel, 'blocket'); assert.equal(JSON.parse(bytes).purpose, 'existing_store');
  await saveProfile(h, {displayName: 'Nyare butiksversion'});
  await database.query('update public.companies set name=$1 where id=$2', ['Senare juridiskt namn', fixture.company]);
  const historical = await download(h, prepared.export.id, {headers: {'If-None-Match': `"${persisted.export_sha256}"`}});
  assert.equal(historical.status, 200); assert.deepEqual(Buffer.from(await historical.arrayBuffer()), bytes);
  const retried = await body(await h.routes.exports.POST(request('/api/company-store-profile/exports', 'POST', value)), 201);
  assert.deepEqual(retried.export, prepared.export);
  const stale = await body(await h.routes.exports.POST(request('/api/company-store-profile/exports', 'POST', {...value, requestId: randomUUID()})), 409);
  assert.equal(stale.code, 'conflict');
  assert.equal((await database.query('select count(*)::integer n from private.company_store_exports where company_id=$1', [fixture.company])).rows[0].n, 1);
});

test('company profile cross-layer: fresh role, tenant and approval checks withhold private bytes even after a successful export RPC', async () => {
  const h = await integration(), {saved} = await saveProfile(h), {prepared} = await prepare(h, saved);
  assert.ok(fixture.finance); assert.ok(fixture.foreign);
  const finance = await integration({actor: fixture.finance});
  const deniedRole = await body(await download(finance, prepared.export.id), 403); assert.equal(deniedRole.code, 'access_denied');
  assert.ok(!finance.state.calls.some(call => call[1] === 'get_company_store_export'));
  const deniedTenant = await body(await download(h, prepared.export.id, {companyId: fixture.foreign}), 403); assert.equal(deniedTenant.code, 'access_denied');
  h.state.afterRpc = async name => {
    if (name === 'get_company_store_export') { h.state.afterRpc = null; await database.query("update private.account_approvals set status='suspended',version=version+1 where user_id=$1", [fixture.owner]); }
  };
  const revoked = await body(await download(h, prepared.export.id), 403); assert.equal(revoked.code, 'access_denied');
  assert.doesNotMatch(JSON.stringify(revoked), /canonicalContent|organisationNumber|butik@|PRIVATE/);
  h.state.authenticated = false;
  const signedOut = await body(await download(h, prepared.export.id), 401); assert.equal(signedOut.code, 'unauthenticated');
});

test('company profile cross-layer: legacy invalid legal identity remains readable and editable but cannot create a channel export', async () => {
  const legacy = (await database.query("select id from public.companies where organisation_number='0000000000'" )).rows[0]; assert.ok(legacy);
  const h = await integration({company: legacy.id}), initial = await readProfile(h); assert.equal(initial.identityValid, false);
  const {saved} = await saveProfile(h), current = await readProfile(h);
  assert.equal(current.profile.id, saved.profile.id); assert.equal(current.identityValid, false); assert.equal(current.canExport, false);
  assert.equal(current.reason, 'invalid_organisation_number'); assert.equal(current.organisationNumber, '0000000000');
  const rejected = await body(await h.routes.exports.POST(request('/api/company-store-profile/exports', 'POST', exportInput(saved))), 400);
  assert.equal(rejected.code, 'invalid_input');
  assert.equal((await database.query('select count(*)::integer n from private.company_store_exports where company_id=$1', [legacy.id])).rows[0].n, 0);
});

test('company profile cross-layer: private HTTP boundaries reject CSRF, media/body attacks and ambiguous tenant queries before any SDK I/O', async () => {
  const h = await integration(), path = '/api/company-store-profile';
  const input = {companyId: fixture.company, expectedVersion: 0, fields: fields(), reviewAcknowledged: true, requestId: randomUUID()};
  const attempts = [
    [request(path, 'PUT', input, {Origin: 'https://attacker.invalid'}), 403],
    [request(path, 'PUT', input, {Origin: 'null'}), 403],
    [request(path, 'PUT', input, {'Content-Type': 'text/plain'}), 415],
    [request(path, 'PUT', '{}', {'Content-Length': '65537'}), 413],
    [request(path, 'PUT', ' '.repeat(65537), {'Content-Length': '1'}), 413],
    [request(path, 'PUT', '{"fields":'), 400],
    [request(`${path}?companyId=${fixture.company}`, 'PUT', input), 400],
  ];
  for (const [req, status] of attempts) { const rejected = await body(await h.routes.profile.PUT(req), status); assert.equal(rejected.ok, false); }
  const noOrigin = new Request(`${ORIGIN}${path}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)});
  await body(await h.routes.profile.PUT(noOrigin), 403);
  const invalidUtf8 = new Request(`${ORIGIN}${path}`, {method: 'PUT', headers: {'Content-Type': 'application/json', Origin: ORIGIN}, body: new Uint8Array([0x7b,0x22,0xc3,0x28,0x22,0x7d])});
  await body(await h.routes.profile.PUT(invalidUtf8), 400);
  for (const query of [`companyId=${fixture.company}&companyId=${fixture.company}`, `companyId=${fixture.company}&callback=x`, 'companyId=bad-id', '']) {
    await body(await h.routes.profile.GET(request(`${path}?${query}`)), 400);
  }
  await body(await h.routes.profile.PUT(request(path, 'PUT', {...input, fields: {...input.fields, providerPassword: 'PRIVATE MUST NOT BE STORED'}})), 400);
  assert.equal(h.state.calls.length, 0, 'Rejected transport requests must not reach private authorization or data RPCs');
  assert.deepEqual(Object.keys(h.routes.profile).filter(key => /^[A-Z]+$/.test(key)).sort(), ['GET', 'PUT']);
  assert.deepEqual(Object.keys(h.routes.exports).filter(key => /^[A-Z]+$/.test(key)), ['POST']);
  assert.deepEqual(Object.keys(h.routes.company).filter(key => /^[A-Z]+$/.test(key)), ['POST']);
});
