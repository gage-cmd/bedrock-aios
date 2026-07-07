-- Phase 1: activity_log
-- Deliberately generic: every current and future module writes here, and the
-- future weekly-report engine reads from here. Do not add module-specific
-- columns -- module-specific detail belongs in `value`.
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  module_key text,
  event_type text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;

create policy "tenant_isolation" on activity_log
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
