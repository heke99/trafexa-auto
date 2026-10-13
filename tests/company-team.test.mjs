import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';

const COMPANY = '10000000-0000-4000-8000-000000000001';
const FOREIGN = '10000000-0000-4000-8000-000000000002';
const MEMBERSHIP = '20000000-0000-4000-8000-000000000001';
const NEXT_MEMBER = '20000000-0000-4000-8000-000000000002';
const INVITATION = '30000000-0000-4000-8000-000000000001';
const NEXT_INVITATION = '30000000-0000-4000-8000-000000000002';
const USER = '40000000-0000-4000-8000-000000000001';
const OTHER_USER = '40000000-0000-4000-8000-000000000002';
const REQUEST = '50000000-0000-4000-8000-000000000001';
const NOW = '2026-10-13T18:00:00Z';
const EXPIRES = '2026-10-20T18:00:00Z';
const user = { id: USER, email: 'verified@example.com', email_confirmed_at: NOW, is_anonymous: false, user_metadata: { role: 'owner' } };
const targetMember = { id: MEMBERSHIP, userId: OTHER_USER, email: 'member@example.com', role: 'sales', status: 'active', version: 1, createdAt: NOW };
const invite = { id: INVITATION, email: 'invite@example.com', role: 'sales', status: 'pending', version: 1, expiresAt: EXPIRES, createdAt: NOW };
const createInput = { companyId: COMPANY, email: 'invite@example.com', role: 'sales', expectedTeamVersion: 1, requestId: REQUEST };
const cancelInput = { companyId: COMPANY, invitationId: INVITATION, expectedVersion: 1, reason: 'Inbjudan behövs inte', requestId: REQUEST };
const updateInput = { companyId: COMPANY, membershipId: MEMBERSHIP, expectedVersion: 1, role: 'finance', status: 'suspended', reason: 'Arbetsuppgifterna ändras', requestId: REQUEST };
const acceptInput = { invitationId: INVITATION, expectedVersion: 1, requestId: REQUEST };
const acceptanceReceipt = { companyId: COMPANY, teamVersion: 3, invitationId: INVITATION, membershipId: MEMBERSHIP, userId: USER, role: 'sales', status: 'active', version: 1, actorUserId: USER, requestId: REQUEST };

async function fixture(options = {}) {
  const calls = [], queries = [], cookieWrites = [], invalidations = [];
  const actorRole = options.actorRole ?? 'owner';
  const actorMembership = options.actorMembership === undefined ? { company_id: COMPANY, user_id: USER, role: actorRole, status: 'active', companies: { id: COMPANY, status: 'active' } } : options.actorMembership;
  const acceptedMembership = options.acceptedMembership === undefined ? { id: MEMBERSHIP, company_id: COMPANY, user_id: USER, role: 'sales', status: 'active', companies: { id: COMPANY, status: 'active' } } : options.acceptedMembership;
  const db = {
    auth: { async getUser() { calls.push(['auth']); return { data: { user: options.user === undefined ? user : options.user }, error: options.authError ?? null }; } },
    from(table) {
      const query = { table, select: null, filters: [] }; queries.push(query); calls.push(['from', table]);
      const builder = {
        select(fields) { query.select = fields; return builder; },
        eq(field, value) { query.filters.push([field, value]); return builder; },
        async maybeSingle() {
          const accepting = query.filters.some(([field]) => field === 'id');
          return { data: accepting ? acceptedMembership : actorMembership, error: accepting ? options.acceptedLookupError ?? null : options.actorLookupError ?? null };
        },
      }; return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (options.rpc) { const result = await options.rpc(name, args); if (result !== undefined) return result; }
      if (name === 'list_company_team') return { data: options.teamPage ?? { companyId: COMPANY, actorUserId: USER, actorRole, teamVersion: 1, members: [targetMember], invitations: [invite], nextMembersPageKey: null, nextInvitationsPageKey: null }, error: options.rpcError ?? null };
      if (name === 'create_company_invitation') return { data: options.createReceipt ?? { companyId: COMPANY, teamVersion: 2, invitation: invite, actorUserId: USER, requestId: REQUEST }, error: options.rpcError ?? null };
      if (name === 'revoke_company_invitation') return { data: options.cancelReceipt ?? { companyId: COMPANY, teamVersion: 3, invitation: { ...invite, status: 'revoked', version: 2 }, actorUserId: USER, requestId: REQUEST }, error: options.rpcError ?? null };
      if (name === 'update_company_team_member') return { data: options.updateReceipt ?? { companyId: COMPANY, teamVersion: 3, member: { ...targetMember, role: 'finance', status: 'suspended', version: 2 }, actorUserId: USER, requestId: REQUEST }, error: options.rpcError ?? null };
      if (name === 'list_my_company_invitations') return { data: options.myPage ?? { invitations: [{ id: INVITATION, companyId: COMPANY, companyName: 'Dealer AB', role: 'sales', status: 'pending', version: 1, expiresAt: EXPIRES, createdAt: NOW }], nextPageKey: null }, error: options.rpcError ?? null };
      if (name === 'accept_company_invitation') return { data: options.acceptReceipt ?? acceptanceReceipt, error: options.rpcError ?? null };
      throw new Error('Unexpected RPC');
    },
  };
  const loader = await createSourceLoader({
    '@/lib/supabase/server': { async createServerSupabaseClient() { return db; } },
    '@/lib/data/company-context': { async getActiveCompanyContext() { calls.push(['company-context']); if (options.noCompany) throw new Error('No company membership'); return { db, company: options.selectedCompany ?? COMPANY, user: options.contextUser ?? USER, role: options.cachedRole ?? actorRole }; } },
    'next/headers': { async cookies() { return { set(...args) { cookieWrites.push(args); } }; } },
    'next/cache': { revalidatePath(path) { invalidations.push(path); } },
  });
  return { actions: loader.load('./src/lib/company-team/actions.ts'), calls, queries, cookieWrites, invalidations };
}

test('team list verifies fresh Auth, selected company and current active manager membership before user RPC', async () => {
  const { actions, calls, queries } = await fixture();
  const result = await actions.listCompanyTeamAction({ companyId: COMPANY });
  assert.equal(result.ok, true); assert.equal(result.actorUserId, USER); assert.equal(result.actorRole, 'owner');
  assert.deepEqual(calls.map(call => call[0]), ['auth', 'company-context', 'from', 'list_company_team']);
  assert.deepEqual(calls.at(-1)[1], { p_company_id: COMPANY, p_members_page_key: null, p_invitations_page_key: null, p_limit: 50 });
  assert.deepEqual(queries[0].filters, [['company_id', COMPANY], ['user_id', USER], ['status', 'active'], ['companies.status', 'active']]);
});

test('tenant selectors, fake cached owner metadata, revoked memberships and suspended companies never grant team access', async () => {
  for (const options of [{ selectedCompany: FOREIGN }, { contextUser: OTHER_USER }, { actorRole: 'viewer', cachedRole: 'owner' }, { actorMembership: null }, { actorMembership: { company_id: COMPANY, user_id: USER, role: 'owner', status: 'suspended', companies: { id: COMPANY, status: 'active' } } }, { actorMembership: { company_id: COMPANY, user_id: USER, role: 'owner', status: 'active', companies: { id: COMPANY, status: 'suspended' } } }, { noCompany: true }]) {
    const { actions, calls } = await fixture(options);
    assert.equal((await actions.inviteCompanyMemberAction(createInput)).code, 'access_denied');
    assert.equal(calls.some(call => call[0] === 'create_company_invitation'), false);
  }
});

test('anonymous, missing, unconfirmed and failed Auth sessions cannot read or mutate invitations', async () => {
  for (const options of [{ user: null }, { user: { ...user, is_anonymous: true } }, { user: { ...user, email_confirmed_at: null } }, { authError: { message: 'secret auth provider detail' } }]) {
    const { actions, calls } = await fixture(options);
    assert.equal((await actions.getMyInvitationsAction()).ok, false);
    assert.equal((await actions.acceptCompanyInvitationAction(acceptInput)).ok, false);
    assert.equal(calls.some(call => call[0] !== 'auth'), false);
  }
});

test('team pagination forwards independent bounded cursors and strips provider-only fields', async () => {
  const { actions, calls } = await fixture({ teamPage: { companyId: COMPANY, actorUserId: USER, actorRole: 'owner', teamVersion: 6, members: [{ ...targetMember, id: NEXT_MEMBER, raw_token: 'secret' }], invitations: [{ ...invite, id: NEXT_INVITATION, internal_audit: 'secret' }], nextMembersPageKey: NEXT_MEMBER, nextInvitationsPageKey: NEXT_INVITATION, private_data: 'secret' } });
  const result = await actions.listCompanyTeamAction({ companyId: COMPANY, membersPageKey: MEMBERSHIP, invitationsPageKey: INVITATION, limit: 1 });
  assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.deepEqual(calls.at(-1)[1], { p_company_id: COMPANY, p_members_page_key: MEMBERSHIP, p_invitations_page_key: INVITATION, p_limit: 1 });
});

test('strict whitelists and local type/version/body bounds reject forged identities and invalid filters', async () => {
  for (const [method, value] of [
    ['listCompanyTeamAction', { companyId: COMPANY, actorUserId: USER }], ['listCompanyTeamAction', { companyId: COMPANY, headers: { role: 'owner' } }], ['listCompanyTeamAction', { companyId: COMPANY, limit: 51 }], ['listCompanyTeamAction', { companyId: COMPANY, membersPageKey: 'eq.or.invalid' }],
    ['inviteCompanyMemberAction', { ...createInput, expectedTeamVersion: 2147483648 }], ['inviteCompanyMemberAction', { ...createInput, role: 'owner' }], ['inviteCompanyMemberAction', { ...createInput, email: 'invalid' }],
    ['cancelCompanyInvitationAction', { ...cancelInput, reason: 'a\nb' }], ['updateCompanyMemberAction', { ...updateInput, reason: 'x'.repeat(501) }], ['updateCompanyMemberAction', { ...updateInput, reason: ' ' }], ['updateCompanyMemberAction', { ...updateInput, status: 'deleted' }],
    ['getMyInvitationsAction', { email: 'victim@example.com' }], ['acceptCompanyInvitationAction', { ...acceptInput, userId: OTHER_USER }], ['acceptCompanyInvitationAction', { ...acceptInput, companyId: FOREIGN }], ['acceptCompanyInvitationAction', { ...acceptInput, email: 'victim@example.com' }], ['acceptCompanyInvitationAction', { ...acceptInput, expectedVersion: 0 }], ['acceptCompanyInvitationAction', null],
  ]) {
    const { actions, calls } = await fixture();
    assert.equal((await actions[method](value)).code, 'invalid_input');
    assert.deepEqual(calls, []);
  }
});

test('owner can invite admin, admin can invite only sales/finance/viewer, and recipient email is normalized', async () => {
  const owner = await fixture({ createReceipt: { companyId: COMPANY, teamVersion: 2, invitation: { ...invite, role: 'admin' }, actorUserId: USER, requestId: REQUEST } });
  assert.equal((await owner.actions.inviteCompanyMemberAction({ ...createInput, role: 'admin', email: '  Invite@Example.COM  ' })).ok, true);
  assert.equal(owner.calls.at(-1)[1].p_email, 'invite@example.com');
  const admin = await fixture({ actorRole: 'admin' });
  assert.equal((await admin.actions.inviteCompanyMemberAction({ ...createInput, role: 'admin' })).code, 'access_denied');
  assert.equal(admin.calls.some(call => call[0] === 'create_company_invitation'), false);
  assert.equal((await admin.actions.inviteCompanyMemberAction(createInput)).ok, true);
});

test('create/cancel/update use version CAS, immutable nonce and required reason with no actor override', async () => {
  const { actions, calls } = await fixture();
  assert.equal((await actions.inviteCompanyMemberAction(createInput)).ok, true);
  assert.equal((await actions.cancelCompanyInvitationAction({ ...cancelInput, reason: ' Inbjudan behövs inte ' })).ok, true);
  assert.equal((await actions.updateCompanyMemberAction(updateInput)).ok, true);
  assert.deepEqual(calls.find(call => call[0] === 'create_company_invitation')[1], { p_company_id: COMPANY, p_email: 'invite@example.com', p_role: 'sales', p_expected_team_version: 1, p_request_id: REQUEST });
  assert.deepEqual(calls.find(call => call[0] === 'revoke_company_invitation')[1], { p_company_id: COMPANY, p_invitation_id: INVITATION, p_expected_version: 1, p_reason: 'Inbjudan behövs inte', p_request_id: REQUEST });
  assert.deepEqual(calls.find(call => call[0] === 'update_company_team_member')[1], { p_company_id: COMPANY, p_membership_id: MEMBERSHIP, p_expected_version: 1, p_role: 'finance', p_status: 'suspended', p_reason: updateInput.reason, p_request_id: REQUEST });
  assert.equal(calls.filter(call => call[0] === 'auth').length, 3);
});

test('SQL owner/self/administrative-target protection and CAS errors are sanitized, with no false success', async () => {
  for (const [code, expected] of [['42501', 'access_denied'], ['40001', 'conflict'], ['23505', 'conflict'], ['P0002', 'not_found'], ['22023', 'invalid_input'], ['XX000', 'unavailable']]) {
    const { actions, invalidations } = await fixture({ rpcError: { code, message: 'private member email secret provider data' } });
    const result = await actions.updateCompanyMemberAction(updateInput);
    assert.equal(result.code, expected); assert.equal(JSON.stringify(result).includes('secret'), false); assert.deepEqual(invalidations, []);
  }
  const { actions, calls } = await fixture({ actorRole: 'admin' });
  assert.equal((await actions.updateCompanyMemberAction({ ...updateInput, role: 'admin' })).code, 'access_denied');
  assert.equal(calls.some(call => call[0] === 'update_company_team_member'), false);
});

test('mutation receipts must match company, actor, request, exact target, role, status and version', async () => {
  const base = { companyId: COMPANY, teamVersion: 3, member: { ...targetMember, role: 'finance', status: 'suspended', version: 2 }, actorUserId: USER, requestId: REQUEST };
  for (const patch of [{ companyId: FOREIGN }, { actorUserId: OTHER_USER }, { requestId: FOREIGN }, { member: { ...base.member, id: NEXT_MEMBER } }, { member: { ...base.member, userId: USER } }, { member: { ...base.member, role: 'owner' } }, { member: { ...base.member, status: 'active' } }, { member: { ...base.member, version: 5 } }]) {
    const { actions, invalidations } = await fixture({ updateReceipt: { ...base, ...patch } });
    assert.equal((await actions.updateCompanyMemberAction(updateInput)).code, 'unavailable');
    assert.deepEqual(invalidations, []);
  }
});

test('unchanged role/status accepts an audited no-op with unchanged version', async () => {
  const { actions } = await fixture({ updateReceipt: { companyId: COMPANY, teamVersion: 1, member: targetMember, actorUserId: USER, requestId: REQUEST } });
  const result = await actions.updateCompanyMemberAction({ ...updateInput, role: 'sales', status: 'active' });
  assert.equal(result.ok, true); assert.equal(result.receipt.member.version, 1);
});

test('unknown mutation outcome can retry the same nonce and exact immutable payload', async () => {
  let attempt = 0;
  const { actions, calls } = await fixture({ rpc(name) { if (name === 'create_company_invitation' && !attempt++) throw new Error('secret transport failure'); } });
  assert.equal((await actions.inviteCompanyMemberAction(createInput)).code, 'unavailable');
  assert.equal((await actions.inviteCompanyMemberAction(createInput)).ok, true);
  const mutations = calls.filter(call => call[0] === 'create_company_invitation');
  assert.equal(mutations.length, 2); assert.deepEqual(mutations[0], mutations[1]);
});

test('historical invitation and member receipts are returned unchanged, never interpreted as current list state', async () => {
  const { actions } = await fixture();
  assert.deepEqual(await actions.inviteCompanyMemberAction(createInput), await actions.inviteCompanyMemberAction(createInput));
  assert.deepEqual(await actions.updateCompanyMemberAction(updateInput), await actions.updateCompanyMemberAction(updateInput));
});

test('team responses with wrong identity, wrong cursor/order, malformed enums or oversized pages fail closed', async () => {
  const page = { companyId: COMPANY, actorUserId: USER, actorRole: 'owner', teamVersion: 1, members: [targetMember], invitations: [invite], nextMembersPageKey: null, nextInvitationsPageKey: null };
  for (const patch of [{ companyId: FOREIGN }, { actorUserId: OTHER_USER }, { actorRole: 'admin' }, { members: [targetMember, targetMember] }, { nextMembersPageKey: NEXT_MEMBER }, { invitations: [{ ...invite, status: 'cancelled' }] }, { invitations: [{ ...invite, version: 0 }] }, { members: [{ ...targetMember, email: 'invalid' }] }]) {
    const { actions } = await fixture({ teamPage: { ...page, ...patch } });
    const result = await actions.listCompanyTeamAction({ companyId: COMPANY, limit: 1 });
    assert.equal(result.code, 'unavailable'); assert.equal('members' in result, false);
  }
});

test('recipient list is read-only, bounded and independent of every company/dealer role', async () => {
  const { actions, calls, cookieWrites } = await fixture({ noCompany: true, actorRole: 'viewer' });
  const result = await actions.getMyInvitationsAction({ limit: 50 });
  assert.equal(result.ok, true); assert.equal(result.invitations[0].companyName, 'Dealer AB');
  assert.deepEqual(calls.map(call => call[0]), ['auth', 'list_my_company_invitations']);
  assert.deepEqual(cookieWrites, []);
  assert.equal('email' in result.invitations[0], false);
});

test('personal invitation list forwards UUID cursor and excludes unapproved statuses/provider secrets', async () => {
  const myInvite = { id: NEXT_INVITATION, companyId: COMPANY, companyName: 'Dealer AB', role: 'sales', status: 'pending', version: 1, expiresAt: EXPIRES, createdAt: NOW, private_sender_uid: 'secret' };
  const { actions, calls } = await fixture({ myPage: { invitations: [myInvite], nextPageKey: NEXT_INVITATION } });
  const result = await actions.getMyInvitationsAction({ pageKey: INVITATION, limit: 1 });
  assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.deepEqual(calls.at(-1)[1], { p_page_key: INVITATION, p_limit: 1 });
  const wrong = await fixture({ myPage: { invitations: [{ ...myInvite, status: 'accepted' }], nextPageKey: null } });
  assert.equal((await wrong.actions.getMyInvitationsAction()).code, 'unavailable');
});

test('accept derives actor in SQL, validates receipt and sets company cookie only after fresh active membership/company proof', async () => {
  const { actions, calls, queries, cookieWrites } = await fixture({ noCompany: true });
  const result = await actions.acceptCompanyInvitationAction(acceptInput);
  assert.deepEqual(result, { ok: true, companyId: COMPANY, role: 'sales' });
  assert.deepEqual(calls.map(call => call[0]), ['auth', 'accept_company_invitation', 'from']);
  assert.deepEqual(calls[1][1], { p_invitation_id: INVITATION, p_expected_version: 1, p_request_id: REQUEST });
  assert.deepEqual(queries[0].filters, [['id', MEMBERSHIP], ['user_id', USER], ['company_id', COMPANY], ['status', 'active'], ['companies.status', 'active']]);
  assert.equal(cookieWrites.length, 1); assert.equal(cookieWrites[0][0], 'trafexa-company'); assert.equal(cookieWrites[0][1], COMPANY);
  assert.equal(cookieWrites[0][2].httpOnly, true); assert.equal(cookieWrites[0][2].sameSite, 'lax');
});

test('historical accept retry honors current changed role and refuses later suspended/deleted membership without cookie writes', async () => {
  const active = { id: MEMBERSHIP, company_id: COMPANY, user_id: USER, role: 'finance', status: 'active', companies: { id: COMPANY, status: 'active' } };
  const current = await fixture({ acceptedMembership: active });
  assert.deepEqual(await current.actions.acceptCompanyInvitationAction(acceptInput), { ok: true, companyId: COMPANY, role: 'finance' });
  for (const acceptedMembership of [null, { ...active, status: 'suspended' }, { ...active, companies: { id: COMPANY, status: 'suspended' } }, { ...active, user_id: OTHER_USER }, { ...active, company_id: FOREIGN }]) {
    const { actions, cookieWrites } = await fixture({ acceptedMembership });
    assert.equal((await actions.acceptCompanyInvitationAction(acceptInput)).ok, false);
    assert.deepEqual(cookieWrites, []);
  }
});

test('acceptance rejects expired/revoked/wrong-recipient/inviter-invalid SQL outcomes with no current access mutation', async () => {
  for (const code of ['42501', '40001', '23505']) {
    const { actions, cookieWrites, queries } = await fixture({ rpcError: { code, message: 'secret recipient identity' } });
    const result = await actions.acceptCompanyInvitationAction(acceptInput);
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.deepEqual(cookieWrites, []); assert.deepEqual(queries, []);
  }
});

test('accept receipt actor/user/nonce/invitation/version binding failures cannot set cookies or return success', async () => {
  for (const patch of [{ actorUserId: OTHER_USER }, { userId: OTHER_USER }, { requestId: FOREIGN }, { invitationId: NEXT_INVITATION }, { membershipId: 'not-uuid' }, { version: 2 }, { role: 'owner' }, { status: 'suspended' }]) {
    const { actions, cookieWrites, queries } = await fixture({ acceptReceipt: { ...acceptanceReceipt, ...patch } });
    assert.equal((await actions.acceptCompanyInvitationAction(acceptInput)).code, 'unavailable');
    assert.deepEqual(cookieWrites, []); assert.deepEqual(queries, []);
  }
});

test('fresh current-access lookup failure after committed acceptance is a sanitized retryable unknown result', async () => {
  const { actions, cookieWrites } = await fixture({ acceptedLookupError: { code: 'XX000', message: 'secret backend token' } });
  assert.equal((await actions.acceptCompanyInvitationAction(acceptInput)).code, 'unavailable');
  assert.deepEqual(cookieWrites, []);
});
