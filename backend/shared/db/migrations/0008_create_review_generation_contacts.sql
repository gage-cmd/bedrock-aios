-- Phase 2: review_generation.contacts
-- review_generation is a dedicated schema, kept separate from `public` and
-- every other module's schema so this module's tables never collide with
-- core or sibling-module tables.
create schema if not exists review_generation;

create table review_generation.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

alter table review_generation.contacts enable row level security;

create policy "tenant_isolation" on review_generation.contacts
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
