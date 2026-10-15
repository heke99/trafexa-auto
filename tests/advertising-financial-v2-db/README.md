# Independent VAT V2 checks

These scripts use a separate local official PostgreSQL17.6 container and synthetic data only. They make no hosted or provider calls. Reuse the isolated-container setup documented in tests/advertising-issuance-db/README.md; container name is trafexa-issuance-review-pg. Native-upgrade-helpers deliberately skips exactly *_advertising_financial_v2_* during bootstrap, then native-upgrade applies those seven actual additive migrations AFTER creating real V1 snapshots/invoice. Auth/Storage catalogs are local fixtures and pg_cron uses a catalog/API stub.

Run these scripts from the repository root:

```
node --experimental-strip-types tests/advertising-financial-v2-db/pure-invariants.mjs
node --experimental-strip-types tests/advertising-financial-v2-db/native-upgrade.mjs
node --experimental-strip-types tests/advertising-financial-v2-db/native-allocation.mjs
```

The upgrade script drops/recreates only trafexa_issuance_review_test in the fixed isolated container. Allocation runs afterward against that fixture. Never use this container name for shared/prod data. No actual Trafexa invoice series or invoices are configured; NATIVE and every test company are local synthetic artifacts. Clean up only this task-owned container after use.

Repository paths resolve relative ../../ from helpers; for scripts outside tests set TRAFEXA_TEST_REPO explicitly, still run from repository root for bundled PDF assets. Requires Node24+, Docker local Unix socket, pdftotext.

pure-invariants.mjs exports verifyAllocation(adapter): adapter takes rows{publicationId,netOre}[] and returns rows{publicationId,vatOre}[]. This independently checks 74,907 allocations through exhaustive small vectors, reversed permutations, mathematical error/rank invariants and exact upper bounds; it does not duplicate the production rounding algorithm. The production allocator returns a string[] in source order, so adapt it with rows.map((row,i)=>({...row,vatOre:taxes[i]})). Native-allocation separately compares actual PostgreSQL output against that checked helper for 1,543 cases. These are mathematical input checks, not additional application test cases.

Native-upgrade verifies pre/post V1 canonical bytes, PDF bytes and currentness; actual V1 issued document stability; old nonce compatibility/cross-version nonce conflict; V2 sourcehash separation/dedup; current two-row allocation; existing issuance guard compatibility; actual local V2 invoice parsing and deterministic PDF/extracted totals. This does not assert Peppol compliance or bank ownership/tax-registration checks.

The exact boundary vector [2,2,2,7378697629483820639] is checked in both orders: V2 net7378697629483820645/VAT1844674407370955161/gross9223372036854775806 is valid, even though V1 independently rounded row gross would overflow. An additional real company at the safe bound goes through both corrected V1/V2 assessment creation and actual V2 issuance/PDF. PostgreSQL div(numeric,numeric) is required: numeric / may round at large magnitude before trunc and produce an incorrect extra öre. Stored V1 snapshots and PDF bytes are never rewritten.
