# Website applications: privacy operations

Policy version: 2026-10-18. Controller identity confirmed by the project owner: Trafexa Nordic AB, 556855-4884. The owner provided info@trafexa.com as the contact channel; no postal address was supplied or invented.

## Implemented information and cookie controls

- Required applicant name, email, phone, organisation number and requested services are described before collection. Sole-trader organisation numbers can identify a person.
- Corporate representative enquiries use legitimate interest; a request by an individual contracting party may instead require pre-contractual measures. Acknowledging the privacy notice is not marketing consent.
- No analytics, marketing tags, third-party embedded media or optional-cookie categories were found in the application's source. Adding any changes this assessment and requires prior purpose-specific optional consent before loading, with equally accessible rejection and withdrawal.
- Necessary-only notice is informational and does not block applications. Its 180-day host-only preference does not authorize optional processing. Users can reopen the notice and remove the preference; authentication cookies are preserved.
- The installed @supabase/ssr 0.12.7 default authentication-cookie lifetime is 400 days. The code-verifier cookie is removed when the relevant flow completes. The company selection has no fixed expiry and is removed on sign-out. The public policy reflects these actual defaults rather than an invented short expiry.
- Personal customer-document links require no Auth account. Their HttpOnly cookie is scoped to `/customer-document` for at most seven days; account activation uses a separate HttpOnly cookie scoped to `/activate-account` for at most one hour. Cookie lifetime does not extend server-checked link validity. Contract approval records typed name and explicit confirmation, without claiming BankID identity verification.

## Two-phase policy revision deployment

Apply these migrations separately around deployment; do not push both before the new application is live.

Phase 1 was applied and read back as hosted version `20261018184303`, with unchanged SQL bytes and both deployed versions accepted. Phase 2 remains pending until the new application is live. Its local version is provisional and must be reconciled to the hosted apply timestamp without changing SQL bytes.

1. Expand: `20261018184303_web_application_privacy_revision.sql` accepts new applications bearing either `2026-10-14` or `2026-10-18`. Apply this before deploying the replacement frontend/API so the existing production form continues working.
2. Deploy and verify the application is READY and its rendered privacy page and form show version `2026-10-18`. Browser payload and nonce fingerprint use the shared policy-version constant. The API preserves the submitted version when verifying historical receipts.
3. Enforce: apply `20261018184304_web_application_privacy_revision_enforce.sql` only after that deployment verification. New `2026-10-14` requests then fail with SQLSTATE `22023`; the deployed API returns HTTP 400 with a reload/review instruction. New version-18 applications continue working.
4. Run rollback-only `supabase/tests/web_application_privacy_revision.sql`, then its `_cleanup.sql` companion. The proof creates one synthetic historical row with `legacy=true`, so no transactional email is queued; rollback leaves no synthetic applicant. It does not create accounts, send mail or inspect existing applicants.

Both phases check the erasure tombstone before replay and retain exact payload comparison, throttling and access restrictions. An already-saved matching old nonce/payload returns its original receipt without changing its original privacy version or acknowledgment timestamp. Changing the payload under that nonce still fails with SQLSTATE `40001`.

The local PGlite upgrade proof seeds a genuine old application before expansion, accepts both versions during expansion, then checks strict enforcement, unchanged old receipts and fresh version-18 submission. Full-chain tests finish with the enforced version.

Migration SHA256 values:

- Expand, 3601 bytes: `d50364d46cb7967aa9d58f087e9ce3b1eda988e3e81e2b5cd08540baa01043c3`.
- Enforce, 3618 bytes: `21e1162be6c03ba063a311a12bc72fd4236bf8051006371e0176a7c51d6a2ed4`.

## Controller operations still required

These are operational responsibilities, not guarantees supplied by policy wording:

1. Record a legitimate-interest assessment for corporate representative follow-up and a processing record covering fields, recipients, access, security and retention criteria.
2. Verify and retain the actual Vercel and Supabase data-processing agreements, subprocessor lists, access/support locations and any applicable transfer mechanism. EU deployment/database region alone does not demonstrate that all supplier processing stays within the EEA. Publish applicable transfer destinations, safeguards and how a copy can be obtained once verified. Do not assert unverified standard contractual clauses, adequacy, or absence of transfers.
3. Review closed enquiries and erase personal data when follow-up no longer needs it; do not infer automatic expiry from policy language. Document any lawful hold and the applicable backup restoration period.
4. Handle access, correction, erasure, restriction and objection requests through info@trafexa.com, verify identity proportionately, and normally respond within one month.
5. Maintain incident response and an access review for platform superadministrators. Do not forward enquiry data to finance or advertising partners without the information and lawful basis required for that distinct processing.

The public privacy notice provides currently verifiable facts and retention criteria. Publication does not certify complete GDPR compliance or replace the supplier and controller checks above.

The implemented admin erasure removes application fields and all free-text case audit entries. A minimal erasure receipt retains opaque identifiers, the responsible administrator's UUID, reason category and timestamp for safe retries and accountability. This is pseudonymous technical information, not a claim that every identifier becomes anonymous. Review its retention and vendor backup rotation separately; no cleanup scheduler is activated.

## Official sources

- PTS cookie rules, necessary-cookie exception, no cookie wall: https://www.pts.se/internet-och-telefoni/kakor-cookies/
- IMY information on lawful bases: https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/rattslig-grund/
- IMY registered-person rights: https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/de-registrerades-rattigheter/
- IMY data minimisation and storage limitation: https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/grundlaggande-principer/

## Supplier documentation checked on 14 October 2026

Public Vercel DPA incorporates international-transfer clauses and describes EU SCCs: https://vercel.com/legal/dpa
Supabase publishes a DPA with SCCs and a transfers FAQ describing USA and Singapore: https://supabase.com/legal/customer-resources/data-processing-addendum and https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq
These are the suppliers' public documents, not evidence of the particular terms accepted by Trafexa. The public notice discloses potential international processing and points to those documents without stating that the project-specific contractual arrangements have been verified.
