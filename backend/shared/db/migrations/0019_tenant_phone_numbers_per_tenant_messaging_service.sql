-- Stage 2a: per-tenant messaging service on shared_messaging.tenant_phone_numbers
--
-- Why: we run as an ISV (independent software vendor), not a single sender.
-- Each client registers their OWN Brand + Campaign + Messaging Service with the
-- carriers and sends through it -- their 10DLC registration, their throughput,
-- their sender reputation. There is no shared, account-wide Messaging Service
-- that every tenant's SMS goes through. So the Messaging Service a number is
-- attached to is a per-number (per-tenant) fact, stored here, not an
-- account-wide env var.
--
-- messaging_service_sid: the provider-side Messaging Service this number was
-- registered into at purchase time (Twilio: an "MG..." SID). Nullable: numbers
-- that predate this column, or that a future provider attaches differently,
-- may not have one.
--
-- provider: which messaging provider owns this number. Defaults to 'twilio'
-- (the only provider today, and the one every existing row was bought through).
-- Forward-looking on purpose: a future second provider is added by writing a
-- different value here and reading the same column -- no further migration to
-- the table shape is needed for that.
alter table shared_messaging.tenant_phone_numbers
  add column messaging_service_sid text,
  add column provider text not null default 'twilio';
