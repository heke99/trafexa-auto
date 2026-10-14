Run `npm ci --prefix tests/platform-admin-db`, then `node tests/web-applications-db/schema.test.mjs`.

The suite applies the complete real migration chain while explicitly excluding the two pending signing/archive migrations. It checks anonymous direct RPC validation, nonce replay and throttling, actual Auth/UUID administrator boundaries, legacy intake pagination, status CAS and immutable audits, and explicit privacy erasure without nonce resurrection. No external providers or production writes are used.
