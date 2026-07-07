-- Phase 1: users
-- id is the Supabase Auth user id (auth.users.id), not a freshly generated uuid.
create table users (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  email text not null,
  role text not null default 'staff' check (role in ('owner', 'staff', 'read_only')),
  created_at timestamptz not null default now()
);

alter table users enable row level security;

create policy "tenant_isolation" on users
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
