# Offer review database verification

Run `node tests/offer-review-db/schema.test.mjs` from the repository root after installing the pinned PGlite dependency in `tests/crm-db`. The suite reuses the actual migration loader rather than a mirrored SQL schema. It checks both the complete committed chain and the hosted basis, which excludes the pending signing ledger and offer archive migrations.

Coverage includes verified email matching without company membership, role and tenant isolation, publication/withdrawal/customer response, exact actor-bound retries and immutable receipts, CAS, expiry/supersession/inactive deals, unknown VAT refusal, safe snapshot fields, pagination, Auth bans/anonymous/email changes, and synthetic rollback SQL.

PGlite executes actual PostgreSQL functions and role grants but does not verify real concurrent connections waiting on row locks. Root separately executes the rollback SQL against hosted PostgreSQL before deployment. No emails or provider submissions are made.
