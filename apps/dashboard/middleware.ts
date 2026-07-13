import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Explicit public-route allow-list.
//
// Routes matched here are intentionally reachable WITHOUT authentication.
// Everything else in the app is gated -- today that gating is enforced
// client-side in app/(dashboard)/layout.tsx, because the app uses Supabase's
// localStorage-based sessions, which a server middleware cannot read. So this
// middleware's job is NOT to authenticate; it is to keep the set of
// deliberately-public routes explicit and auditable, rather than letting a
// route be public merely because it happens to live outside the (dashboard)
// route group. When server-side (cookie) sessions are added later, this is the
// single place to deny everything that is not on this allow-list.
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const response = NextResponse.next();
  // Surface the classification so the public/gated boundary is explicit
  // end-to-end (and greppable in logs), without changing auth behavior yet.
  response.headers.set(
    "x-bedrock-route-access",
    isPublicRoute(pathname) ? "public" : "gated",
  );
  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
