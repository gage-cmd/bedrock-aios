import { createClient } from "@supabase/supabase-js";

// Public-safe: URL + anon key only. The anon key relies entirely on Postgres
// RLS to scope what it can see -- never put the service role key here.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
