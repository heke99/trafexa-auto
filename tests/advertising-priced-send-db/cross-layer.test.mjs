// Reproduce: npm ci --prefix tests/crm-db --ignore-scripts
// Then: node tests/advertising-priced-send-db/cross-layer.test.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {createDatabase, asRole} from '../crm-db/helpers.mjs';
import {createSourceLoader} from '../helpers/source-loader.mjs';
import {fixtureSql, id, U, C, S, L, P, SALES, FOREIGN, rate, counts, publish} from './fixtures.mjs';

let database;
before(async () => { database = await createDatabase(); });
beforeEach(async () => {
  await database.exec(`begin; truncate auth.users,private.advertising_dispatchers cascade; ${fixtureSql} commit;`);
});
after(async () => { await database?.close(); });

/** Actual actions, authorization contexts, parsers and complete migrated SQL.
 * Only Supabase SDK transport and selected-company routing are adapted. The
 * service receipts below are synthetic: this does not prove hosted Auth,
 * PostgREST, provider acceptance, browser behavior or concurrent SQL locks. */
async function integration({actor = U, company = C} = {}) {
  const state = {actor, company, authenticated: true, calls: [], errors: [], invalidations: [], loseReceipt: null};
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
    async rpc(name, args) {
      assert.ok(['get_advertising_send_quote', 'send_vehicle_advertisement_priced', 'list_company_advertising', 'save_vehicle_advertisement',
        'list_advertising_billing', 'list_advertising_quantities'].includes(name), `Unexpected dealer RPC ${name}`);
      state.calls.push(['rpc', name, structuredClone(args)]);
      try {
        const entries = Object.entries(args);
        assert.ok(entries.every(([key]) => /^p_[a-z_][a-z_0-9]*$/.test(key)));
        const parameters = entries.map(([key], index) => `${key} => $${index + 1}`).join(',');
        const data = await asRole(database, 'authenticated', state.actor, async tx =>
          (await tx.query(`select public.${name}(${parameters}) result`, entries.map(([, value]) => value))).rows[0].result);
        if (state.loseReceipt === name) {
          state.loseReceipt = null;
          return {data: null, error: {code: 'FIXTURE_NETWORK', message: 'PRIVATE lost response after commit'}};
        }
        return {data, error: null};
      } catch (error) {
        state.errors.push({code: error.code, message: error.message});
        return {data: null, error: {code: error.code, message: 'PRIVATE database details'}};
      }
    },
  };
  const loader = await createSourceLoader({
    'next/cache': {revalidatePath: path => state.invalidations.push(path)},
    '@/lib/supabase/server': {async createServerSupabaseClient() { return db; }},
    '@/lib/data/company-context': {async getActiveCompanyContext() { return {db, company: state.company, user: state.actor, role: 'owner'}; }},
  });
  return {state, actions: loader.load('@/lib/advertising/actions'),
    billing: loader.load('@/lib/advertising/billing-actions'), usage: loader.load('@/lib/advertising/usage-actions')};
}
const selection = (channels = ['blocket', 'wayke']) => ({companyId: C, listingId: L, expectedVersion: 2, channels});
const sendInput = (quote, overrides = {}) => ({...selection(quote.channels), expectedQuoteToken: quote.reviewToken, requestId: randomUUID(), ...overrides});
function success(result, h) {
  assert.equal(result.ok, true, JSON.stringify({result, databaseErrors: h.state.errors})); return result;
}
const emptyCounts = {jobs: 0, commitments: 0, bindings: 0, audits: 0, publications: 0, prices: 0};
async function month() {
  return (await database.query("select to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM') as period")).rows[0].period;
}

test('priced send cross-layer: selected channels, frozen accepted prices and verified publication counts agree with existing billing and usage actions', async () => {
  await rate(database, 'blocket', '12500'); await rate(database, 'wayke', '700', 0, id(21));
  const h = await integration();
  const reviewed = success(await h.actions.getAdvertisingSendQuoteAction(selection(['wayke', 'blocket'])), h).quote;
  assert.deepEqual(reviewed.channels, ['blocket', 'wayke']); assert.equal(reviewed.totalOre, '13200');
  assert.equal(reviewed.taxBasis, 'exclusive'); assert.equal(reviewed.currency, 'SEK');
  const input = sendInput(reviewed), sent = success(await h.actions.sendAdvertisingListingAction(input), h).receipt;
  assert.deepEqual(sent.quote, reviewed); assert.deepEqual(sent.jobs.map(job => job.channel), ['blocket', 'wayke']);
  assert.deepEqual(await counts(database), {jobs: 2, commitments: 2, bindings: 2, audits: 1, publications: 0, prices: 0});
  const persisted = (await database.query('select receipt from private.advertising_audit where actor_user_id=$1 and request_id=$2', [U, input.requestId])).rows[0].receipt;
  assert.deepEqual(persisted.quote, reviewed); assert.deepEqual(persisted.jobs.map(job => job.id), sent.jobs.map(job => job.id));
  const period = await month();
  const pending = success(await h.billing.listAdvertisingBillingAction({companyId: C, month: period}), h).page;
  assert.equal(pending.count, 0); assert.equal(pending.totalOre, '0');
  const queued = success(await h.usage.listAdvertisingUsageAction({companyId: C, month: period}), h);
  assert.equal(queued.totals.queued, 2); assert.equal(queued.totals.newPublications, 0);
  await rate(database, 'blocket', '99000', 1, id(22));
  const frozen = success(await h.actions.getAdvertisingSendQuoteAction(selection()), h).quote;
  assert.equal(frozen.reviewToken, reviewed.reviewToken); assert.equal(frozen.items[0].unitPriceOre, '12500');
  await publish(database, sent.jobs[0], 'cross-layer-blocket');
  const first = success(await h.billing.listAdvertisingBillingAction({companyId: C, month: period}), h).page;
  assert.equal(first.count, 1); assert.equal(first.totalOre, '12500');
  assert.equal(first.items[0].rateVersion, 1); assert.equal(first.items[0].priceSource, 'rate');
  await publish(database, sent.jobs[1], 'cross-layer-wayke');
  const billed = success(await h.billing.listAdvertisingBillingAction({companyId: C, month: period}), h).page;
  assert.equal(billed.count, 2); assert.equal(billed.unpricedCount, 0); assert.equal(billed.totalOre, reviewed.totalOre);
  const usage = success(await h.usage.listAdvertisingUsageAction({companyId: C, month: period}), h);
  assert.equal(usage.totals.newPublications, 2); assert.equal(usage.totals.published, 2);
  assert.deepEqual(usage.channels.map(row => [row.channel, row.newPublications]), [['blocket', 1], ['wayke', 1]]);
  assert.equal(usage.billing.unpricedPublications, 0);
  const already = success(await h.actions.getAdvertisingSendQuoteAction(selection()), h).quote;
  assert.equal(already.totalOre, '0'); assert.ok(already.items.every(item => item.alreadyPublished && item.chargeOre === '0'));
  assert.deepEqual(success(await h.actions.sendAdvertisingListingAction(input), h).receipt, sent);
  assert.deepEqual(await counts(database), {jobs: 2, commitments: 2, bindings: 2, audits: 1, publications: 2, prices: 2});
});

test('priced send cross-layer: one selected channel creates no jobs or billing commitments for the unchecked channel', async () => {
  await rate(database, 'blocket', '0'); await rate(database, 'wayke', '9007199254740993', 0, id(21));
  const h = await integration(), q = success(await h.actions.getAdvertisingSendQuoteAction(selection(['blocket'])), h).quote;
  assert.equal(q.totalOre, '0'); assert.equal(q.items[0].unitPriceOre, '0');
  const sent = success(await h.actions.sendAdvertisingListingAction(sendInput(q)), h).receipt;
  assert.equal(sent.jobs.length, 1); assert.equal(sent.jobs[0].channel, 'blocket');
  const bindings = (await database.query(`select j.channel,c.unit_price_ore::text from private.advertising_jobs j
    join private.advertising_job_price_commitments b on b.job_id=j.id
    join private.advertising_charge_commitments c on c.company_id=b.company_id and c.listing_id=b.listing_id and c.channel=b.channel`)).rows;
  assert.deepEqual(bindings, [{channel: 'blocket', unit_price_ore: '0'}]);
  await publish(database, sent.jobs[0], 'cross-layer-free');
  const billed = success(await h.billing.listAdvertisingBillingAction({companyId: C, month: await month()}), h).page;
  assert.equal(billed.count, 1); assert.equal(billed.totalOre, '0');
  assert.equal(billed.items[0].channel, 'blocket');
});

test('priced send cross-layer: missing rates, bad or stale review tokens and unavailable selected connections fail without partial writes', async () => {
  const h = await integration();
  const missing = success(await h.actions.getAdvertisingSendQuoteAction(selection()), h).quote;
  assert.equal(missing.totalOre, null);
  assert.equal((await h.actions.sendAdvertisingListingAction(sendInput(missing))).code, 'invalid_input');
  await rate(database, 'blocket', '12500');
  const partlyMissing = success(await h.actions.getAdvertisingSendQuoteAction(selection()), h).quote;
  assert.equal(partlyMissing.totalOre, null); assert.equal(partlyMissing.items[0].unitPriceOre, '12500');
  assert.equal((await h.actions.sendAdvertisingListingAction(sendInput(partlyMissing))).code, 'invalid_input');
  const q = success(await h.actions.getAdvertisingSendQuoteAction(selection(['blocket'])), h).quote;
  assert.equal((await h.actions.sendAdvertisingListingAction(sendInput(q, {expectedQuoteToken: '0'.repeat(64)}))).code, 'conflict');
  const calls = h.state.calls.length;
  assert.equal((await h.actions.sendAdvertisingListingAction(sendInput(q, {expectedQuoteToken: 'invalid'}))).code, 'invalid_input');
  assert.equal(h.state.calls.length, calls, 'Malformed tokens never reach Auth or SQL');
  await rate(database, 'blocket', '13000', 1, id(22));
  assert.equal((await h.actions.sendAdvertisingListingAction(sendInput(q))).code, 'conflict');
  await rate(database, 'wayke', '700', 0, id(21));
  const both = success(await h.actions.getAdvertisingSendQuoteAction(selection()), h).quote;
  await database.query("update private.advertising_connections set status='disabled' where company_id=$1 and channel='wayke'", [C]);
  assert.equal((await h.actions.sendAdvertisingListingAction(sendInput(both))).code, 'connection_required');
  assert.deepEqual(await counts(database), emptyCounts);
});

test('priced send cross-layer: live membership, approval, actor and selected-company boundaries protect quote and send', async () => {
  await rate(database);
  const owner = await integration(), q = success(await owner.actions.getAdvertisingSendQuoteAction(selection(['blocket'])), owner).quote;
  const outsider = await integration({actor: FOREIGN});
  assert.equal((await outsider.actions.getAdvertisingSendQuoteAction(selection(['blocket']))).code, 'access_denied');
  assert.equal((await outsider.actions.sendAdvertisingListingAction(sendInput(q))).code, 'access_denied');
  const wrongCompany = await integration({company: id(99)});
  assert.equal((await wrongCompany.actions.getAdvertisingSendQuoteAction(selection(['blocket']))).code, 'access_denied');
  assert.equal((await wrongCompany.actions.sendAdvertisingListingAction(sendInput(q))).code, 'access_denied');
  assert.ok(!wrongCompany.state.calls.some(([kind]) => kind === 'rpc'));
  const signedOut = await integration(); signedOut.state.authenticated = false;
  assert.equal((await signedOut.actions.sendAdvertisingListingAction(sendInput(q))).code, 'unauthenticated');
  const sales = await integration({actor: SALES});
  const salesQuote = success(await sales.actions.getAdvertisingSendQuoteAction(selection(['blocket'])), sales).quote;
  assert.equal(salesQuote.actorUserId, SALES); assert.notEqual(salesQuote.reviewToken, q.reviewToken);
  assert.equal((await sales.actions.sendAdvertisingListingAction(sendInput(q))).code, 'conflict');
  assert.equal((await sales.billing.listAdvertisingBillingAction({companyId: C, month: await month()})).code, 'access_denied');
  await database.query("update public.memberships set status='suspended' where company_id=$1 and user_id=$2", [C, U]);
  assert.equal((await owner.actions.sendAdvertisingListingAction(sendInput(q))).code, 'access_denied');
  await database.query("update public.memberships set status='active' where company_id=$1 and user_id=$2", [C, U]);
  await database.query("update private.account_approvals set status='suspended' where user_id=$1", [U]);
  assert.equal((await owner.actions.sendAdvertisingListingAction(sendInput(q))).code, 'access_denied');
  assert.deepEqual(await counts(database), emptyCounts);
});

test('priced send cross-layer: lost committed response retries recover the exact historical receipt without another job or charge', async () => {
  await rate(database);
  const h = await integration(), q = success(await h.actions.getAdvertisingSendQuoteAction(selection(['blocket'])), h).quote;
  const input = sendInput(q); h.state.loseReceipt = 'send_vehicle_advertisement_priced';
  const lost = await h.actions.sendAdvertisingListingAction(input);
  assert.equal(lost.code, 'unavailable'); assert.doesNotMatch(JSON.stringify(lost), /PRIVATE|priced-owner/);
  const recovered = success(await h.actions.sendAdvertisingListingAction(input), h).receipt;
  await rate(database, 'blocket', '99900', 1, id(22));
  const edited = success(await h.actions.saveAdvertisingListingAction({companyId: C, stockItemId: S, listingId: L, expectedVersion: 2,
    title: 'Senare annonsversion', description: 'Nyare text', photoIds: [P], includeRegistrationNumber: false, requestId: randomUUID()}), h);
  assert.equal(edited.receipt.listing.version, 3);
  assert.deepEqual(success(await h.actions.sendAdvertisingListingAction(input), h).receipt, recovered);
  assert.equal(recovered.quote.totalOre, '12500');
  assert.deepEqual(await counts(database), {jobs: 1, commitments: 1, bindings: 1, audits: 2, publications: 0, prices: 0});
  const changed = await h.actions.sendAdvertisingListingAction({...input, channels: ['wayke']});
  assert.equal(changed.code, 'conflict');
  const page = success(await h.actions.listAdvertisingWorkspaceAction({companyId: C}), h);
  assert.equal(page.jobs.length, 1); assert.equal(page.jobs[0].id, recovered.jobs[0].id);
  await database.query("update private.account_approvals set status='suspended' where user_id=$1", [U]);
  assert.equal((await h.actions.sendAdvertisingListingAction(input)).code, 'access_denied');
  assert.deepEqual(await counts(database), {jobs: 1, commitments: 1, bindings: 1, audits: 2, publications: 0, prices: 0});
});
