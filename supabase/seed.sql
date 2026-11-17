-- Local-only seed. No real users, passwords, business data, providers or email jobs.
-- The explicit local bootstrap command creates a synthetic Auth account through
-- the Auth API, then reserves that exact verified identity for private bootstrap.
select 1;
