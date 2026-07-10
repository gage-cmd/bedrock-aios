-- Workstream 3: close the direct-write door on module_manifest.
--
-- The tenant_isolation RLS policy on module_manifest keys only on tenant_id --
-- it is role-blind, so it lets ANY authenticated member of a tenant (owner,
-- staff, read_only) write that tenant's module config directly via the Supabase
-- client. The dashboard's settings forms used to do exactly that, and the
-- owner-only restriction was UI-only (a disabled input), enforced nowhere the
-- request actually passed through.
--
-- All module-config writes now go through the backend's owner-guarded,
-- schema-validating endpoint (PUT /module-manifest/:moduleKey/config), which
-- runs on the RLS/grant-exempt `postgres` pooler role. So the client-facing
-- roles need no direct write privilege at all: revoke insert/update/delete
-- (and truncate) on module_manifest from `authenticated` and `anon`, leaving
-- SELECT intact (the dashboard still reads the manifest directly, filtered by
-- RLS). `postgres` and `service_role` are untouched -- the backend keeps full
-- access.
--
-- This does NOT weaken tenant_isolation or any other policy; it only removes a
-- grant that RLS alone was never sufficient to gate on role. REVOKE is
-- idempotent, so this migration is safe to reapply.

revoke insert, update, delete, truncate on table public.module_manifest
  from authenticated;

revoke insert, update, delete, truncate on table public.module_manifest
  from anon;
