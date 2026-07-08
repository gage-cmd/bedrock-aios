-- Phase 2: missed_call_textback.missed_calls
-- missed_call_textback is a dedicated schema, kept separate from `public` and
-- every other module's schema so this module's tables never collide with
-- core or sibling-module tables. Canonical copy of this DDL also lives at
-- backend/src/modules/missed-call-textback/db/schema.sql -- keep in sync.
create schema if not exists missed_call_textback;

create table missed_call_textback.missed_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  contact_phone text not null,
  missed_at timestamptz not null default now(),
  textback_sent boolean not null default false,
  textback_body text,
  created_at timestamptz not null default now()
);

alter table missed_call_textback.missed_calls enable row level security;

create policy "tenant_isolation" on missed_call_textback.missed_calls
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- New schema, so it needs the same explicit grants review_generation needed
-- (see 0011) -- Postgres denies access at the schema level before RLS is
-- ever evaluated. anon is left out: nothing here should be anon-accessible.
grant usage on schema missed_call_textback to authenticated, service_role;
grant select, insert, update, delete on all tables in schema missed_call_textback to authenticated, service_role;
alter default privileges in schema missed_call_textback grant select, insert, update, delete on tables to authenticated, service_role;
