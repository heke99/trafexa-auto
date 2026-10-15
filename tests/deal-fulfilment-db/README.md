Run `node tests/deal-fulfilment-db/schema.mjs` with an isolated PostgreSQL 17
container named `trafexa-fulfilment-pg` (the container uses `--network none`).
The harness imports the shared full-migration native helper and resets only its
own local test database. Never point this suite at a hosted or business database.

The suite creates accepted offers and real native customer/company signature
receipts through actual RPCs. Positive archive tests use explicitly local Storage
catalog fixtures; they do not assert file byte roundtrips or bank verification.
Hosted-safe `supabase/tests/deal_fulfilment.sql` makes no Storage object writes,
proves missing-original refusal and access control, then rolls back. Its cleanup
query returns seven counters, all expected to be zero.

The ledger is manual reconciliation only. Owner/admin record, reverse and deliver;
finance reads. Straight sales only: accepted trade-in offers remain explicitly
blocked pending debt/lender/payout settlement support. Existing accepted-offer
reservation holds remain active past their timestamp by design; delivery requires
the current active hold belonging to this deal, not merely an elapsed timestamp.
Real independent connections prove no concurrent duplicate delivery and fresh
revocation while a private reconciliation read waits for authorization locks.
