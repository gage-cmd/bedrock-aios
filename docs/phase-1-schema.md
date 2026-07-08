# Phase 1 Schema

Core, module-agnostic tables that every future module and the dashboard shell depend on. No feature-module tables here — those land in Phase 2.

All tables use `uuid` primary keys (`default gen_random_uuid()`, except `users.id` which is the Supabase Auth user id) and a `created_at timestamptz default now()`. Every table below is tenant-scoped and gets Row-Level Security enabled in the migration that creates it (see [phase-1-schema SQL migrations](../backend/shared/db/migrations)).

## tenants

One row per client business.

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key, `default gen_random_uuid()` |
| name | text | not null |
| status | text | not null, `default 'onboarding'`, one of `active` / `onboarding` / `paused` |
| created_at | timestamptz | not null, `default now()` |

## users

Mirrors Supabase Auth users, adding tenant membership and role. `id` is the Supabase Auth user id (not a fresh uuid) so the two stay in lockstep.

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key, equal to the corresponding `auth.users.id` |
| tenant_id | uuid | not null, references `tenants(id)` |
| email | text | not null |
| role | text | not null, `default 'staff'`, one of `owner` / `staff` / `read_only` |
| created_at | timestamptz | not null, `default now()` |

## module_manifest

Which modules are turned on for a tenant, and their config. The Module Registry (Step 5) reads only this table.

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key, `default gen_random_uuid()` |
| tenant_id | uuid | not null, references `tenants(id)` |
| module_key | text | not null — identifies the module (e.g. `invoice-recovery`), no FK since modules aren't a DB concept yet |
| enabled | boolean | not null, `default true` |
| config | jsonb | not null, `default '{}'` — module-specific settings, opaque to core |
| connected_at | timestamptz | not null, `default now()` — when the module was connected/installed |

## subscriptions

Billing plan state per tenant.

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key, `default gen_random_uuid()` |
| tenant_id | uuid | not null, references `tenants(id)` |
| plan | text | not null — e.g. `core` / `pro` / `complete` |
| status | text | not null — e.g. `active` / `past_due` / `canceled` |
| renews_at | timestamptz | nullable |
| created_at | timestamptz | not null, `default now()` |

## usage_logs

Metered usage per tenant per module, for cost tracking and billing.

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key, `default gen_random_uuid()` |
| tenant_id | uuid | not null, references `tenants(id)` |
| module_key | text | not null |
| event_type | text | not null — e.g. `ai_completion`, `sms_sent` |
| tokens_used | integer | not null, `default 0` |
| cost | numeric(10,4) | not null, `default 0` |
| created_at | timestamptz | not null, `default now()` |

## notifications

In-dashboard notifications shown on the Notifications page.

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key, `default gen_random_uuid()` |
| tenant_id | uuid | not null, references `tenants(id)` |
| title | text | not null |
| body | text | nullable |
| read | boolean | not null, `default false` |
| created_at | timestamptz | not null, `default now()` |

## activity_log

Deliberately generic event ledger. Every current and future module writes here, and the future weekly-report engine reads from here — nothing module-specific should leak into this table's shape. Module-specific detail belongs in `value` (jsonb), not new columns.

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key, `default gen_random_uuid()` |
| tenant_id | uuid | not null, references `tenants(id)` |
| module_key | text | nullable — null for tenant-level events not tied to a specific module |
| event_type | text | not null — e.g. `invoice_recovered`, `call_missed`, `report_generated` |
| value | jsonb | not null, `default '{}'` — event payload, shape owned by the writer |
| created_at | timestamptz | not null, `default now()` |

## Row-Level Security

Every table above is tenant-scoped, so every table gets RLS enabled and a `tenant_isolation` policy in the same migration that creates it:

```sql
create policy "tenant_isolation" on <table>
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

This requires `tenant_id` to be embedded as a custom claim in the JWT issued at login (see Step 6) — without it, `auth.jwt() ->> 'tenant_id'` is null and the policy blocks all rows, fail-closed rather than fail-open. That claim is stamped by the `custom_access_token_hook` access-token hook; see [Access-Token Hook](auth-access-token-hook.md) for the captured function (migration 0017) and the manual Auth-settings registration step it still requires.
