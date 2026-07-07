-- Phase 1: module_manifest
-- Which modules are enabled for a tenant, and their config. The Module
-- Registry service (Step 5) reads only this table and knows nothing else
-- about what any module does.
create table module_manifest (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  module_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now()
);

alter table module_manifest enable row level security;

create policy "tenant_isolation" on module_manifest
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
