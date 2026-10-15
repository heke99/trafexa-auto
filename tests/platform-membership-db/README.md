# Platform membership management: native PostgreSQL proof

Runs the actual migration chain and real independent PostgreSQL 17.6 sessions,
including observed lock waits. Auth/Storage/cron catalogs are local fixtures.
No actual account, company, email or external provider is changed.

```sh
docker --host=unix:///var/run/docker.sock run --rm -d --name trafexa-platform-members-pg \
  --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6-bookworm
docker --host=unix:///var/run/docker.sock exec trafexa-platform-members-pg pg_isready -U postgres
node tests/platform-membership-db/schema.mjs
docker --host=unix:///var/run/docker.sock stop trafexa-platform-members-pg
```

Wait for accepting connections. `TRAFEXA_PLATFORM_MEMBERS_TEST_CONTAINER` overrides
the name. The harness replaces only `trafexa_platform_members_test`. The hosted-safe
SQL proof uses a collision-checked UUID namespace and rolls back. Its companion
cleanup query only reads eight counters. Native tests do not establish hosted
Auth/PostgREST/browser-session correctness.
