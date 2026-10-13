# Local platform-admin database verification

```sh
npm ci --prefix tests/platform-admin-db
npm test --prefix tests/platform-admin-db
```

The harness pins PGlite 0.3.14 and loads the repository's actual migrations in
filename order. Its test-only Auth/storage stubs preserve PostgreSQL roles,
grants, RLS, triggers and transactions. Trusted allowlist/reservation fixtures
are local or rolled back; running the suite does not register any hosted user.

The rollback SQL checks fail-closed empty registries, actual verified UUID
allowlisting, ignored email/domain/metadata/dealer-owner claims, bounded global
company/contact reads, CAS, nonce retries, immutable audit, dealer RLS/audit,
revocation and banned/anonymous/SSO accounts. It also checks exact approved-email
bootstrap, duplicate verified-email denial, one-time UUID binding and prevention
of role transfer to another UUID when the email changes.

Additional tests submit competing status requests and same-UUID claims and
assert one role/audit/intent. PGlite runs one PostgreSQL backend, so JavaScript
Promise concurrency is serialized by that backend. These tests verify real SQL
results, privileges, atomicity and uniqueness; they do not force a multi-connection
row-lock wait. The bootstrap function explicitly rechecks the fixed allowlist
after acquiring its reservation row lock so a waiting same-UUID retry returns
the existing grant without creating a second activation audit.

A separate test omits the pending signing/archive migrations and verifies that
the platform-admin DDL and operations depend only on the existing foundation.
The ordinary dealer policies and generic audit function remain unchanged.
