// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The middleware talks to Supabase only through createServerClient; mocking
// it lets each test choose whether a session user exists without any
// network or cookie plumbing.
let currentUser: { id: string } | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: currentUser } }),
    },
  }),
}));

import { middleware } from "./middleware";

function requestFor(pathname: string): NextRequest {
  return new NextRequest(`https://dashboard.test${pathname}`);
}

const PUBLIC_PATHS = [
  "/login",
  "/set-password",
  "/forgot-password",
  "/review/some-token",
];
const GATED_PATHS = [
  "/",
  "/command-center",
  "/admin/onboarding",
  "/client-settings",
  "/forgot-password/extra",
  "/review/a/b",
];

describe("middleware route classification", () => {
  beforeEach(() => {
    currentUser = { id: "user-1" };
  });

  it.each(PUBLIC_PATHS)("classifies %s as public", async (path) => {
    const response = await middleware(requestFor(path));
    expect(response.headers.get("x-bedrock-route-access")).toBe("public");
  });

  it.each(GATED_PATHS)("classifies %s as gated", async (path) => {
    const response = await middleware(requestFor(path));
    expect(response.headers.get("x-bedrock-route-access")).toBe("gated");
  });
});

describe("middleware session gate", () => {
  it.each(GATED_PATHS)(
    "redirects a sessionless request for %s to /login",
    async (path) => {
      currentUser = null;
      const response = await middleware(requestFor(path));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://dashboard.test/login",
      );
    },
  );

  it.each(PUBLIC_PATHS)(
    "lets a sessionless request through to %s",
    async (path) => {
      currentUser = null;
      const response = await middleware(requestFor(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it.each(GATED_PATHS)(
    "lets an authenticated request through to %s",
    async (path) => {
      currentUser = { id: "user-1" };
      const response = await middleware(requestFor(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    },
  );
});
