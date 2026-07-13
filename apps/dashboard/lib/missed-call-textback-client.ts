import { apiFetch } from "@/lib/api";

// missed_call_textback lives in its own Postgres schema, not exposed via
// PostgREST -- every read for this module goes through the backend's
// handleRequest dispatcher instead of a direct supabase.from() call.
export function callMissedCallTextbackAction<T = unknown>(
  intent: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return apiFetch<T>("/modules/missed-call-textback/actions", {
    method: "POST",
    body: { intent, payload },
  });
}
