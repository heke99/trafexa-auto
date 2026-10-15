# Internal branches: native PostgreSQL proof

The suite applies the actual ordered migration chain and exercises real separate
PostgreSQL 17.6 sessions with observed lock waits. Auth/Storage/cron catalogs are
local fixtures. No hosted user, external provider, email or inventory is changed.

```sh
docker --host=unix:///var/run/docker.sock run --rm -d \
  --name trafexa-branches-pg --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6-bookworm
docker --host=unix:///var/run/docker.sock exec trafexa-branches-pg pg_isready -U postgres
node tests/company-branches-db/schema.mjs
docker --host=unix:///var/run/docker.sock stop trafexa-branches-pg
```

Run only after `pg_isready` reports accepting connections. Override the container
name with `TRAFEXA_BRANCHES_TEST_CONTAINER`. The harness recreates only its isolated
`trafexa_branches_test` database. Hosted-safe SQL rolls back; the companion cleanup
query only reads nine namespace-specific counters. These tests do not establish
hosted Auth/PostgREST or browser-session correctness.
