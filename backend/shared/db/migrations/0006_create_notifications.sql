-- Phase 1: notifications
create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

create policy "tenant_isolation" on notifications
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
