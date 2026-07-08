-- Phase 2: review_generation.review_responses
-- feedback_text is only populated for low ratings (see review-generation-scope.md)
-- and never routed to Google -- routed_to_google records that decision.
create table review_generation.review_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  request_id uuid not null references review_generation.review_requests(id),
  rating smallint not null check (rating between 1 and 5),
  feedback_text text,
  routed_to_google boolean not null default false,
  submitted_at timestamptz not null default now()
);

alter table review_generation.review_responses enable row level security;

create policy "tenant_isolation" on review_generation.review_responses
  for all
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
