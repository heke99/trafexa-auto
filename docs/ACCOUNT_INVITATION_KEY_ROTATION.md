# Account invitation encryption keys

New account invitation bodies use AES-256-GCM `v2.<key-id>.<nonce>.<tag>.<ciphertext>`, authenticated against the immutable delivery UUID and key ID. The encryption key is independent of the Supabase service credential. Bearer links remain encrypted in private storage; neither secret nor plaintext is added to the administrator DTO.

Server-only configuration:

- `ACCOUNT_INVITATION_ACTIVE_KEY_ID`: active key ID, 1–48 ASCII letters, digits, `_` or `-`.
- `ACCOUNT_INVITATION_ENCRYPTION_KEYS`: JSON object mapping key IDs to independent 32-byte cryptographically random keys encoded as canonical base64url (43 characters). Provision values through the deployment secret store. Never commit real values or expose them through `NEXT_PUBLIC_*`.
- `ACCOUNT_INVITATION_LEGACY_SECRETS`: optional JSON array of retained previous Supabase service secrets, only for reading existing `v1` invitation bodies during migration. The current service secret is also available for legacy reads. Never grant these values client access or print them in diagnostics.

Deploy the new keyring before preparing new invitations. Missing or invalid encryption configuration leaves the delivery retryable and does not generate an Auth token or contact the mail provider. Previously prepared v1 bodies can still be read during the transition. No production secret is changed by deploying this code.

For rotation, provision a new independent key under a new ID, retain old IDs in the keyring, then change the active ID. Prepared deliveries continue using their original immutable ciphertext and provider idempotency key; they are not re-encrypted or automatically replaced. Removing a required old key produces a retryable result without sending. Restore the required key to retry the exact delivery. Retain old keys until the corresponding delivery generations no longer require retry or controlled recovery, following the operator's retention policy.

A legacy v1 body has no key ID. If no retained legacy secret can authenticate it, the service cannot distinguish a removed key from failed authentication and leaves the delivery retryable rather than declaring it sent or destroying the prepared body. An operator can restore the old key or use the existing reviewed renewal process when appropriate. This does not automatically rotate an invitation link or resend an ambiguous provider result.

Isolated tests cover v1 reads, key-ID tampering, delivery-scope tampering, new/retained v2 keys, Supabase-service-key rotation, byte-identical prepared-body retries, and missing-key behavior with zero provider calls.
