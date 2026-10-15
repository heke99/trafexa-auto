# Independent native invoice issuance verification

Run from the repository root: `node --experimental-strip-types tests/advertising-issuance-db/native-review.mjs`.
For another script location set `TRAFEXA_TEST_REPO` to the absolute repository path; still run from the repository root because the production PDF generator resolves its bundled font from cwd.
Requires Node24+, Docker local Unix socket, pdftotext, and a dedicated task-owned official PostgreSQL17.6 container named `trafexa-issuance-review-pg`.

The script DROPS AND RECREATES ONLY `trafexa_issuance_review_test` in that fixed container. Never point this container name at a shared or production instance. It creates synthetic local actors, companies, publication events, rates, profiles, settings, a NATIVE invoice series and issued invoices. It does not access hosted Supabase or invoke provider/mail endpoints. Auth/Storage catalogs are explicit local fixtures. The pg_cron catalog/API stub prevents background/outbound work while preserving scheduler business SQL.

Create an isolated container (read managed-runtime Docker instructions first):

```sh
docker --host=unix:///var/run/docker.sock run --detach --name trafexa-issuance-review-pg --network none --read-only --tmpfs /var/lib/postgresql/data:rw --tmpfs /var/run/postgresql:rw --tmpfs /tmp:rw -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6
```

No ports or host volumes are exposed; trust authentication is limited to the local synthetic network-none container. Existing Docker resources must not be modified. The validated image digest was sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929. Wait for this container's pg_isready before running. Container lifecycle is deliberately separate from the test runner.

Five groups use genuinely separate persistent psql processes and backend PIDs, with observed PostgreSQL Lock waits: same-company conflict, shared-series cross-company stale preview, exact nonce replay, registry revocation, and Auth ban. Additional checks cover rollback after allocation, explicit service acknowledgement, mismatched row/category VAT rejection, unsupported glyph rejection, durable configuration constraint, integrated company-store-profile migration, production DTO parsing, Stockholm service dates, deterministic PDF bytes, and extracted actual PDF fields.

No PGlite serialization is presented as multi-connection concurrency. Every currently checked-in migration is executed in filename order; test output names the PostgreSQL engine. Application functions and row locks are real PostgreSQL; the Supabase Auth platform and cron scheduler themselves are not tested by this fixture.
