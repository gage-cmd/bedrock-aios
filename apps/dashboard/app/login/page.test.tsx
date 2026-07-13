import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LoginPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: { auth: { signInWithPassword: vi.fn() } },
}));

describe("LoginPage", () => {
  it("links to the self-service password reset", () => {
    render(<LoginPage />);
    expect(
      screen.getByRole("link", { name: /forgot password\?/i }),
    ).toHaveAttribute("href", "/forgot-password");
  });
});
