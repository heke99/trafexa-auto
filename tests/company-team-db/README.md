Run `npm ci --prefix tests/company-team-db`, then
`npm test --prefix tests/company-team-db` (Node 24).

The harness executes every actual repository migration in PostgreSQL provided by
pinned PGlite 0.3.14. Auth and Storage catalogs are local Supabase-shaped fixtures;
no hosted project, storage file, user or invitation is changed. A separate test
omits the two pending signing/archive migrations and verifies that personnel
administration depends only on the hosted foundation.

The rollback SQL checks RPC privileges, RLS, locked definer search paths and
unchanged membership direct-write privileges. Behavioral tests cover actual Auth
identity, company isolation, role restrictions, CAS, immutable request receipts,
expiry, re-invitation, revocation, acceptance and bounded UUID keyset pages.

PGlite uses a single PostgreSQL backend. Concurrent JavaScript transactions are
serialized; the tests prove CAS/idempotent outcomes and one audit/member, but do
not reproduce independent sessions waiting on row locks. Production SQL acquires
shared actor Auth locks, then the company lock and current membership/invitation
locks; acceptance also locks the inviter's actual Auth row. Final acceptance
checks use `clock_timestamp()` after all relevant locks, so transaction-start
`now()` cannot extend the seven-day deadline. Independent-connection contention
must be exercised against a dedicated PostgreSQL test instance if desired.

Invitations contain ordinary normalized email addresses and UUID identifiers,
not bearer credentials. The generic `/invitations` route requires the actual
verified recipient account. No outgoing mail, scheduler, owner transfer,
metadata-based authority or service-role impersonation is introduced.
