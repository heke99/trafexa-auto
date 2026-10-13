# Signing ledger for the existing dealer application

This additive migration targets the existing `companies`, `memberships`, `deals`
and `documents` tables. It does not use the separate `trafexa_` sourcing schema.
The SQL was generated with Supabase CLI and tested only on a local PGlite
PostgreSQL engine. No hosted schema or credentials were changed. Review and apply
it through the main application's migration workflow before activating workers.

The existing foundation must have active/suspended companies and memberships,
roles owner/admin/sales/finance/viewer, deals unique by company/id, and documents
with a company, nullable company-scoped deal, kind and private object path. The
migration adds `UNIQUE(company_id,id)` to documents for composite foreign keys.
It neither changes the existing document policies nor grants service_role execute
on the existing `private.has_company_role` definer helper.

## Authorization and immutable source/template registration

Owner/admin/finance can read signing jobs, document versions and approved
company templates. They can prepare jobs using their verified Supabase user JWT.
Sales/viewer and anonymous callers cannot prepare. Authenticated callers cannot
update/delete jobs or read/write the webhook inbox. All new tables enable RLS;
worker RPCs require service_role and have no PUBLIC/anon/authenticated EXECUTE.
All newly introduced functions are SECURITY INVOKER with empty search paths.

`register_signing_document_version` is service-only. The server must verify the
user/company/document/deal and private object ACLs, fetch actual bytes, compute
SHA-256, and then register the immutable document version, source hash, path, complete server-approved
signer payload and approved template ID/version/hash.
SQL rechecks the actor's current owner/admin/finance role, active membership and
company, exact document path, and supported document purpose. Users cannot
register or change source approvals directly through the Data API. The exact
approved_signers JSONB and template identity must match each prepared job, including
direct authenticated INSERTs; changed signer email or render values are denied.

`register_signing_template` is service-only and rechecks an active owner/admin
actor. Template ID, company, kind, version and checksum are immutable. A newer
revision deactivates the older revision while retaining its historical binding.
Regression or changed content under the same version conflicts. The worker must
fetch trusted actual provider template bytes and the relevant field-schema
fingerprint, and verify them against the registered checksum before dispatch.
SQL cannot establish the source of those bytes or the provider's authenticity.

Only purchase and contract documents can be prepared. Contracts require a deal;
purchase documents may have a null deal. Supplied deal_id must match the exact
current documents.deal_id, including null. Template kind/company must match, and
new preparation requires the caller's expected template version/hash to still match
the current active registry row. A race to a different approved revision conflicts.
An authenticated exact-key/payload retry returns the historical job even after a
template upgrade. Dispatch still requires its exact template revision to be active.

The ledger stores immutable signers using camelCase DocuSealSignerInput fields
(role,email,name,externalId,values); externalId is required, bounded and unique.
Roles must be unique, email/role/name sizes are bounded, signer count is 1..20,
and the conservatively serialized outbound body is bounded at 64 KiB. The worker must validate
provider-specific values with the adapter before dispatch. Main rendering must produce the source PDF and provider field mapping from the
same immutable server snapshot before service-only approval. Registration cannot
accept render values from request data. Source/template hashes and exact approved
payload checks prove the stored bindings; SQL cannot independently prove rendering
semantics or claim the signed provider PDF is byte-identical to the source PDF.

## RPC contract

All RPCs return one JSON object containing the resulting row, not a SETOF array.
All argument names have the `p_` prefix. ID arguments are UUIDs, snapshot/event/
signers are JSONB, hashes are lowercase 64-character SHA-256 hex strings.

| Function | Arguments in declaration order | Result |
| --- | --- | --- |
| register_signing_document_version | p_company_id, p_document_id, p_document_version, p_source_sha256, p_source_object_path, p_actor_user_id, p_approved_signers, p_approved_template_id, p_approved_template_version, p_approved_template_sha256 | signing_document_versions row |
| register_signing_template | p_company_id, p_template_id, p_template_version, p_template_sha256, p_document_kind, p_actor_user_id | signing_templates row |
| prepare_signing_job | p_company_id, p_document_id, p_deal_id, p_document_version, p_source_sha256, p_template_id, p_signers, p_idempotency_key, p_expected_template_version, p_expected_template_sha256 | signing_jobs row |
| claim_signing_job | p_job_id, p_expected_version, p_claim_token | signing_jobs row |
| save_signing_job | p_job_id, p_expected_version, p_claim_token, p_snapshot, p_error_code (default null) | signing_jobs row |
| mark_expired_signing_dispatch | p_job_id, p_expected_version | signing_jobs row |
| enqueue_signing_webhook | p_body_sha256, p_event | signing_webhook_inbox row |
| apply_signing_webhook | p_inbox_id, p_expected_job_version, p_snapshot | signing_webhook_inbox row |

Document/template/job versions and CAS versions are PostgreSQL integers. Provider
submission and template IDs are bigint restricted to JavaScript safe integers.
The provider instance is fixed to `docuseal-main`; introducing another provider
endpoint requires an explicit registry/contract migration.

Prepare atomically deduplicates `(company_id,created_by,idempotency_key)`. An exact
payload retry returns the same job. UNIQUE(company_id,document_id,document_version)
prevents another actor or a newly generated retry key from creating a second
provider dispatch for the same approved document version. A deliberate new signing
process requires a newly approved document version. Changed source/template/signers/context
conflicts with SQLSTATE 40001. The server-generated snapshot mirrors SigningJob,
including templateVersion/templateSha256. Top-level job columns include
source_object_path and document_kind in addition to that domain snapshot.

Service store lookups can SELECT signing_jobs by id or by provider_instance and
provider_submission_id, and signing_webhook_inbox by id or pending status. The
complete normalized event is stored under `event`; raw webhook bodies, arbitrary
metadata, email and provider response blobs are rejected from the inbox payload.
The server verifies HMAC over the exact raw bytes and computes their body SHA-256
before enqueue. SQL cannot verify an HMAC or infer an actor from provider metadata.

## Dispatch and webhook transactions

Claim requires prepared plus exact version and a non-null UUID token. It rechecks
the active original initiator, current document company/deal/path/kind, and the
exact active template revision. It atomically changes the snapshot to dispatching,
increments version and records a fixed five-minute lease. Competing claims on the
same old version conflict. The worker must persist this claim before provider POST.

A timeout/crash is not a safe retry. Expired dispatch leases can only become
outcome_unknown; they retain their original token for explicit reconciliation.
Dispatching/outcome_unknown cannot be claimed again even after a lease expires.
Save uses CAS and requires that token while reconciling a dispatch. Provider
binding clears it. A verified known rejection becomes terminal dispatch_failed
with error_code provider_rejected; ambiguous outcomes use outcome_unknown.

Source, document, deal, template, server-approved signer payload and established provider ID/
submitter mappings remain immutable. State changes obey the domain graph. A
single form.completed registers only that signer. submission.completed moves to
awaiting_archive. Final completed requires matching context/submission and private
company-prefixed PDF/audit paths plus checksums. Actual downloaded/stored bytes,
provider completion and storage ACLs are verified by the worker, not by SQL.
No document/deal/finance status is modified by this ledger.

Inbox enqueue is unique by provider instance/body hash and binds a job exclusively
through its stored provider submission ID. Unknown submissions are quarantined
with job_id null. There is no automatic cross-company metadata mapping or automatic
reassignment when a later provider binding appears; reconciliation is explicit.

Apply locks the inbox and job, checks CAS, computes the expected domain outcome
from the normalized event, validates the supplied snapshot against it, and saves
that snapshot plus processed marking in one transaction. Stale versions and
invalid snapshots leave the inbox pending. Repeated processed delivery returns
the same inbox row; a no-op event marks processed without incrementing job version.
Late callbacks cannot reopen completed/declined/expired outcomes, and expiration/
decline cannot reverse awaiting_archive. Provider archived events alone cannot
complete local archival.

SQLSTATE 40001 denotes stale/CAS/retry/revision conflicts, 42501 authorization or
claim-token denial, and 23514 malformed snapshots/invalid transitions. Reused
provider submission IDs conflict with 23505. Never turn a conflict into a blind
provider POST retry.

## Local verification

```sh
npm ci --prefix tests/signing-ledger
npm test --prefix tests/signing-ledger
```

PGlite 0.3.14 is pinned with its lockfile. The test-only foundation mirrors the
existing table/policy metadata and uses actual PostgreSQL roles, grants, RLS,
foreign keys, row locks, JSONB checks, triggers and transactions. It does not mock
SQL authorization outcomes. Service_role has BYPASSRLS but deliberately lacks
EXECUTE on the old company-role helper, matching the stated live foundation.
The test changes one local fixture's lease clock by disabling the local trigger;
no production RPC exposes that action. The suite checks isolation, null deal
rules, registry poisoning denial, template revisions, retries, suspended actors,
claim races, expiry, uncertain/known failures, immutable bindings, duplicate/
quarantined webhooks, stale CAS and atomic processing. Catalog checks cover RLS,
invoker functions, locked search paths, narrow grants and unchanged old-helper
permissions. Hosted Supabase advisors and deployment were not run.
