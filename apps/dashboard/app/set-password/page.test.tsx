import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import SetPasswordPage from "./page";

type AuthChangeCallback = (
  event: string,
  session: { user: { id: string } } | null,
) => void;

let authCallback: AuthChangeCallback | null = null;
const getSession = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      updateUser: vi.fn(),
      onAuthStateChange: (cb: AuthChangeCallback) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

const session = { user: { id: "user-1" } };

describe("SetPasswordPage", () => {
  beforeEach(() => {
    authCallback = null;
    getSession.mockReset();
  });

  it("shows invite copy by default when a session exists", async () => {
    getSession.mockResolvedValue({ data: { session } });
    render(<SetPasswordPage />);

    expect(
      await screen.findByRole("heading", { name: /set your password/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /activate account/i }),
    ).toBeInTheDocument();
  });

  it("switches to reset copy on the PASSWORD_RECOVERY event", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    render(<SetPasswordPage />);

    // Let the initial getSession() settle first -- in the real flow the
    // PASSWORD_RECOVERY event always arrives after supabase-js has finished
    // processing the link token.
    await screen.findByRole("heading", { name: /link no longer valid/i });

    await act(async () => {
      authCallback?.("PASSWORD_RECOVERY", session);
    });

    expect(
      await screen.findByRole("heading", { name: /choose a new password/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save password/i }),
    ).toBeInTheDocument();
  });

  it("shows the expired-link state when no session arrives", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    render(<SetPasswordPage />);

    expect(
      await screen.findByRole("heading", { name: /link no longer valid/i }),
    ).toBeInTheDocument();
  });
});
