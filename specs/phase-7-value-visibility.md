# Phase 7 — Value visibility: Snapshot Contract v2, value ledger, command-center home

Source: product audit + master roadmap, Jul 12 2026 (roadmap Phase 2 core). Goal: the
product finally says what it is worth. A typed snapshot contract replaces the one-string
`{metric, value}` shape so one generic premium widget serves every module; a
value_events ledger records recovered revenue with an honest estimated/verified basis;
and the home page becomes an executive command center — value hero, attention queue,
recent activity — that answers "what has this created for me?" on first paint.

Prerequisites: Phase 6 merged to main (PR #7). Steps 2-3 of Phase 6 (Twilio, reset
email) remain manual and do NOT block this phase — nothing here needs live SMS.

Explicitly OUT of scope (Phase 8+): Supabase Realtime live feed (the feed here is
query-based), Command Center streaming + citation UI, insight/anomaly cards, expansion
recommendations, multi-location, roles, billing, benchmarks.

Ways of working: one commit per completed step, descriptive message, push after each
group. Verify per CLAUDE.md: green units are not done; every step that touches the DB
or an endpoint ends with a 1-record live check against the demo tenant. Branding rule
applies to every string a client can see: no AI/module/bot talk — Digital Staff,
systems, recovered revenue. All new tables get RLS tenant isolation + a tenant-isolation
test, same pattern as existing migrations.

---

## Group A — Contract and ledger (backend)

### Step 1 — Snapshot Contract v2 in core
`SnapshotResult` is one pre-formatted string pair; it cannot carry deltas, series,
attention items, or money. Replace it in
`backend/src/core/module-registry/module-contract.ts` with a typed shape:

```ts
export interface SnapshotV2 {
  headline: { label: string; value: string; dollarValue?: number };
  metrics: Array<{
    key: string; label: string; value: string;
    delta?: { direction: 'up' | 'down' | 'flat'; text: string; good: boolean };
  }>;
  series?: { label: string; points: Array<{ date: string; value: number }> }; // 14 days
  attention: Array<{ key: string; text: string; href?: string }>;
  recentEvents: Array<{ at: string; text: string }>; // newest first, max 5
}
```

- `getSnapshot(tenantId)` returns `SnapshotV2`. This is a breaking contract change —
  migrate both modules and every caller in the same step; no dual support, no
  `SnapshotResult` left anywhere (orchestrator prompt assembly included).
- Missed-Call Text-Back: headline = missed calls recovered this week with
  `dollarValue` from the value ledger (Step 2); metrics = recovered count,
  not-yet-recovered count, response rate; series = daily text-backs sent, 14 days;
  attention = unrecovered calls (deep-link to Activity tab); recentEvents from
  missed_calls rows.
- Review Generation: headline = reviews completed this week; metrics = requests sent,
  completion rate, average rating with delta vs prior week; series = daily completed
  reviews; attention = ratings <= 3 this week (private feedback to read); recentEvents
  from review_responses rows.
- Weekly-report engine and orchestrator consume the new shape (they read snapshots
  today — update their formatting, don't let them break).
- Verify: unit tests for both mappers (empty tenant and seeded tenant); live GET of
  both module snapshot endpoints as the demo tenant showing the full v2 JSON.

### Step 2 — value_events ledger
Nothing records the dollar value the product creates; "recovered revenue" is copy, not
data. New migration `00xx_create_value_events.sql` (shared schema, RLS, same pattern
as activity_log):

```sql
create table value_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  module_key text not null,
  event_type text not null,          -- e.g. 'missed_call_recovered', 'review_completed'
  amount_cents integer not null check (amount_cents >= 0),
  basis text not null check (basis in ('estimated', 'verified')),
  basis_note text not null,          -- the honest math, e.g. 'avg job value $180 x 35% booking rate'
  source_ref uuid,                   -- row id in the module's own table
  occurred_at timestamptz not null default now()
);
```

- Per-tenant estimation inputs live in module config (missed-call-textback config
  gains `avgJobValueCents` + `bookingRate`, with defaults and schema entries), so the
  math is per-business, inspectable, and editable in module settings.
- ValueLedgerService in `backend/src/shared/` (or core — follow eslint-boundaries):
  `record(...)` idempotent on (tenant_id, module_key, event_type, source_ref) so
  re-processing can't double-count; `weeklyTotal(tenantId)`, `total(tenantId)`,
  `weeklySeries(tenantId, days)` for the home hero and snapshots.
- Write paths: missed-call-textback records an estimated event when a recovery
  completes (define recovery = caller replied after text-back; if the current schema
  can't see replies, the honest event is 'textback_sent' with the estimate in
  basis_note); review-generation records an estimated event per completed review.
- Backfill: one-off script mapping existing demo-tenant rows into value_events so the
  hero is not $0 on day one.
- Verify: tenant-isolation test for the table; idempotency test (same source_ref twice
  = one row); live check — insert via the real write path on the demo tenant, select
  the row, confirm sums.

### Step 3 — Batched snapshot + value endpoint
The home page must not fan out N requests. Extend the Phase 6 batched pattern:
`GET /module-manifest/snapshots` returns every enabled module's SnapshotV2 (module
failures degrade per-module, not whole-response — reuse the batched-status error
shape), plus `GET /value-ledger/summary` returning `{ weekTotalCents, allTimeCents,
weeklySeries, basis: 'estimated' | 'mixed' | 'verified' }`.
- Verify: spec with the alpha/beta/ghost/disabled fixture (one module throwing);
  live curl of both endpoints as the demo tenant.

---

## Group B — Generic premium surfaces (dashboard)

### Step 4 — One generic module widget
The per-module widget files exist because the old contract carried one string. Replace
`MissedCallTextbackWidget` + `ReviewGenerationWidget` + the WIDGET_REGISTRY with one
`ModuleSnapshotCard` driven entirely by SnapshotV2: headline (StatBlock, gold dollar
figure when dollarValue present), metric row with delta arrows (not color-only — 
direction glyph + text), 14-day sparkline (inline SVG on chart tokens, aria-hidden with
a text summary), attention items as links, hover-lift + shadow-raised. Skeleton matches
final layout. Keep ModuleErrorBoundary per card. Delete the per-module widgets; the
registry in module-loader shrinks to a fallback map for future custom widgets.
- The dataviz skill governs the sparkline (read it before writing chart code).
- Verify: vitest for ModuleSnapshotCard (full v2, minimal v2, empty states); live
  click-through both cards on the demo tenant, dark + light.

### Step 5 — Module detail Overview tab on v2
OverviewTab currently renders the one-string snapshot. Rebuild it as the generic
analytics view: headline + metric grid + larger series chart + attention list +
recent events timeline, all from the same snapshot query (shared TanStack key with
the home card — one fetch). Tabs/Activity/Settings unchanged.
- Verify: live walk of both modules' Overview tabs; keyboard walk still passes
  (tablist from Phase 6 untouched).

### Step 6 — Command-center home
Home becomes the executive answer to "what is happening / what has it created /
what needs me":
1. Value hero: "Your systems recovered $X this week" from /value-ledger/summary,
   all-time beneath, small weekly sparkline; when basis is estimated, a quiet
   "estimated from your average job value" footnote linking to settings — honest,
   never inflated. $0 state gets encouraging client-language copy, not an empty hero.
2. Attention queue: aggregated `attention` items across snapshots + any module with
   'needs attention' status; each row deep-links; empty state = "Nothing needs you
   right now."
3. Module snapshot grid: the Step 4 cards.
4. Recent activity: last 10 activity_log rows for the tenant translated to client
   language (a small event_type -> sentence map in one file; unmapped types render
   nothing rather than leaking internals), relative timestamps.
- Layout: PageHeader + hero full-width, then attention (when non-empty), then grid,
  then activity. Responsive from one to three columns; no horizontal scroll at 375px.
- Verify: live on demo tenant in both themes + mobile viewport; skeleton pass
  (suspend backend trick); a11y lint + keyboard spot-check; branding check.

### Step 7 — Ledger honesty in Business Reports
The weekly report engine gains the week's value_events total in its data payload and
the report page shows "Recovered value this week: $X (estimated)" with the same basis
footnote. No new report generation pipeline — just the number, honestly labeled.
- Verify: regenerate the demo tenant's current-week report via the existing manual
  script; confirm the figure appears and the notification dedupe still holds (count
  stays 1).

---

## Definition of done

- `SnapshotResult` is gone; both modules, orchestrator, weekly reports, and dashboard
  all speak SnapshotV2; per-module widget files deleted.
- value_events live with RLS + isolation + idempotency tests; estimation inputs in
  module config; demo tenant backfilled; every dollar figure on screen traces to
  sum(value_events) and carries its basis.
- Home = hero + attention + cards + activity, all data from two batched requests
  (snapshots, value summary) plus the existing batched status.
- All suites green (backend + dashboard), branding + a11y lint green, live demo-tenant
  walk in both themes verified, no test rows left behind, PROJECT-STATE.md updated,
  merged via PR.
