-- Phase 7: value_events -- the recovered-revenue ledger.
-- Every dollar figure the product shows must trace to sum() over this table,
-- and every row carries an honest basis: 'estimated' (derived from the
-- tenant's own configured averages, math shown in basis_note) or 'verified'
-- (tied to a real payment record; nothing writes 'verified' yet -- that is
-- the Phase 8+ Stripe/QuickBooks integration).
create table value_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  module_key text not null,
  event_type text not null,
  amount_cents integer not null check (amount_cents >= 0),
  basis text not null check (basis in ('estimated', 'verified')),
  basis_note text not null,
  source_ref uuid,
  occurred_at timestamptz not null default now()
);

alter table value_events enable row level security;

create policy "tenant_isolation" on value_events
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Idempotency: re-processing the same source row (webhook retry, backfill
-- re-run) must not double-count value. Partial so ad-hoc events without a
-- source row remain possible.
create unique index value_events_source_unique
  on value_events (tenant_id, module_key, event_type, source_ref)
  where source_ref is not null;

-- The hero and weekly summaries read by tenant + time window.
create index value_events_tenant_occurred
  on value_events (tenant_id, occurred_at desc);
