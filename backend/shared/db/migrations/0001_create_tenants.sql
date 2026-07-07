-- Phase 1: tenants
create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'onboarding' check (status in ('active', 'onboarding', 'paused')),
  created_at timestamptz not null default now()
);

alter table tenants enable row level security;

-- tenants has no tenant_id column (a tenant row IS the tenant), so isolation
-- is keyed on id rather than tenant_id here. Every other Phase 1 table uses
-- the standard tenant_id form.
create policy "tenant_isolation" on tenants
  for all
  using (id = (auth.jwt() ->> 'tenant_id')::uuid);
