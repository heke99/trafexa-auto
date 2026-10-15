# Company ownership role transfer: native PostgreSQL proof

These tests exercise the actual ordered SQL migration chain against PostgreSQL
17.6, including real independent `psql` sessions and observed lock waits. Auth,
Storage and cron catalogs are local fixtures; no hosted user, provider, email,
background worker or legal ownership record is changed.

```sh
docker --host=unix:///var/run/docker.sock run --rm -d \
  --name trafexa-ownership-pg --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6-bookworm
docker --host=unix:///var/run/docker.sock exec trafexa-ownership-pg pg_isready -U postgres
node tests/company-ownership-db/schema.mjs
docker --host=unix:///var/run/docker.sock stop trafexa-ownership-pg
```

Wait until `pg_isready` reports accepting connections before running the suite.
`TRAFEXA_OWNERSHIP_TEST_CONTAINER` overrides the container name. The harness
creates and replaces only the isolated `trafexa_ownership_test` database.

The hosted-safe proof in `supabase/tests/company_ownership_transfer.sql` uses a
collision-checked UUID namespace and rolls back all changes. It does not prove
hosted Auth/PostgREST/browser sessions. Only the native suite proves lock waits.
