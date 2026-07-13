import { createBrowserClient } from "@supabase/ssr";

// Public-safe: URL + anon key only. The anon key relies entirely on Postgres
// RLS to scope what it can see -- never put the service role key here.
//
// createBrowserClient (vs plain createClient) stores the session in cookies
// instead of localStorage, which is what lets middleware.ts read it
// server-side and gate routes before first paint. Same client surface
// otherwise: detectSessionInUrl still establishes the session from
// invite/reset links on /set-password, and every existing auth call works
// unchanged.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
