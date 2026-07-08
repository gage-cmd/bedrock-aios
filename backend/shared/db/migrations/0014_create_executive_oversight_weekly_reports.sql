-- Phase 4: executive_oversight.weekly_reports
-- executive_oversight is a dedicated schema, kept separate from `public` and
-- every other module's schema so this engine's tables never collide with
-- core or module tables. Holds one generated weekly business report per
-- tenant per week. report_data is the full structured report (performance
-- summary, wins, issues, opportunities, recommendations plus the per-module
-- data it was grounded in) -- deliberately jsonb so the report shape can
-- evolve without a migration.
create schema if not exists executive_oversight;

create table executive_oversight.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  week_of date not null,
  generated_at timestamptz,
  report_data jsonb not null default '{}'::jsonb,
  status text not null default 'generated' check (status in ('generated', 'failed')),
  created_at timestamptz not null default now()
);

-- One report per tenant per week: re-running generation for a week that
-- already has a row should be an explicit decision, not a silent duplicate.
create unique index weekly_reports_tenant_week_uniq
  on executive_oversight.weekly_reports (tenant_id, week_of);

alter table executive_oversight.weekly_reports enable row level security;

create policy "tenant_isolation" on executive_oversight.weekly_reports
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- New schema, so it needs the same explicit grants review_generation and
-- missed_call_textback needed (see 0011, 0013) -- Postgres denies access at
-- the schema level before RLS is ever evaluated. anon is left out: nothing
-- here is anon-accessible (Executive Oversight is entirely internal, no
-- public endpoint).
grant usage on schema executive_oversight to authenticated, service_role;
grant select, insert, update, delete on all tables in schema executive_oversight to authenticated, service_role;
alter default privileges in schema executive_oversight grant select, insert, update, delete on tables to authenticated, service_role;
