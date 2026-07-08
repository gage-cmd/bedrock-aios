-- Phase 5: platform_admins
-- A new privilege level that sits OUTSIDE the tenant model. Every other table
-- in this schema is tenant-scoped (a tenant_id column + a tenant_isolation RLS
-- policy). This one deliberately is not: a platform admin belongs to no
-- tenant. Its only job is to record which Supabase Auth users are allowed to
-- reach the platform-admin surface (the future onboarding console), where they
-- create and configure tenants.
--
-- user_id is the Supabase Auth user id (auth.users.id), mirroring the same
-- convention users.id follows. It is intentionally NOT a tenant_id and there
-- is no tenant_id column here -- an admin row identifies a person, not a
-- tenant membership. unique(user_id) so a user is listed at most once.
create table platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  created_at timestamptz not null default now()
);

-- RLS on, and DELIBERATELY no policy. With RLS enabled and no policy, the
-- `authenticated` role (every logged-in tenant user) can neither read nor
-- modify a single row -- membership is invisible and ungrantable from any
-- tenant session. This is the crux of the security boundary: a tenant user,
-- even an 'owner', must never be able to enumerate the admin list or add
-- themselves to it.
--
-- The backend's AdminGuard checks membership using the pooler's default role
-- (the same unrestricted connection every service uses), which bypasses RLS,
-- so the guard can read this table even though no tenant session can. There is
-- no tenant_isolation policy because there is no tenant_id to isolate on --
-- being an admin is precisely the state of belonging to no tenant.
alter table platform_admins enable row level security;
