---
name: scaffold-module
description: Generate a new bedrock-aios feature module (backend NestJS module implementing ModuleContract, config/schema stubs, RLS migration, tenant-isolation test, and the dashboard widget + tabs) from convention templates, then auto-wire it. Use when the user says "scaffold a module", "new module", "generate module <key>", or starts building a new AIOS module.
---

# Module scaffold generator

Generates a complete, convention-wired feature module from the templates in
`templates/`, then performs the wiring edits so the module boots, self-registers,
and shows up in the dashboard. Everything the platform reads by convention
(metadata, settings schema, capabilities, snapshot, status) comes from the
module's own files at runtime — this skill just lays those files down and makes
the few unavoidable wiring edits.

Read `../../../CLAUDE.md` (source-tree facts, boundaries, branding) before running.

## Inputs

Collect these first. Only `moduleKey` is required; ask for the rest if not given.

- **moduleKey** (required) — kebab-case, e.g. `appointment-reminders`. Must not
  already exist under `backend/src/modules/`.
- **title** — human display name, e.g. `Appointment Reminders`. Client-facing:
  never contains "AI", "agent", "bot", "module", or "system". Default: Title Case
  of the moduleKey.
- **description** — one client-facing sentence about the money it protects/recovers,
  not the technology. Default: a neutral one-liner from the title.
- **table** — the module's primary table name, snake_case, e.g. `reminders`.
  Default: `events`.

## Derived tokens

Compute these from the inputs and substitute every occurrence when copying each
template (`__TOKEN__` -> value):

| Token | Value | Example |
|---|---|---|
| `__MODULE_KEY__` | moduleKey as given | `appointment-reminders` |
| `__MODULE_NAME_PASCAL__` | PascalCase of moduleKey | `AppointmentReminders` |
| `__MODULE_SCHEMA__` | moduleKey with `-` -> `_` | `appointment_reminders` |
| `__MODULE_TABLE__` | table input | `events` |
| `__MODULE_TITLE__` | title | `Appointment Reminders` |
| `__MODULE_DESCRIPTION__` | description | `...` |
| `__MIGRATION_NUMBER__` | next 4-digit migration number | `0019` |
| `__MIGRATION_FILENAME__` | `<num>_create_<schema>_<table>.sql` | `0019_create_appointment_reminders_events.sql` |

Find `__MIGRATION_NUMBER__` by `ls backend/shared/db/migrations/`, taking the
highest existing `NNNN_` prefix and adding 1 (zero-padded to 4 digits).

## Step 1 — generate files

For each template below, read it from `templates/`, replace all `__TOKEN__`
occurrences, and write to the destination. `.tmpl` is stripped from the name.

Backend (`backend/src/modules/__MODULE_KEY__/`):

| Template | Destination |
|---|---|
| `backend/service.ts.tmpl` | `__MODULE_KEY__.service.ts` |
| `backend/module.ts.tmpl` | `__MODULE_KEY__.module.ts` |
| `backend/controller.ts.tmpl` | `api/__MODULE_KEY__.controller.ts` |
| `backend/config.json.tmpl` | `config.json` |
| `backend/settings.schema.json.tmpl` | `settings.schema.json` |
| `backend/schema.sql.tmpl` | `db/schema.sql` |
| `backend/tenant-isolation.spec.ts.tmpl` | `tenant-isolation.spec.ts` |
| `backend/migration.sql.tmpl` | `backend/shared/db/migrations/__MIGRATION_FILENAME__` |

Dashboard (`apps/dashboard/`):

| Template | Destination |
|---|---|
| `dashboard/Widget.tsx.tmpl` | `components/module-widgets/__MODULE_NAME_PASCAL__Widget.tsx` |
| `dashboard/ActivityTab.tsx.tmpl` | `components/module-detail/__MODULE_KEY__/ActivityTab.tsx` |

## Step 2 — auto-wire (three surgical edits)

These are the wiring edits that can't be convention-driven. Make each by
inserting alongside the existing module's entries; do not reformat surrounding
code.

1. **`backend/src/app.module.ts`** — add
   `import { __MODULE_NAME_PASCAL__Module } from './modules/__MODULE_KEY__/__MODULE_KEY__.module';`
   with the other `./modules/...` imports, and add `__MODULE_NAME_PASCAL__Module,`
   to the `imports:` array (append after the existing feature-module entries).
   **NEVER touch the `.exclude(...)` allow-list in this file** — it is the auth
   boundary. The new module's routes are guarded by default and must stay that way.

2. **`apps/dashboard/lib/module-loader.tsx`** — add
   `import { __MODULE_NAME_PASCAL__Widget } from "@/components/module-widgets/__MODULE_NAME_PASCAL__Widget";`
   with the other widget imports, and add
   `"__MODULE_KEY__": __MODULE_NAME_PASCAL__Widget,` to `WIDGET_REGISTRY`.

3. **`apps/dashboard/lib/module-detail-tabs.tsx`** — add
   `import { ActivityTab as __MODULE_NAME_PASCAL__ActivityTab } from "@/components/module-detail/__MODULE_KEY__/ActivityTab";`
   with the other tab imports, and add a `MODULE_TABS` entry:
   ```tsx
   "__MODULE_KEY__": [
     { key: "overview", label: "Overview", render: () => <OverviewTab moduleKey="__MODULE_KEY__" /> },
     { key: "activity", label: "Activity", render: () => <__MODULE_NAME_PASCAL__ActivityTab /> },
     { key: "settings", label: "Settings", render: () => <ModuleSettingsPanel moduleKey="__MODULE_KEY__" /> },
   ],
   ```

Overview and Settings tabs need no per-module code — `OverviewTab` and
`ModuleSettingsPanel` are generic and read the module's snapshot route and
`settings.schema.json` by convention.

## Step 3 — verify

Run from the repo root. Fix anything that fails before reporting done.

- `cd backend && pnpm exec eslint --fix src/modules/__MODULE_KEY__` and
  `cd apps/dashboard && pnpm exec eslint --fix components/module-widgets/__MODULE_NAME_PASCAL__Widget.tsx components/module-detail/__MODULE_KEY__` —
  first, to normalize prettier formatting (e.g. the `implements` clause wraps or
  not depending on the generated name length). Then re-run without `--fix` to
  confirm clean.
- `cd backend && pnpm exec nest build` — catches contract/type/metadata errors
  (`nest build`, not just `tsc`, is what catches decorator-metadata issues).
- `cd backend && pnpm exec eslint src/modules/__MODULE_KEY__` — boundaries +
  prettier. The module may import from `core` and its own files, nothing else.
- `./check-branding.sh` — no banned client-facing terms in the dashboard.
- `cd backend && pnpm test` (sandbox disabled — specs hit the live Supabase
  pooler). **The new `tenant-isolation.spec.ts` will FAIL until the migration is
  applied** (the table doesn't exist yet) — that is expected. Everything else
  must stay green. To fully verify the isolation test, apply the migration
  (manual step 1 below) first, then re-run.

## Step 4 — report the remaining manual steps

Tell the user exactly these, in order:

1. **Apply the migration.** `backend/shared/db/migrations/__MIGRATION_FILENAME__`
   is not auto-applied — there is no migration runner; migrations are run manually
   against Supabase. Until it runs, the module's snapshot, activity, and
   isolation test all fail because the table is missing.
2. **Replace the stub data model and logic.** The generated service, migration,
   `db/schema.sql`, and `settings.schema.json` model a single placeholder table
   (`id`, `tenant_id`, `created_at`) and one read intent. Flesh out the real
   columns (keep migration and `db/schema.sql` in sync), settings fields, and
   `handleRequest` intents. Never advertise a write intent in
   `getQueryableIntents()`.
3. **Enable the module for a tenant** in `module_manifest` (via the Onboarding
   Console) to see it in that tenant's dashboard and Command Center.

The code wiring (backend import, widget registry, tabs) is done automatically by
Step 2, so no manual code edits remain — only the DB migration and fleshing out
real logic.
