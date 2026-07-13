// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function accessFor(pathname: string): string | null {
  const response = middleware(
    new NextRequest(`https://dashboard.test${pathname}`),
  );
  return response.headers.get("x-bedrock-route-access");
}

describe("middleware public-route allow-list", () => {
  it.each(["/login", "/set-password", "/forgot-password", "/review/some-token"])(
    "classifies %s as public",
    (path) => {
      expect(accessFor(path)).toBe("public");
    },
  );

  it.each([
    "/",
    "/command-center",
    "/admin/onboarding",
    "/client-settings",
    "/forgot-password/extra",
    "/review/a/b",
  ])("classifies %s as gated", (path) => {
    expect(accessFor(path)).toBe("gated");
  });
});
