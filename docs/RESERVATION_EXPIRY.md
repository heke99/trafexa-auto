# Automatic reservation expiry

The scheduler migration creates `trafexa-expire-reservations` for `postgres`, running every minute with a 30-second statement timeout. It invokes only PostgreSQL functions and sends no email or HTTP requests.

Each invocation examines at most 500 stock rows across all companies. Busy company, stock and deal rows are skipped. The lock order is company → stock → deal → reservation, including the audit foreign-key dependencies. Company `KEY SHARE` is a lock-order/FK safeguard, not a new company or membership revocation mechanism. Existing public authentication and approval wrappers remain in place.

The expiry helper locks the deal before checking customer acceptance. An accepted offer keeps the reservation, deal and stock reserved, even after the reservation deadline; the agreement process must resolve it. Other overdue reservations become expired, their reserved deal returns to draft, and reserved stock becomes available only when no active reservation remains. Future reservations, sold stock and reservation history remain intact. Creating a deal and reserving an older draft retain lazy expiry.

Acceptance and expiry serialize on the deal. If acceptance commits first, expiry cannot release the reservation. If expiry commits first, the existing customer-response API can subsequently accept an offer on a draft deal; acceptance alone does not create a new reservation. This migration does not change that earlier offer-response behavior.

## Verification

`supabase/tests/reservation_expiry_scheduler.sql` is a rollback test for an isolated database, or one without unrelated overdue reservations. It checks real worker effects, acceptance protection, history, permissions and the scheduled command.

Run `node --test tests/reservation-expiry-db/schema.test.mjs` with the task-owned `trafexa-expiry-pg` PostgreSQL 17.6 container available. The suite executes the full migration chain and uses separate persistent PostgreSQL sessions for company/stock/deal contention and both acceptance orderings. It also checks the global 500-row cap, lazy expiry and unchanged approval gates.

The local official PostgreSQL image has no `pg_cron` extension. Its test harness substitutes only extension installation with a clearly marked local cron catalog/API stub; it does not run a scheduler. Hosted extension installation, job ownership and actual minute-run results require production readback after the reviewed migration is applied.
