# Independent native full-credit review

Run from the repository root with Node 24+, Docker local Unix socket and `pdftotext`:

```sh
node --experimental-strip-types tests/advertising-credit-db/native-review.mjs
node --experimental-strip-types tests/advertising-credit-db/native-calendar.mjs
```

Read the managed-runtime Docker instructions first. Create only this dedicated, synthetic test container:

```sh
docker --host=unix:///var/run/docker.sock run --detach --name trafexa-credit-review-pg --network none --read-only --tmpfs /var/lib/postgresql/data:rw --tmpfs /var/run/postgresql:rw --tmpfs /tmp:rw -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6
```

The official PostgreSQL 17.6 image previously verified in this workspace has digest `sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`. Wait for its `pg_isready`. No ports or host volumes are exposed. Local trust authentication is confined to the network-none synthetic container. The runner drops and recreates **only** `trafexa_credit_review_test` in the fixed `trafexa-credit-review-pg` container. Never reuse these names for shared resources. Container creation/removal remains a separate explicit lifecycle step. `TRAFEXA_TEST_REPO` can select another checkout; run from its root because production PDF code resolves bundled fonts from cwd.

The runner executes all checked-in migrations except the credit upgrade, creates authentic stored V1 and V2 issued invoices and actual PDF bytes, then applies the credit migrations. It checks unchanged canonical objects, hashes, currentness, deterministic original PDF bytes and original nonce replay after upgrade. Synthetic sources include a V2 allocation with row VAT `[1,0]` on two 2-öre rows, and the int64-safe gross boundary `9223372036854775806` öre.

Five concurrency groups use separate persistent `psql` processes, assert different PostgreSQL backend PIDs, and observe real `Lock` waits: competing full credits, exact nonce replay, credit versus original shared numbering, administrator registry suspension, and Auth ban. Further checks force a failure after allocation and confirm rollback of the credit, request, number registry and counter; allow credit after live company data changes; deny altered nonce payloads, missing review and unsupported text; verify own-company reads, foreign-company denial and immutable document storage. Stored native credits pass the production DTO parser and deterministic actual PDF renderer, and `pdftotext` verifies original references and credit text.

Auth and Storage catalogs and the cron API are explicit local fixtures. No hosted Supabase identity, provider publication, email, payment, refund or production browser flow is exercised. The script never connects to hosted data, and a PGlite-serialized queue is never described as multi-connection concurrency. Use the actual terminal result as the pass/fail evidence.

`native-calendar.mjs` runs **after** the main native review in that same disposable database. It retains an authentic issued 2026 original and temporarily replaces only `clock_timestamp()` expressions in the three isolated credit read/configure/issue SQL functions with an explicit next-year timestamp. Checked-in production migrations remain unchanged, and the original function definitions are restored in `finally`. This synthetic clock fixture proves missing current-year series blocking, explicit new-year configuration, prior-year exact-amount credit, production DTO/PDF parsing, and exhausted-series rejection. It also forces a privileged cross-table number collision and requires rejection specifically by the shared number-registry unique constraint. This is an explicit local calendar fixture, not evidence that the host clock advanced or a hosted production future-date operation was performed.
