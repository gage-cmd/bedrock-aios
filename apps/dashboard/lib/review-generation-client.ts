import { supabase } from "@/lib/supabase/client";

// review_generation lives in its own Postgres schema, not exposed via
// PostgREST -- every read/write for this module goes through the backend's
// handleRequest dispatcher instead of a direct supabase.from() call.
export async function callReviewGenerationAction<T = unknown>(
  intent: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not signed in");
  }

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL}/modules/review-generation/actions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ intent, payload }),
    },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }

  return res.json() as Promise<T>;
}
