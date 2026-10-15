# Internal vehicle financial access: native PostgreSQL

Run `node tests/internal-vehicle-finance-db/schema.mjs` from the repository root with an isolated PostgreSQL 17 container named `trafexa-internal-finance-pg` (`--network none`). Override only the exact container name with `TRAFEXA_INTERNAL_FINANCE_TEST_CONTAINER`.

The runner recreates only `trafexa_internal_finance_test`, applies every local migration in order, and uses local Auth/Storage/cron catalog stubs. It performs no provider calls or email delivery. Two persistent PostgreSQL connections prove the authorization/revocation lock ordering rather than simulating concurrency on one backend.

Synthetic fixtures use the reserved `fd210000-0000-4000-8000-` prefix. `supabase/tests/internal_vehicle_financial_visibility.sql` is a collision-guarded transaction ending in rollback. Its separate cleanup query is read-only and reports seven namespace counters, all expected zero after the proof. Do not run the test runner against a hosted database.
