-- Phase 1: usage_logs
create table usage_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  module_key text not null,
  event_type text not null,
  tokens_used integer not null default 0,
  cost numeric(10, 4) not null default 0,
  created_at timestamptz not null default now()
);

alter table usage_logs enable row level security;

create policy "tenant_isolation" on usage_logs
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
