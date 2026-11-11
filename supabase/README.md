# Trafexa dealer request database

The migration is additive and uses `trafexa_` table names. It has only been run
locally against PGlite's PostgreSQL engine. No hosted database was linked or
changed. Apply it to an approved Supabase environment with the normal migration
workflow before enabling the dealer API. The `private` schema must remain outside
Supabase's exposed Data API schemas.

A trusted administrator must provision `trafexa_companies` and
`trafexa_memberships` after checking the user's company. There is no client grant
or self-service membership policy. Each membership links an existing `auth.users`
UUID to a company with role `member`, `manager`, or `viewer`.

Authenticated users can read their companies, their own memberships, and all
requests/events in those companies. Members and managers can insert requests;
viewers can only read. Managers can update only `status`. Client deletion,
company reassignment, creator changes, version changes, and audit writes are
blocked by grants and RLS. An additional invoker trigger guards immutable fields.
The sole definer function is a private, non-callable audit trigger with explicit
actor/membership checks and an empty `search_path`.

## REST contract

- Insert into `trafexa_requests` with `company_id`, `created_by` (the authenticated
  user), `idempotency_key` (a UUID retained for retries), `name`, `email`, `country`,
  `buyer_type`, `brand`, `model`, `quantity`, `destination`, and `consent: true`.
  Optional fields are `phone`, `year`, `condition` (default `Either`), `budget`,
  and `notes`. The database supplies `id`, `status: submitted`, `version: 1`,
  `created_at`, and `updated_at`; clients have no INSERT grant on those fields.
- Retry identity is unique within `(company_id, created_by, idempotency_key)`.
  An ordinary duplicate insert returns PostgreSQL `23505`; recover the existing
  request with a scoped SELECT. Do not use update-on-conflict upserts: payload
  changes are deliberately forbidden.
- Status PATCH must contain only `{ "status": "sourcing" }`, with equality
  filters on `id` and the currently displayed `version`. Request the resulting
  row. An empty result means no visible matching row, insufficient role, or a
  stale version. The caller must retain that version filter for optimistic
  concurrency; a direct status update without it does not enforce a stale check.
- Progression is `submitted -> sourcing -> offered -> confirmed -> closed`.
  Any active state can also move directly to `closed`. Regression/skip attempts
  return `23514`. An unchanged status keeps its version/timestamp and creates
  no event. Successful changes increment `version` and update `updated_at`.
- `trafexa_request_events` exposes `request_id`, `company_id`, `actor_id`,
  `from_status`, `to_status`, `version`, and `created_at`. Initial submission has
  `from_status: null`. Each change and event commit or roll back together.
- List requests using `company_id` equality and `created_at.desc,id.desc` order;
  a matching index is included. Read events by `request_id` ordered by `version`.

## Local verification

From the repository root:

```sh
npm ci --prefix tests/dealer-db
npm test --prefix tests/dealer-db
```

The pinned PGlite dependency and lockfile are isolated in `tests/dealer-db`.
Its auth schema and `auth.uid()` are test-only stubs; they are never part of the
migration. Tests use transaction-local JWT subjects and real PostgreSQL roles,
grants, constraints, RLS policies, and triggers. The test command runs the
`node:test` suite directly so Node 24's isolated test runner does not hide
PGlite WASM subtests behind a single file result.

The suite checks tenant isolation, viewer/member/manager/anonymous access,
required fields, forbidden column writes, transitions, no-op updates, stale
versions, duplicate retries, immutable fields after widened grants, and audit
rollback. Local catalog checks confirm RLS on all four tables, both UPDATE
policy clauses, narrow column grants, revoked function execution, no public
security-definer function, and locked private function search paths.
Hosted Supabase advisors have not been run because no hosted project is linked.
