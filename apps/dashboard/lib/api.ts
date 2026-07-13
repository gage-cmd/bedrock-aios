import { supabase } from "@/lib/supabase/client";

// The one transport for every authenticated backend call. Centralizes the
// session lookup, bearer header, JSON encoding, and error normalization that
// were previously hand-copied at each call site. Public, unauthenticated
// surfaces (the /review/[token] funnel) do NOT use this -- they are
// authorized by their link token, not a session, and keep their own fetch.
export class ApiError extends Error {
  constructor(
    message: string,
    // HTTP status of the failed response; 0 means the request was never sent
    // because there is no signed-in session.
    readonly status: number,
    // Backend error code (e.g. onboarding's 'duplicate_name') when provided.
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// True for the "signed out mid-load" failure, which components typically
// ignore: the dashboard layout is already redirecting to /login.
export function isSignedOutError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

export async function apiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new ApiError("Not signed in", 0);
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
      code?: string;
    } | null;
    throw new ApiError(
      body?.message ?? `Request failed (${res.status})`,
      res.status,
      body?.code,
    );
  }

  return (await res.json()) as T;
}
