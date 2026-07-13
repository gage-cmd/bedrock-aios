import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Explicit public-route allow-list.
//
// Routes matched here are intentionally reachable WITHOUT authentication.
// Everything else is denied by default: no session on a gated route
// redirects to /login at the edge, so the first paint of a gated page is
// real content, never a blank client-side auth check. Sessions live in
// cookies (createBrowserClient in lib/supabase/client.ts), which is what
// makes them readable here.
//
// The public review funnel (/review/[token], Step 6) is the one page in the
// entire app that must NEVER require a login: a business's customers open it
// from an SMS link. It is on this list on purpose. Access to any tenant data
// behind it is authorized solely by the unguessable token, enforced by the
// backend's PublicReviewService -- not by anything in the browser.
const PUBLIC_ROUTE_PATTERNS: RegExp[] = [
  /^\/review\/[^/]+$/, // customer-facing review funnel
  /^\/login$/,
  /^\/set-password$/, // invite/reset-link landing page; authorized by the link's token, not a session
  /^\/forgot-password$/, // self-service reset request; must be reachable logged-out by definition
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const access = isPublicRoute(pathname) ? "public" : "gated";

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Standard @supabase/ssr plumbing: mirror refreshed auth cookies
          // onto both the forwarded request and the outgoing response.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Also refreshes an expiring session as a side effect -- do not remove
  // even if the redirect below ever changes.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && access === "gated") {
    const loginUrl = new URL("/login", request.url);
    const redirect = NextResponse.redirect(loginUrl);
    // Carry any refreshed cookies (e.g. a cleared stale session) along.
    response.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie);
    });
    redirect.headers.set("x-bedrock-route-access", access);
    return redirect;
  }

  // Surface the classification so the public/gated boundary stays explicit
  // end-to-end (and greppable in logs).
  response.headers.set("x-bedrock-route-access", access);
  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
