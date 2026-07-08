-- Phase 2: review_generation.review_requests
-- token is a securely random string (pgcrypto's gen_random_bytes, not a
-- sequential id) so a review link can't be guessed or enumerated.
create table review_generation.review_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  contact_id uuid not null references review_generation.contacts(id),
  channel text not null check (channel in ('sms', 'email')),
  sent_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent', 'clicked', 'completed', 'expired')),
  token text not null unique default encode(gen_random_bytes(32), 'hex')
);

alter table review_generation.review_requests enable row level security;

create policy "tenant_isolation" on review_generation.review_requests
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
