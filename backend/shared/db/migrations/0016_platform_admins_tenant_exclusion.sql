-- Phase 5: enforce that platform_admins and users are mutually exclusive.
--
-- A platform admin belongs to no tenant (migration 0015). Until now that was a
-- provisioning convention: nothing stopped one auth user from having BOTH a
-- users row (which the custom_access_token_hook turns into a tenant_id claim)
-- AND a platform_admins row. This makes the invariant a hard database rule,
-- enforced in BOTH directions so it cannot be sidestepped by inserting into
-- either table first.
--
-- A CHECK constraint cannot query another table, so this is done with BEFORE
-- INSERT/UPDATE triggers. Both functions are SECURITY DEFINER with an empty
-- search_path (every reference fully schema-qualified) so the existence check
-- reads the other table with RLS bypassed and cannot be fooled by a caller
-- whose session would otherwise hide the conflicting row.

-- Reject an admin row for a user who is already a tenant user.
create or replace function public.platform_admins_reject_tenant_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from public.users u where u.id = new.user_id) then
    raise exception
      'user % is a tenant user (has a users row) and cannot also be a platform admin',
      new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Reject a tenant-user row for someone who is already a platform admin.
create or replace function public.users_reject_platform_admin()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from public.platform_admins pa where pa.user_id = new.id) then
    raise exception
      'user % is a platform admin and cannot also be a tenant user',
      new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger platform_admins_no_tenant_user
  before insert or update on public.platform_admins
  for each row execute function public.platform_admins_reject_tenant_user();

create trigger users_no_platform_admin
  before insert or update on public.users
  for each row execute function public.users_reject_platform_admin();
