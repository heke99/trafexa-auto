# Native payment concurrency proof

Run separately from the ordinary application tests. Requires the managed local Docker socket and a dedicated disposable container; it never connects to hosted databases or mail providers.

```sh
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --host=unix:///var/run/docker.sock run -d --name trafexa-ad-payment-oct18-pg \
  --network none --read-only --tmpfs /var/lib/postgresql/data:rw,size=768m \
  --tmpfs /var/run/postgresql:rw --tmpfs /tmp:rw \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929
node --test --test-concurrency=1 tests/advertising-payment-native.mjs
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker --host=unix:///var/run/docker.sock rm -f trafexa-ad-payment-oct18-pg
```

PostgreSQL 17.6 runs without network, published ports, host volumes or persistent storage. Bootstrap applies all repository migrations; only pg_cron's catalog and scheduling API are stubbed, with no background worker. The trusted test fixture approves synthetic identities, then creates an issued invoice through the established billing, financial review, series and issuance RPCs. Each test restores this synthetic fixture. Cloned invoice targets retain canonical JSON and matching SHA-256 proofs.

Concurrent groups use different persistent PostgreSQL backend PIDs and require an observed `pg_stat_activity.wait_event_type = 'Lock'` before releasing the winning transaction. Assertions check SQLSTATEs and durable ledger rows, not timing alone. Registry and Auth revocation tests take their documented identity locks before the waiting financial request. Coverage includes same-invoice review CAS, seller-scoped identifier uniqueness across companies, reversal and correction uniqueness, both receipt/credit orderings, revocation, and exact aggregates above int64. No real receipt, refund or outgoing transfer occurs.
