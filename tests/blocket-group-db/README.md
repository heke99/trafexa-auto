# Blocket provisioning and delivery ledger: native SQL proof

Uses the actual migration chain and independent PostgreSQL 17.6 sessions, including
observed lock waits. Auth/Storage/cron catalogs are local fixtures. No credential,
partner API, actual dispatcher, email or hosted company is accessed.

```sh
docker --host=unix:///var/run/docker.sock run --rm -d --name trafexa-blocket-pg \
  --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6-bookworm
docker --host=unix:///var/run/docker.sock exec trafexa-blocket-pg pg_isready -U postgres
node tests/blocket-group-db/schema.mjs
docker --host=unix:///var/run/docker.sock stop trafexa-blocket-pg
```

Wait for accepting connections. Override the container name with
`TRAFEXA_BLOCKET_TEST_CONTAINER`. The suite replaces only `trafexa_blocket_test`.
The hosted-safe proof uses collision-checked IDs and rolls back; its companion
cleanup file only reads namespace-specific counters. Native tests do not prove
hosted Auth/PostgREST/browser correctness or actual external publication.
