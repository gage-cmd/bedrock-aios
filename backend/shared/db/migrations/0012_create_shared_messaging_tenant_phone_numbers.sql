-- Phase 2: shared_messaging.tenant_phone_numbers
-- shared_messaging is its own schema, separate from `public` and every
-- module's schema, since phone numbers are shared infrastructure future
-- modules will also read from (not owned by review_generation).
create schema if not exists shared_messaging;

create table shared_messaging.tenant_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  phone_number text not null,
  twilio_sid text not null,
  is_default boolean not null default false,
  label text,
  status text not null default 'active' check (status in ('active', 'released')),
  created_at timestamptz not null default now()
);

-- Enforces "at most one is_default = true row per tenant" at the database
-- level, not just in application code.
create unique index tenant_phone_numbers_one_default_per_tenant
  on shared_messaging.tenant_phone_numbers (tenant_id)
  where is_default;

alter table shared_messaging.tenant_phone_numbers enable row level security;

create policy "tenant_isolation" on shared_messaging.tenant_phone_numbers
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- New schema, so it needs the same explicit grants review_generation needed
-- (see 0011) -- Postgres denies access at the schema level before RLS is
-- ever evaluated. anon is left out: nothing here should be anon-accessible.
grant usage on schema shared_messaging to authenticated, service_role;
grant select, insert, update, delete on all tables in schema shared_messaging to authenticated, service_role;
alter default privileges in schema shared_messaging grant select, insert, update, delete on tables to authenticated, service_role;
