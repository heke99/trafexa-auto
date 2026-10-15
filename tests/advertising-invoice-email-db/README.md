# Independent native invoice-email review

The default runner recreates **only** `trafexa_invoice_email_review_test` inside the dedicated, synthetic `trafexa-invoice-email-review-pg` container. It does not use a hosted connection, shared database, real provider request or customer mailbox.

Read the managed-runtime Docker guidance first. Start the isolated local fixture container explicitly:

```sh
docker --host=unix:///var/run/docker.sock run --detach --name trafexa-invoice-email-review-pg --network none --read-only --tmpfs /var/lib/postgresql/data:rw --tmpfs /var/run/postgresql:rw --tmpfs /tmp:rw -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6
```

The official PostgreSQL 17.6 image inspected in this workspace has digest `sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`. Wait for `pg_isready` before running the test. No ports or host volumes are exposed. The local trust fixture is confined to this network-none container. The runner removes inherited Docker endpoint/context/TLS selectors for its explicit local Unix socket without changing registry or proxy configuration.

Run from the repository root using Node 24+:

```sh
node --experimental-strip-types tests/advertising-invoice-email-db/native-review.mjs
```

The fixture executes the integrated migration chain **before** the email upgrade and creates authentic stored issued V1/V2 invoices, deterministic actual PDF bytes and a full credit. Cases include V2 allocation `[1,0]` VAT on two 2-öre rows and gross `9223372036854775806` öre. After the checked-in email migrations, the runner requires identical original/credit canonical objects and PDF bytes. Claimed jobs pass the production DTO parser and actual email preparation function. The decoded attachment must equal those pre-upgrade PDF bytes, and the full stable provider JSON and PDF SHA-256 digests must match the database binding throughout known-rejection retries.

Nine concurrency groups use separate persistent `psql` processes, assert distinct actual PostgreSQL backend PIDs and observe actual `Lock` waits: distinct queue requests, exact queue-nonce replay, exclusive claim, administrator registry revocation, Auth ban, company suspension, final-guard lock wait crossing lease expiry, webhook versus accepted-result recording, and signed-tag crash recovery versus a late accepted-result recording. This is not a queue of statements on one PGlite backend.

Other checks cover frozen recipients after live buyer-profile changes; immutable document/nonces; wrong-company reads; mandatory review; service-only provider facts; accepted versus delivered; 429 backoff and five-attempt maximum; the 23-hour horizon measured from first attempt; unknown results never resent; expired leases; late accepted facts after administrator revocation; early webhook retention and reconciliation; signed-tag recovery after a worker loses the provider result; wrong tags, wrong recipients and never-attempted jobs cannot be revived; idempotent late accepted results; event-ID and tag reuse; other-recipient and future-event rejection; monotone bounce/complaint facts; suppression of new and pending sends; and cancellation when the original is credited before the final send guard.

The default fixture saves a snapshot inside its own container and a JSON/PDF cache at `/tmp/trafexa-invoice-email-native-fixtures.json`. During review, `--reuse` restores that fixed synthetic snapshot, reapplies the current checked-in email migrations, and reruns every assertion without reseeding the complete historical billing chain. It never reuses mutated email state or a hosted connection. `TRAFEXA_TEST_REPO` may select a checkout; run from that checkout's root because PDF font paths resolve from cwd.

Auth/Storage catalogs and the cron API are explicit local fixtures. Boundary timestamps are privileged local test mutations. Provider IDs, acceptance and webhook events are synthetic SQL facts. The test does not prove hosted authentication, real provider delivery, mailbox receipt, refunds, payments or an authenticated production browser flow. Use the actual terminal result as the pass/fail evidence. Container lifecycle is separate; remove only this task's named container when finished.

Provider contracts were checked against the official [idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys), [raw-body signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [delivery events](https://resend.com/docs/webhooks/emails/delivered), [bounce events](https://resend.com/docs/webhooks/emails/bounced), and [complaint events](https://resend.com/docs/webhooks/emails/complained). The send API uses a tags array, while all three documented webhook payloads use a `data.tags` object. Provider receipt is distinguished from delivery to the recipient's mail server; no event proves a human read the invoice.
