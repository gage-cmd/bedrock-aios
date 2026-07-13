# PROJECT-STATE — bedrock-aios phase ledger

Single source of truth for what is built. Read this at session start instead of pasting a phase recap into the prompt. Update it (same commit) whenever a phase or major step completes. Never redo a phase listed as complete — verify with `git log` if in doubt.

Build specs belong in `specs/` as files, referenced by name ("build Phase 6 per specs/phase-6.md"), not pasted into chat. If a session dies mid-phase, recovery is: "continue Phase N from specs/phase-N.md, check PROJECT-STATE.md and git log first."

| Phase | Status | Commit | Shipped |
|---|---|---|---|
| Phase 0 — pnpm monorepo, Next.js dashboard + NestJS backend, Vercel/Railway/Supabase, CI (lint boundaries, branding check, Node 22) | complete | ba58ad4 | Jul 6 |
| Phase 1 — multi-tenant schema (7 tables, RLS), custom access token hook (app_role claim), tenant-resolver middleware, dashboard shell | complete | 8396860 | Jul 7 |
| Phase 2 — Review Generation module (stub messaging, public /review/[token] funnel, e2e) | complete | 6c224fc | Jul 8 |
| Phase 2b — Missed-Call Text-Back: minimal module | complete | 5cc7c69 | Jul 8 |
| Phase 2b — Missed-Call Text-Back: settings, dashboard, tests (Steps 2, 4, 5) | complete | a2c961b | Jul 8 |
| Phase 2b — Missed-Call Text-Back: Twilio Voice webhooks + signature verification (Step 3) | complete | ea68308 | Jul 8 |
| Phase 3 — Command Center orchestrator (module self-registration, ModuleContract, routing audit log, caching; live-verified vs claude-sonnet-5) | complete | badb59c | Jul 8 |
| Phase 4 — Executive Oversight weekly report engine (pg-boss scheduler on session pooler, AiClient moved to shared/ai, REPORT_MODEL) | complete | 631ac9d | Jul 8 |
| Phase 4 follow-up — REPORT_MODEL env docs, manual report script | complete | 8daf0dc | Jul 8 |
| Phase 5 Step 1 — platform-admin privilege boundary (AdminGuard, DB mutual-exclusion constraint) | complete | c9beccb | Jul 8 |
| Phase 5 — Onboarding Console (admin/onboarding routes + wizard, InviteClient) | complete | ae1ee36 | Jul 9 |
| Post-phase — dashboard visual design system (ink/serif/gold/mono tokens), sidebar restructure | complete | 1d90b51, 9e9487e | Jul 9 |
| Post-phase — login page redesign to match design system | complete | 94043e0 | Jul 9 |
| Post-phase — invite-link password-set page, redirect_to wiring for client invites | complete | 1a36e67 | Jul 9 |
| Post-phase — app-layer cross-tenant IDOR test for weekly reports | complete | 74afc48 | Jul 9 |
| Production readiness pass — forgot-password flow + dashboard vitest infra, pg runtime-dep fix, scaffold-module dry-run verified, full route audit, Vercel NEXT_PUBLIC_BACKEND_URL scheme fix | complete | (this branch) | Jul 12 |
| Phase 6 — foundation (specs/phase-6-foundation.md): Railway recovery verified (ce89fb4), shared apiFetch (c96a991), TanStack Query layer (92985c4), batched status endpoint (2399f7d), shared pg pool (5362556), usage_logs written (cbae43a), report notification dedupe (5842021), cookie sessions + edge gate (27d78a0), design tokens + dark theme (d7ffa13), UI primitives + skeletons (9d2fdd1), a11y pass + jsx-a11y CI gate (1ec26e8) | code complete — Steps 2-3 manual, see open items | 1ec26e8 | Jul 13 |

## Known open items

- Railway backend outage RESOLVED Jul 12: after PR #6 merged, Railway auto-deployed from main and the two boot fixes (pg devDependency, dist/src/main path) took. Verified live: HTTP 200 root, plus a full Command Center round-trip as the demo tenant (correct grounded answer, HTTP 201).
- Twilio has never been connected: TWILIO_* values are empty locally, all tenant numbers are fake 555 stubs from the stub client, SMS_PROVIDER=stub. Needs real credentials before any live SMS. (= Phase 6 Step 2, MANUAL: Twilio console + Railway env.)
- Password reset flow is code-complete but the live email leg is unverified (needs a real send + Supabase Auth redirect-URL allow-list check for the deployed /set-password URL). (= Phase 6 Step 3, MANUAL: Supabase dashboard.)
- Phase 6 keyboard-walk note: the in-app browser tooling cannot synthesize native Enter/Space activation, so activation in the walk was substituted with .click() on the keyboard-focused element; tab order, focus rings, roving tabindex, and arrow-key tablist navigation were all verified with real key events.
- Demo tenant duplicate "weekly report ready" notifications cleaned in Step 9; the dedupe guard was verified live (regeneration kept the count at 1).
- Monorepo-wide 3-stage code quality audit: started Jul 9 (session 6956e80e), abandoned 6 minutes into Stage 1. Not resumed.
- "Invalid Date" bug on Business Reports detail page: verified fixed Jul 12 (detail page renders "Week of July 6 – July 12, 2026" correctly).
- Vercel projects: cleaned to one dashboard project (bedrock-aios-dashboard) + the separate marketing site (bedrock-website, serves getbedrockai.com). The dashboard is NOT on getbedrockai.com.
- Supabase Auth custom-claims hook registration is a manual dashboard step — re-register if the project is ever recreated.

## Frozen predecessors (do not build on these)

- `~/Desktop/BedrockAI/_CLIENT-TEMPLATE/` — original demo template (Express + FastAPI dashboard)
- `~/Desktop/BedrockAI/bedrock-os/` and `~/Desktop/bedrock-os/` — Jul 4-5 generation
- `~/Desktop/BedrockAI/bedrock-ai-v2/` — Jul 5-6 generation (operator console, audit tool)
