-- Phase 2: review_generation schema grants
-- Supabase auto-grants USAGE on `public` to authenticated/service_role, but a
-- custom schema gets none of that for free -- without these grants, Postgres
-- denies access at the schema level before RLS is ever evaluated. anon is
-- deliberately left out: nothing in this schema is anon-writable yet (the
-- customer-facing token flow is future work), so access stays fail-closed.
grant usage on schema review_generation to authenticated, service_role;
grant select, insert, update, delete on all tables in schema review_generation to authenticated, service_role;
alter default privileges in schema review_generation grant select, insert, update, delete on tables to authenticated, service_role;
