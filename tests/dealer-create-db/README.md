Native PostgreSQL 17.6 proof for durable customer/finance-intake creation.

Start a task-owned official `postgres:17.6-bookworm` container named
`trafexa-dealer-create-pg` with `--network none`, no published ports and
`POSTGRES_HOST_AUTH_METHOD=trust`. Use the managed Docker socket as described in
the environment skill; preserve the session proxy/CA if an image pull is needed.

Run these commands sequentially from the repository root:

```sh
node --test tests/dealer-create-db/schema.mjs
node --test tests/dealer-create-db/cross-layer.mjs
```

The first command creates only `trafexa_dealer_create_test` in that container,
applies the current local migration chain, then exercises independent persistent
PostgreSQL sessions. The second reuses that database and runs actual application
actions, cached company sessions, fresh approval/membership checks and RPCs. Its
SDK adapter simulates a lost API response after a real committed insert.

Auth/Storage catalogs and the cron catalog are local models; no real Auth API,
Storage service, scheduled worker, provider or outbound email is used. The cron
extension installation alone is replaced with an inert local catalog stub.

The hosted-compatible proof is `supabase/tests/dealer_create_idempotency.sql`;
it is one transaction ending in `ROLLBACK`, with collision-checked `fd230000`
synthetic fixtures. Its companion cleanup query reports six zero counters.
Remove the task container after verification; no test data should be retained.
