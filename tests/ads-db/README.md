Run `npm ci --prefix tests/ads-db` then `npm test --prefix tests/ads-db` on Node 24.
Pinned PGlite 0.3.14 executes the actual repository migration chain against local
Supabase-shaped Auth and Storage catalogs. No hosted writes, credentials, partner
connections, dispatcher activations or provider HTTP requests occur.

The rollback SQL verifies private-table RLS and grants, public invoker/private
locked-search-path definer boundaries, role-separated worker RPCs, the private
photo bucket, and unchanged membership privileges. The Storage fixture matches hosted Supabase
object-table SELECT/INSERT/UPDATE/DELETE grants for anon/authenticated; actual
bucket RLS still blocks overwrite, upsert, deletion and all export-bucket access. Behavioral
tests cover tenants and role restrictions, exact sanitized snapshots and stock
price binding, registration metadata/owner checks, immutable image references,
private orphan retention, max 20 images, CAS and request replay, unavailable connections,
atomic multi-channel enqueue, worker leases/outcome uncertainty, submitted versus
published receipts, and immutable job history. A separate fixture excludes the
two pending signing/archive migrations to prove foundation independence.

PGlite has one PostgreSQL backend. Concurrent JavaScript transaction calls are
serialized: one-winner/idempotency tests prove state outcomes, not independent
sessions contending on locks. Production mutation ordering is shared Auth account
lock, company lock, current stock and membership/context locks, then ad/photo/job
rows. Uncertain or accepted pending delivery is reconciled through reads and can
never be claimed for another POST. Expired dispatch leases become outcome_unknown.

The Storage fixture proves catalog owner, size, MIME, paths and actual private
bucket state; SQL cannot decode object bytes. User registration binds private
catalog metadata only and is never decoder/hash approval. The production upload
and download bridge decodes and normalizes actual pixels, stripping EXIF.
Provider media must NEVER sign original ads-vehicle-photos objects: a future
trusted service bridge normalizes bytes, uploads to private ads-export-media,
checks actual readback hash and only then signs export media. That bucket has
no authenticated policies. No metadata flag is treated as decoder/pixel proof.
Private upload orphans are retained: no authenticated DELETE policy exists,
avoiding races between deletion and registration. Future cleanup requires a
trusted atomic process with registry locks. No public listing, anon
photo access, VIN, purchase costs, customer records or internal notes enter the
advertising snapshot. Registration-number export requires explicit opt-in.

Connection requests are ordinary nonsecret account references, never credentials
or verification. Dispatcher readiness has a trusted service-only maximum-five-
minute lease, and both registries start empty. Preparation stays connection_required
with zero jobs until independently provisioned access and an actually configured
dispatcher exist. This delivery does not activate any partner or worker.
