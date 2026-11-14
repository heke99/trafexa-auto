# Deal list archives

Migration: `20261114090130_deal_list_archives.sql` (created with the Supabase CLI).

- Owner/admin explicitly reviews and archives unsigned inactive drafts, cancelled deals, or completed deals. Active reservations, live contracts/offers and unresolved draft/cancelled payment totals block archival.
- This changes list visibility only. Deals, customer documents, signatures, SHA-256 evidence, bank attestations, paid history and vehicle statuses remain intact. Restore changes list visibility only.
- Default/status lists exclude archived rows. The `archived` filter includes them. `counts.all` is the visible active-list total, `counts.archived` the archive total, and `totalCount` includes both.
- Private state and immutable audit are not directly exposed. Public invoker RPCs authorize fresh approval/membership, lock stock then deal, compare reviewed state/version and enforce request UUID replay.
- Archived records reject new lifecycle/document/payment writes. Existing signed document reads, guest links, lazily created archive artifacts and downloads stay available.
- DTO `createdBy` binds to immutable `public.deals.created_by`. Names use sanitized metadata, then an exact actor/company company-signature name, preferring this deal. Customer signatures and other seller accounts never supply creator names. Older DB responses may omit `createdBy` and `archived`.

Local verification:

```sh
node --test --test-isolation=none tests/deal-archives.test.mjs
node --test --test-isolation=none tests/deal-archive-ui.test.mjs
node --test --test-isolation=none --test-name-pattern='archived contract view' tests/contract-ui.test.mjs
node --test tests/register-actions.test.mjs tests/dealer-registers.test.mjs
npm run typecheck
```

Browser checks use only local synthetic action responses and block external traffic. DB checks use isolated PGlite and real migrations/RPCs. No hosted writes or mail sends were performed by this task. Apply the migration before enabling archive actions in production.
