-- Phase 5: custom_access_token_hook
--
-- NOTE ON NUMBERING: this was requested as "0016" but 0016 is already taken by
-- the platform_admins/users exclusion triggers, so it lands as 0017.
--
-- Captures, verbatim, the access-token hook that was applied out-of-band to the
-- live Supabase project during Phase 1. Until now this function existed only in
-- the running project and in no migration, even though the entire tenant-token
-- contract depends on it: it is what stamps `tenant_id` and `app_role` into
-- every tenant user's JWT. Without it, `auth.jwt() ->> 'tenant_id'` is null,
-- every tenant_isolation RLS policy blocks all rows (fail-closed), and
-- TenantResolverMiddleware rejects tenant requests for a missing app_role.
--
-- It also underpins the platform-admin boundary from the other direction: an
-- auth user with NO users row gets NO tenant_id claim, which is exactly the
-- "bare" token AdminGuard expects (and now requires -- see migration 0016 and
-- AdminGuard's tenant_id rejection).
--
-- IDEMPOTENT / safe to reapply: CREATE OR REPLACE FUNCTION replaces the body in
-- place, and every GRANT/REVOKE below is a no-op when already in the target
-- state. Reapplying changes nothing.
--
-- IMPORTANT -- this migration does NOT register the hook. Creating the function
-- and granting execute is only half the wiring: Supabase Auth (GoTrue) must be
-- told to CALL this function on token issuance, which is a project/Auth-config
-- setting, not a SQL object, and therefore cannot live in a migration. That
-- registration remains a manual step. See docs/auth-access-token-hook.md.

create or replace function public.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $$
declare
  claims jsonb;
  user_tenant_id uuid;
  user_role text;
begin
  select tenant_id, role into user_tenant_id, user_role
  from public.users
  where id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if user_tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_tenant_id::text));
  end if;

  if user_role is not null then
    claims := jsonb_set(claims, '{app_role}', to_jsonb(user_role));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- GoTrue invokes access-token hooks as the supabase_auth_admin role, so that
-- role must be able to reach the schema and execute the function. This mirrors
-- the live grant posture: only postgres / service_role / supabase_auth_admin
-- hold EXECUTE -- PUBLIC, anon, and authenticated deliberately do not, so a
-- logged-in user cannot invoke the hook directly.
grant usage on schema public to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb)
  from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb)
  to postgres, service_role;
