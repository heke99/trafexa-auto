# Native contract signing

One immutable signing session belongs to one deal and one saved contract draft. Only an active, approved owner/admin may request signing after explicitly reviewing the draft. Requesting another session on the same deal is rejected; amendments, replacement and withdrawal need a separate future flow.

The customer must sign in with a currently verified Auth email matching the immutable draft's customer email and an account approved by superadmin. A company membership is not required for this customer view. The company signer must be a current owner/admin in the selected company. Finance can read but cannot request or sign. Both parties must be different actual Auth users. User-editable metadata grants no authority.

All private SQL entry points independently lock/check current Auth/account approval, company and dealer membership where applicable. Every action also proves current account access before and after its RPC and after optional mail dispatch. Historical replay is available only after current authorization. No service key is used for signing mutations or document reads.

## Immutable source and evidence

`private.contract_signings.canonical_content` is the exact PostgreSQL `jsonb::text` representation of:

```json
{
  "draftId": "UUID",
  "companyId": "UUID",
  "dealId": "UUID",
  "draftVersion": 1,
  "content": {
    "offerVersion": 1,
    "template": {"id":"UUID","templateId":"UUID","version":1,"approvalVersion":2,"title":"...","body":"..."},
    "sourceOffer": {"...":"immutable accepted customer-visible offer snapshot"}
  }
}
```

The document hash is SHA-256 over the exact UTF-8 canonical string, **not the PDF byte hash**. The server verifies both this hash and the parsed canonical fields against the returned immutable draft. Approved template versions, offer conditions, money/VAT and trade-in calculations are preserved. Signature receipts include this same content hash, consent version `2026-10-14`, supplied full name, bounded drawing samples and database signing time. Actual Auth UUIDs stay private in the ledger and are not returned in signature DTOs.

Signatures and session/audit rows cannot be updated or deleted. Revision is one plus the count of individual receipts. Completion requires both parties; its timestamp is the maximum signing time. A cancelled/unavailable deal prevents a new signature but preserves authorized historical reads/replay. Signed PDF generation requires completion and produces a separately calculated SHA-256 over the exact generated PDF bytes. This is a simple electronic signature tied to a verified account and explicit consent; it does not assert BankID, qualified signature or certificate-based PDF signing.

The DocuSeal drawing validator is ported selectively, with matching database checks for average deviation, first two straight strokes and closed-loop radial deviation. Bounds and numeric validity are enforced in SQL too, because public authenticated RPC calls cannot rely on browser/action validation.

## Transactional email

Requesting a session atomically enqueues `contract_invitation` to the immutable customer email. Completing the second signature atomically enqueues `contract_completed` to that customer and `contract_completed_company` to the actual company signer's current Auth email. Keys are unique per kind, reference and recipient. No arbitrary browser recipient/payload can be supplied. Delivery performs independent current recipient/source checks and remains configuration-gated; a provider failure does not discard the saved signing receipt. No periodic job, real provider email or external DocuSeal submission is required by these migrations/tests.

## API

Actions are in `src/lib/data/contract-signing-actions.ts`, DTOs in `src/lib/contracts/signing-types.ts`. Omitting `companyId` selects the customer boundary; supplying it must match the currently selected company. `/my-contracts` is the approved customer view. Private signed document routes re-read actual source and account authorization during rendering.

The existing prototype signing ledger/provider wrappers remain disabled and are not activated or migrated by this implementation.

Before original-file archiving, PDF and JSON evidence are generated from the immutable ledger. The evidence records the generated PDF checksum separately from the content checksum.

## Native original archive — 15 October 2026

[NATIVE_CONTRACT_ARCHIVE](NATIVE_CONTRACT_ARCHIVE.md) documents the implemented archive. An explicit approved owner/admin action stores one private PDF/evidence pair for a completed native signing. Company finance and the currently authorized customer can read; they cannot initiate archiving. The private bucket is `native-contract-originals`; immutable metadata lives in `private.contract_signing_archives` with actor-bound receipts in `private.contract_archive_requests`. First registration wins and subsequent requests reuse the verified original pair.

`register_contract_signing_archive` is service-role-only and is called by the trusted server after authenticated upload and actual byte readback. The archive binds the full canonical content, signing revision 3, renderer `trafexa-native-v1`, evidence schema 1 and both file hashes/sizes. PDF is limited to 50 MiB and JSON evidence to 1 MiB. SQL checks the private Storage catalog, MIME and size; server-side SHA-256 verification proves actual file bytes. The authenticated `get_contract_signing_archive` boundary checks current company/customer authorization. Document GET routes return that exact pair and reject a missing, corrupt or mismatched original instead of regenerating it. A verified `archive:null` preserves generated copies, whose filenames distinguish them from originals. Completion or a GET request does not initiate an upload.

Migration `20261015100653_native_contract_archive` and hosted SQL rollback are verified. Production metadata contains no server registration key, so new archiving returns `configuration_missing` before rendering/upload. Configuring only server-side `SUPABASE_SECRET_KEY` directly in Vercel and testing the actual Storage API remain operating steps; no hosted Storage API roundtrip is claimed. No WORM, permanent retention, automated deletion, certificate infrastructure or external provider activation is claimed. Storage-file backup and tested restoration remain separate requirements. Actual test and release status is recorded in [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).
