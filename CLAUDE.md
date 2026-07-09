# bedrock-aios — AIOS Platform

Multi-tenant AI Operating System platform for Bedrock AI clients (local service businesses). This is the current active platform build — it supersedes `_CLIENT-TEMPLATE/` in the BedrockAI repo, `bedrock-os`, and `bedrock-ai-v2` (all frozen).

**Always launch Claude Code from this directory** (`cd ~/Desktop/bedrock-aios && claude`), not from BedrockAI. Typing "cd ~/Desktop/bedrock-aios claude" into a running session does nothing — the session stays rooted where it started.

## Session start checklist

1. Read `PROJECT-STATE.md` — the phase ledger. Never redo a phase marked complete; verify against `git log` if in doubt.
2. Run `git status`. If the tree is dirty from an interrupted session, report what is there before editing anything.
3. Build specs live in `specs/`. If a task references a phase or spec, read the file instead of relying on a pasted recap.

## Stack

- pnpm monorepo (`pnpm@11.10`, requires Node >= 22.13; CI pinned to Node 22)
- `apps/dashboard` — Next.js 16 (App Router, Turbopack, eslint-config-next with React Compiler rules)
- `backend` — NestJS 11, ESLint 9 flat config with `eslint-plugin-boundaries`
- DB/Auth: Supabase (Postgres + GoTrue), RLS keyed off `auth.jwt() ->> 'tenant_id'`
- AI: Anthropic API via `src/shared/ai` (`StubAiClient` / `AnthropicAiClient`; model always from env: `ORCHESTRATOR_MODEL`, `REPORT_MODEL`)
- Jobs: pg-boss v12 (weekly reports)
- Hosting: Vercel (dashboard), Railway (backend)

## Source tree facts

- Real backend code is `backend/src/**` (jest rootDir, nest sourceRoot). Top-level `backend/core|modules` are mostly empty scaffolds — EXCEPT `backend/shared/db/migrations/` (raw .sql, applied manually, no runner) and `backend/shared/queue/`, which are real. "backend/core/orchestrator" in a prompt means `backend/src/core/orchestrator`.
- `nest build` emits `dist/src/**`, not `dist/**`; nest-cli `assets` need `"outDir": "dist/src"`.
- Modules self-register into `ModuleRegistryService` at boot (`onModuleInit`) because eslint-boundaries forbids core -> module imports. New modules implement `ModuleContract` and call `registry.registerModule(key, service)`. Never advertise write intents via `getQueryableIntents()`.
- Module settings live only in `module_manifest.config`. Module list comes from `ModuleRegistryService.getRegisteredModuleKeys()` — never hardcode module pairs.
- Auth middleware is deny-by-default: `TenantResolverMiddleware` on `forRoutes('*')` with explicit `.exclude()` allow-list for public routes. Public surfaces use token-scoped services (the unguessable token IS the authorization); they never accept a tenantId from the request.

## Environment gotchas (learned the hard way — check before debugging)

- **DB connections**: direct host `db.<ref>.supabase.co:5432` is IPv6-only and unreachable from this machine. App queries use the transaction pooler (`...pooler.supabase.com:6543`). pg-boss needs session mode — port 5432 on the same pooler host (`REPORT_QUEUE_DB_PORT`).
- The DB password contains `!?` — the `pg` npm client's URL parser chokes on it. Pass discrete `{host, port, user, password, database, ssl}` fields, not a connection-string URL.
- Pooler calls intermittently fail in the sandbox (DNS, JWKS fetch surfacing as a misleading 401). Retry once before assuming the code is wrong. Anthropic/Supabase outbound calls need sandbox disabled.
- Jest: `jose` and pg-boss are pure ESM. jose is whitelisted in `transformIgnorePatterns` with a pnpm-aware pattern; pg-boss must stay out of the jest module graph (type-only import + lazy `await import()` behind the `NODE_ENV==='test'` guard). Isolated non-reproducing integration failures under parallel workers are pooler contention — re-run or use `--runInBand` before assuming breakage.
- Interface-only imports used in constructor params require `import type` (isolatedModules + emitDecoratorMetadata; only `nest build` catches it). Optional constructor deps need `@Optional()` from `@nestjs/common`, or the app crashes at boot with `UnknownDependenciesException`.
- Preview tools: synthetic `preview_click`/`preview_fill` often fail to drive React state (especially the `/login` form). Go straight to `preview_eval` native-event dispatch, or inject a real session into localStorage from a `curl` password-grant token.
- Supabase Auth hook registration and some dashboard settings are manual steps in the Supabase dashboard — say so explicitly rather than pretending a migration covers them.

## Testing and verification rules

- Tests must not leave rows in the live Supabase DB. Any spec that inserts tenants/users cleans up in `afterAll`, even on failure. If cleanup is impossible, use the stub clients.
- Green units are not "done". After any integration-facing change, do a 1-record live verification (curl the endpoint, run the script against the demo tenant) before declaring it working.
- Demo tenant for manual verification: "Golden Gate Dental (Command Center Demo)", tenant `d91ce9d4-ff4b-4924-95bf-605219a11625`, dashboard login `cc-demo@getbedrockai.com` (password in the Phase 3 memory note; dev-only throwaway).
- Middleware-exclusion check trick: curl with no token — a bare `{message}` 401 is the middleware, a Nest-shaped `{message, error, statusCode}` is a guard.

## Working rules

1. **Read first when asked.** If a prompt says "give me your read before changing anything", produce the analysis before any Edit. Editing first gets the session killed.
2. **Branding**: client-facing copy never says AI, agent, module, bot, or system. `check-branding.sh` greps the dashboard; orchestrator/report/welcome copy must pass `\b(AI|agent|module|system|bot)\b/i` too. We talk about their money, not our AI.
3. **Secrets**: never commit `.env`; never echo secrets into chat or logs. Credentials go straight into `.env` files. A gitleaks pre-commit hook is installed — do not bypass it with `--no-verify`.
4. **Commits**: commit at each completed step/phase, push to GitHub, then update `PROJECT-STATE.md` in the same commit as the phase completion. No emojis in code, comments, or commit messages.
5. Style: match existing file conventions; 2-space indent; kebab-case filenames.

## Commands

- Install: `pnpm install` (root)
- Dashboard dev: `pnpm --filter dashboard dev` (port 3000)
- Backend dev: `pnpm --filter backend start:dev` (port 3001) — prefer `nest build && node dist/src/main` over `--watch` when iterating fast (zombie-port issue)
- Backend tests: `pnpm --filter backend test` (add `--runInBand` for flaky integration reruns)
- Preview servers are configured in `.claude/launch.json` (`dashboard`, `backend`)
