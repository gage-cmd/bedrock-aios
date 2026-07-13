import { apiFetch } from "@/lib/api";

// review_generation lives in its own Postgres schema, not exposed via
// PostgREST -- every read/write for this module goes through the backend's
// handleRequest dispatcher instead of a direct supabase.from() call.
export function callReviewGenerationAction<T = unknown>(
  intent: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return apiFetch<T>("/modules/review-generation/actions", {
    method: "POST",
    body: { intent, payload },
  });
}
