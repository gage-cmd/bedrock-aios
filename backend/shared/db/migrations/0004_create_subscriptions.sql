-- Phase 1: subscriptions
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  plan text not null,
  status text not null,
  renews_at timestamptz,
  created_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

create policy "tenant_isolation" on subscriptions
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
