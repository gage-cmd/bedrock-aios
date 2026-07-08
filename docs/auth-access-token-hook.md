# Access-Token Hook (`custom_access_token_hook`)

The tenant-token contract for the whole platform rests on one Postgres function,
`public.custom_access_token_hook`. On every token issuance, Supabase Auth
(GoTrue) calls it with the pending JWT; the function looks the user up in
`public.users` and, if they have a tenant membership, stamps `tenant_id` and
`app_role` into the token's claims. Those claims are what every `tenant_isolation`
RLS policy reads via `auth.jwt()`, and what `TenantResolverMiddleware` requires.

A user with **no** `users` row gets **no** `tenant_id` claim — the "bare" token a
platform admin carries, which `AdminGuard` requires (it rejects any token that
carries a `tenant_id`).

## What is captured in code vs. what is manual

There are two independent pieces of wiring. Only the first can live in a
migration.

### 1. The function + its grants — CAPTURED IN SQL

`backend/shared/db/migrations/0017_custom_access_token_hook.sql` contains the
exact function body (verbatim from the live project) plus the grants GoTrue
needs to call it: `EXECUTE` for `supabase_auth_admin` (the role GoTrue runs
hooks as), `postgres`, and `service_role`, with `PUBLIC`/`anon`/`authenticated`
deliberately excluded. The migration is idempotent (`CREATE OR REPLACE` +
idempotent `GRANT`/`REVOKE`) and safe to reapply — verified by applying it twice
and confirming the function definition and ACL are byte-for-byte unchanged.

### 2. Registering the function as the access-token hook — MANUAL, NOT in SQL

Creating the function does **not** cause GoTrue to call it. GoTrue must be
*told* to invoke this specific function on token issuance, and that setting
lives in Supabase's Auth configuration, not in the SQL schema — so it **cannot**
be expressed in a migration and remains a manual step after applying 0017.

- **Supabase Cloud:** Dashboard → Authentication → Hooks → "Customize Access
  Token (JWT) Claims" → enable and select `custom_access_token_hook`.
- **Self-hosted / CLI (`supabase/config.toml`):**

  ```toml
  [auth.hook.custom_access_token]
  enabled = true
  uri = "pg-functions://postgres/public/custom_access_token_hook"
  ```

  (equivalently the GoTrue env vars
  `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true` and
  `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/custom_access_token_hook`).

### If step 2 is skipped

The function exists but never runs. No token gets a `tenant_id`/`app_role`
claim, so **every** tenant `tenant_isolation` policy blocks all rows
(fail-closed) and `TenantResolverMiddleware` rejects tenant requests with 401.
The tenant-facing app is effectively down until the hook is registered. This is
the single most important post-migration manual step for a fresh environment.

## Provisioning summary for a fresh environment

1. Run migrations through `0017` (creates the function + grants).
2. Register the hook in Auth settings (step 2 above) — **manual**.
3. Verify: sign in as a user who has a `users` row and confirm their JWT
   carries `tenant_id` and `app_role`.
