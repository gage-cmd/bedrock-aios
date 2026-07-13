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

## Known open items

- **Railway backend is DOWN (502 "Application failed to respond") as of Jul 12.** No Railway CLI/token on this machine; needs the Railway dashboard to read deploy logs/env. Two boot-crash candidates fixed on this branch (pg was a devDependency; start:prod pointed at dist/main instead of dist/src/main) — redeploy from main after merge and re-check.
- Twilio has never been connected: TWILIO_* values are empty locally, all tenant numbers are fake 555 stubs from the stub client, SMS_PROVIDER=stub. Needs real credentials before any live SMS.
- Password reset flow is code-complete but the live email leg is unverified (needs a real send + Supabase Auth redirect-URL allow-list check for the deployed /set-password URL).
- Monorepo-wide 3-stage code quality audit: started Jul 9 (session 6956e80e), abandoned 6 minutes into Stage 1. Not resumed.
- "Invalid Date" bug on Business Reports detail page: verified fixed Jul 12 (detail page renders "Week of July 6 – July 12, 2026" correctly).
- Vercel projects: cleaned to one dashboard project (bedrock-aios-dashboard) + the separate marketing site (bedrock-website, serves getbedrockai.com). The dashboard is NOT on getbedrockai.com.
- Supabase Auth custom-claims hook registration is a manual dashboard step — re-register if the project is ever recreated.
- Demo tenant has 4 duplicate "weekly report ready" notifications from dev-time report runs; one real report row.

## Frozen predecessors (do not build on these)

- `~/Desktop/BedrockAI/_CLIENT-TEMPLATE/` — original demo template (Express + FastAPI dashboard)
- `~/Desktop/BedrockAI/bedrock-os/` and `~/Desktop/bedrock-os/` — Jul 4-5 generation
- `~/Desktop/BedrockAI/bedrock-ai-v2/` — Jul 5-6 generation (operator console, audit tool)
