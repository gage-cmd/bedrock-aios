# Database

This module's tables live in the dedicated `review_generation` Postgres schema (`contacts`, `review_requests`, `review_responses`), created and RLS-protected in [backend/shared/db/migrations](../../../../shared/db/migrations) `0008`-`0011`. Migrations for this module's tables live there, not here, since the migration runner reads from a single shared directory across the whole project (see [docs/phase-1-schema.md](../../../../../docs/phase-1-schema.md) for the convention).

Tenant-isolation RLS test: [../tenant-isolation.spec.ts](../tenant-isolation.spec.ts).
