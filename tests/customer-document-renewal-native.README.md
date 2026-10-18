# Customer document renewal native proof

This separate suite runs real PostgreSQL 17.6 in a disposable local container. It never accesses hosted databases, Auth services, SMTP or Resend. Run it explicitly; its filename deliberately excludes `tests/*.test.mjs`.

```sh
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --host=unix:///var/run/docker.sock run -d --name trafexa-customer-renewal-oct18-pg \
  --network none --read-only --tmpfs /var/lib/postgresql/data:rw,size=768m \
  --tmpfs /var/run/postgresql:rw --tmpfs /tmp:rw \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929
node --test --test-concurrency=1 tests/customer-document-renewal-native.mjs
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --host=unix:///var/run/docker.sock rm -f trafexa-customer-renewal-oct18-pg
```

No ports or host volumes are exposed. Bootstrap applies the complete migration chain except customer-document renewal migrations. It uses real offer publication, guest acceptance, contract drafting, signing requests, guest capability preparation/binding and provider-result persistence to create legacy data. Encryption and the transport are the actual TypeScript implementations; provider I/O is an in-memory fake. The encryption secret is a synthetic constant. No real message leaves this process.

Only trusted synthetic fixture setup ages the capability timestamps, temporarily disabling and re-enabling the immutable-capability trigger before the upgrade. All renewal migrations then run against these existing generation-zero records. The test compares stored ciphertext, token hash, source, provider history and immutable audit data before and after; decrypts with the original email-ID AAD; rejects a different AAD; and checks the original provider idempotency key/body with fake transport I/O.

Following cases restore the upgraded local fixture. Concurrent operations use distinct persistent PostgreSQL backend PIDs and require an observed PostgreSQL `Lock` wait before releasing the first transaction. The exception is the intentional outbox `NOWAIT` test, which must return SQLSTATE `40001` immediately without deadlock. Tests cover concurrent renewal, fixed-receipt replay, stale workers, exact old-ID dispatch, unknown provider and live or previously attempted delivery blockers, explicit unattempted pending and expired-processing recovery, source supersession, post-wait Auth/membership/deal revocation, legitimate verified customer acceptance/signature through another existing channel, signature audit preservation, old-token denial and new-token access, and completed-document read links.

The cron catalog/API is stubbed because the official image does not contain pg_cron. No scheduler or outbound worker runs. Native tests prove SQL locking and data behavior, not real browser, provider delivery or hosted runtime configuration.
