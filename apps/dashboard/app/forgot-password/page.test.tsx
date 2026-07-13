import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ForgotPasswordPage from "./page";

const resetPasswordForEmail = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      get resetPasswordForEmail() {
        return resetPasswordForEmail;
      },
    },
  },
}));

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset();
  });

  it("renders the email form", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send reset link/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("requests a reset for the entered email, redirecting back to /set-password", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/email/i), "client@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() =>
      expect(resetPasswordForEmail).toHaveBeenCalledWith("client@example.com", {
        redirectTo: `${window.location.origin}/set-password`,
      }),
    );
  });

  it("shows the generic confirmation on success", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/email/i), "client@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(
      screen.getByText(/if an account exists for that address/i),
    ).toBeInTheDocument();
  });

  it("shows the same generic confirmation when the provider reports an error", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: "User not found" },
    });
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/email/i), "unknown@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.queryByText(/user not found/i)).not.toBeInTheDocument();
  });

  it("shows the same generic confirmation even when the call throws", async () => {
    resetPasswordForEmail.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/email/i), "client@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.queryByText(/network down/i)).not.toBeInTheDocument();
  });
});
