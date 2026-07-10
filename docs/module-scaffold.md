# Module scaffold generator

New feature modules are generated from convention templates by the
`scaffold-module` Claude Code skill (`.claude/skills/scaffold-module/`). The
goal: building a new module is almost entirely convention, not manual
integration. Everything the platform reads by convention at runtime — metadata,
settings schema, capabilities, snapshot, status — comes from the module's own
files, so the generator just lays those files down and makes the few wiring
edits that Nest's static graph can't infer.

## How to use it

From a Claude Code session rooted in this repo:

> scaffold a module `appointment-reminders`

or invoke the skill directly. It asks for (or defaults) a display title, a
client-facing description, and the primary table name, then generates and wires
everything below.

## What it generates

Given a `moduleKey` (kebab-case), it derives the PascalCase name, the snake_case
Postgres schema, and the next migration number, then writes:

Backend (`backend/src/modules/<moduleKey>/`):

- `<moduleKey>.service.ts` — implements the shared `ModuleContract`
  (`handleRequest` / `getSnapshot` / `getStatus` / `getCapabilities` /
  `getQueryableIntents`), importing the contract type from
  `core/module-registry/module-contract.ts`. Never redeclares it.
- `<moduleKey>.module.ts` — self-registers the service into
  `ModuleRegistryService` at boot (`onModuleInit`), the allowed module -> core
  direction.
- `api/<moduleKey>.controller.ts` — the tenant-scoped `actions` / `snapshot` /
  `status` / `capabilities` routes.
- `config.json`, `settings.schema.json` — metadata + settings-form schema stubs,
  read by convention (`ModuleRegistryService.readModuleFile`).
- `db/schema.sql` — module-local canonical copy of the DDL.
- `tenant-isolation.spec.ts` — the RLS cross-tenant test, adapted from
  `core/tenant-resolver/tenant-isolation.template.spec.ts`.

Migration (`backend/shared/db/migrations/NNNN_create_<schema>_<table>.sql`) —
follows the `tenant_isolation` RLS + schema-grants pattern exactly (copied from
migration 0013).

Dashboard (`apps/dashboard/`):

- `components/module-widgets/<Name>Widget.tsx` — the Business Snapshot widget.
- `components/module-detail/<moduleKey>/ActivityTab.tsx` — the Activity tab.

The Overview and Settings tabs need no per-module code: `OverviewTab` reads the
module's snapshot route by `moduleKey`, and `ModuleSettingsPanel` renders from
`settings.schema.json`. Both are generic (Workstream 3).

## What it wires automatically

Three surgical edits the skill makes for you (the reason the manual code steps
are effectively zero):

1. `backend/src/app.module.ts` — adds the module import + `imports:` entry.
   **It never touches the `.exclude()` auth allow-list** — new routes stay
   middleware-guarded by default.
2. `apps/dashboard/lib/module-loader.tsx` — adds the `WIDGET_REGISTRY` entry.
3. `apps/dashboard/lib/module-detail-tabs.tsx` — adds the `MODULE_TABS` entry.

## The remaining manual steps

Code wiring is automatic; two things still require a human, by design:

1. **Apply the migration.** There is no migration runner — migrations are run
   manually against Supabase (see CLAUDE.md). Until the migration runs, the
   module's snapshot, activity, and `tenant-isolation.spec.ts` fail because the
   table does not exist. This is the one unavoidable non-code step.
2. **Replace the stub data model and logic.** The generated service, migration,
   `db/schema.sql`, and `settings.schema.json` model a single placeholder table
   (`id`, `tenant_id`, `created_at`) and one read intent (`get-recent-records`).
   Flesh out the real columns (keep the migration and `db/schema.sql` in sync),
   the settings fields, and the `handleRequest` intents. Never advertise a write
   intent in `getQueryableIntents()` — the orchestrator answers questions, it
   does not act.

To surface the module in a tenant's dashboard, enable it for that tenant in
`module_manifest` via the Onboarding Console.

## Verification the templates are known-good

The templates were verified end-to-end by generating a throwaway `demo-scaffold`
module, wiring it, and confirming: `nest build` clean, eslint (boundaries +
prettier) clean, `check-branding.sh` clean, the dashboard typechecks, the full
backend suite passes (148/148, +3 from the generated isolation spec), and the
generated `tenant-isolation.spec.ts` passes against the live Supabase DB after
applying the migration (RLS blocks cross-tenant reads). The demo module and its
schema were then removed. The generated wiring is structurally identical to the
two shipping modules (review-generation, missed-call-textback).
