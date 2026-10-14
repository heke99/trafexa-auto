Run `npm ci --prefix tests/crm-db` then `node tests/crm-db/schema.test.mjs`.
Tests run the actual migration chain in isolated PGlite PostgreSQL, with actual Auth,
company/member records, roles, private privileges, immutable contacts/audits, date
validation, nonce replay/CAS, fullcompany chronological pagination beyond 500 rows,
and the rollback-only smoke script in supabase/tests/crm_contacts.sql.
No external delivery providers, email, scheduler or production data are involved.
