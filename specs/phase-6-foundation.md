# Phase 6 — Foundation: production health, data-path plumbing, experience primitives

Source: product audit + master roadmap, Jul 12 2026 (roadmap Phase 1). Goal: nothing
visibly new on screen, but production is alive, every data path is unified and cheap,
and the design system has the depth the Phase 7 command-center redesign will build on.

Prerequisites: Phases 0-5 complete (see PROJECT-STATE.md). PR #6 (production-readiness)
is merged to main.

Explicitly OUT of scope (Phase 7+): Snapshot Contract v2, value_events ledger, home
page redesign, live activity feed, Command Center streaming/citations, dark mode QA
sign-off as a shipped feature, mobile navigation.

Ways of working: one commit per completed step, descriptive message, push after each
group. Steps marked MANUAL need Gage in a dashboard (Railway / Twilio / Supabase) —
say so and wait; never fake them with stubs or migrations. Verify per CLAUDE.md: green
units are not done; every integration-facing step ends with a 1-record live check.

---

## Group A — Production recovery (blocks everything; mostly manual-gated)

### Step 1 — Railway backend up (MANUAL: Railway dashboard)
The backend has been 502 since Jul 12. The two known boot-crash fixes (pg was a
devDependency; start:prod pointed at dist/main instead of dist/src/main) are merged.
- Gage: redeploy the backend service from main in the Railway dashboard; if it still
  502s, read the deploy logs there (no Railway CLI/token on this machine) and report
  the error back.
- Verify: curl the Railway URL root/health route (expect a response, not 502), then
  log in to the Vercel dashboard as the demo tenant (Golden Gate Dental,
  cc-demo@getbedrockai.com) and ask the Command Center one question end-to-end.
- Record the outcome in PROJECT-STATE.md open items.

### Step 2 — Real Twilio connection (MANUAL: Twilio console + Railway env)
TWILIO_* are empty everywhere, SMS_PROVIDER=stub, all tenant numbers are 555 stubs.
- Gage: create/collect Twilio account SID, auth token, and buy one real number for
  the demo tenant. Credentials go straight into .env and Railway env vars — never
  into chat or commits.
- Code: whatever small wiring is needed so the demo tenant's tenant_phone_numbers row
  holds the real number and SMS_PROVIDER=twilio activates TwilioSmsClient in prod.
- Verify (1-record live): trigger one missed-call text-back against the real number
  (or one review request SMS) and confirm delivery on a real phone. Confirm the
  Twilio signature guard accepts the real webhook.

### Step 3 — Password-reset email leg (MANUAL: Supabase dashboard)
Code-complete since the production-readiness pass; the live email leg is unverified.
- Gage: confirm the deployed /set-password URL is on the Supabase Auth redirect-URL
  allow-list.
- Verify: run one real forgot-password send to a controlled inbox, follow the link,
  set a password, log in. Update PROJECT-STATE.md.

---

## Group B — Data-path plumbing (backend + dashboard, no visual change)

### Step 4 — Shared dashboard API client
The get-session / fetch / check-ok / parse pattern is hand-copied in 8+ files (every
lib/*-client.ts, module-loader.tsx, both module widgets, OverviewTab).
- Add `apps/dashboard/lib/api.ts` exporting `apiFetch<T>(path, init?)`: resolves the
  Supabase session, sets the Authorization header, prefixes NEXT_PUBLIC_BACKEND_URL,
  normalizes non-2xx into a typed error, parses JSON.
- Refactor every existing call site onto it. No behavior change.
- Verify: dashboard vitest suite green; click through all six routes against the
  local backend.

### Step 5 — Query layer (TanStack Query)
Raw useEffect fetching everywhere — no cache, no dedup; SystemStatusStrip plus each
page refetch the module list on every navigation.
- Add @tanstack/react-query; QueryClientProvider in the root layout; sensible default
  staleTime (~60s) so per-navigation refetches disappear.
- Convert the data reads: module manifest, module status, snapshots, reports list +
  detail, notifications, tenant. Keep component-level error/empty rendering as is.
- Verify: navigate between pages and confirm (network tab) the module list is fetched
  once, not per page per component; tests green.

### Step 6 — Batched status endpoint
Status is currently 1 + N requests (list, then GET /modules/:key/status per module),
fired by the strip on every page.
- Backend: `GET /module-manifest/status` returns `[{ moduleKey, status }]` for every
  enabled module of the requesting tenant, calling each registered instance's
  getStatus with the existing timeout/degradation pattern (a throwing module reports
  needs-attention, never fails the batch).
- Dashboard: SystemStatusStrip and Installed Systems consume it via one query.
- Verify: unit test for the batch route (stub module that throws degrades correctly);
  live curl as the demo tenant shows both modules; strip renders identically.

### Step 7 — Shared database module (one pg pool)
OrchestratorService and ExecutiveOversightService each construct a private Pool with
duplicated config.
- Add a core `DatabaseModule` providing one Pool (discrete fields, pooler host/port
  from env — see CLAUDE.md gotchas; password must not go through a URL parser).
  Inject it in both services; remove the per-service pools and onModuleDestroy ends.
- Keep ssl behavior as-is for now; note the CA-cert upgrade as a future item.
- Verify: backend test suite green (--runInBand if pooler contention); one live
  Command Center question and one manual report generation via
  scripts/generate-report.ts still work.

### Step 8 — usage_logs actually written
The table exists (tokens_used, cost) and nothing writes it, so per-tenant AI margin
is invisible.
- AnthropicAiClient records per-call usage: callers (orchestrator, executive
  oversight) pass { tenantId, moduleKey } context; the client inserts tokens in/out
  and computed cost (small model->price map, env-overridable) via the shared pool.
  A logging failure must never fail the AI call (same pattern as routing-log writes).
- StubAiClient: no-op.
- Verify: ask the demo tenant one Command Center question; select the new usage_logs
  row and check tokens > 0 and cost > 0. Clean up any test rows.

### Step 9 — Weekly-report notification dedupe
Demo tenant has 4 duplicate "weekly report ready" notifications from dev runs.
- Write-time guard: creating the notification for a (tenant, week_of) that already
  has one is a no-op (align with the reports table's one-per-week key).
- One-off cleanup of the existing duplicate rows for the demo tenant (keep one).
- Verify: rerun report generation for the current week; notification count for that
  week stays 1.

---

## Group C — Experience foundation (visible polish, no redesign)

### Step 10 — Cookie sessions and a real server-side gate
Sessions are localStorage-based, so middleware.ts can only label routes; the
(dashboard) layout gates client-side and renders null until the session check
resolves — a blank flash on every hard load.
- Migrate to @supabase/ssr cookie-based sessions (browser + server client helpers).
- middleware.ts: keep the explicit PUBLIC_ROUTE_PATTERNS allow-list exactly as is,
  and start enforcing it — no session on a gated route redirects to /login at the
  edge. The layout keeps only the onAuthStateChange listener (cross-tab sign-out);
  the blank `if (!checked) return null` state goes away.
- This touches login/logout/set-password/forgot-password flows — run their vitest
  suites and update them for the new client.
- Verify: hard-reload a gated page while logged in (content on first paint, no
  flash); logged-out hits redirect; /review/[token] still loads with no session;
  middleware.test.ts updated and green.

### Step 11 — Design token depth (including dark tokens)
globals.css is 10 color tokens, 3 fonts, 1 animation.
- Add scales: spacing, radius, shadow (soft, layered), motion durations/easings.
- Add semantic aliases (surface-raised, text-on-accent, chart ramp from the existing
  gold/navy) so components stop hardcoding text-white and one-off rgba borders.
- Define the dark theme purely at token level: prefers-color-scheme media query plus
  a `[data-theme]` override hook. Contrast-tune ink/surface/gold for dark. Shipping a
  visible toggle is Phase 7; the tokens landing now is what makes it cheap.
- Verify: light theme renders pixel-identical (spot-check all routes); force
  data-theme=dark in devtools and confirm every route is legible (QA-level, not
  ship-level).

### Step 12 — Component primitives + loading/empty states
Every card, stat, empty state, and badge is a hand-typed Tailwind string; loading is
the literal text "Loading...".
- Add `components/ui/`: Card, StatBlock (mono tabular numerals, gold value), Badge /
  StatusDot (with accessible label, not color-only), EmptyState (title, body, using
  client language — audit the current "Module snapshot cards will appear here" copy,
  which violates the branding rule), Skeleton (shimmer, reduced-motion safe),
  PageHeader (serif title + subtitle).
- Refactor existing screens onto the primitives. Replace every "Loading..." with a
  skeleton matching the final layout. Visual result should be near-identical except
  skeletons and corrected empty-state copy.
- check-branding.sh must pass; extend it if the new copy paths are not covered.
- Verify: vitest green; click through all routes with network throttled to see
  skeletons.

### Step 13 — Accessibility pass + CI gate
17 dashboard components carry no aria attributes; tabs are divs with onClick; status
is color-only; focus states unaudited.
- Module detail tabs become a proper tablist (roles, aria-selected, arrow keys).
  Status dots get sr-only text or aria-label. Interactive elements get visible
  focus-visible states via a token. Form inputs get labels.
- Add eslint-plugin-jsx-a11y (recommended set) to the dashboard ESLint config; fix
  what it flags; it runs in the existing CI lint job.
- Verify: keyboard-only walk of login -> home -> module detail -> settings tab ->
  sign out; lint green in CI.

---

## Definition of done

- Railway backend serving; one live Command Center round-trip from the deployed
  dashboard; one real SMS delivered via Twilio; one real password-reset email
  completed. PROJECT-STATE.md open items updated to match reality.
- Zero raw fetch+session call sites left in apps/dashboard outside lib/api.ts;
  module list fetched once per navigation; status is one batched request.
- One shared pg pool in the backend; usage_logs rows appearing for real AI calls.
- First paint on gated routes is real content with a valid cookie session; public
  routes unchanged.
- Tokens, primitives, skeletons, and the a11y lint gate merged; branding check green;
  no test rows left in the live DB.
- PROJECT-STATE.md marks Phase 6 complete with commit hashes; pushed to GitHub.
