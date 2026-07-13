"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

const inputClasses =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-accent-primary)]";

// Self-service password reset. Submitting always lands on the same generic
// confirmation -- whether or not the address belongs to an account -- so this
// page can never be used to probe which emails are registered. The reset email
// links back to /set-password, the same page the invite flow uses: the link
// establishes a session on load and possession of that session is the
// authorization to choose a new password.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);

    // Errors are deliberately not surfaced: a distinct failure message for an
    // unknown address (or any provider-side condition) would leak whether the
    // account exists. Supabase already returns success for unknown emails;
    // the catch keeps the response uniform even if the call itself throws.
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/set-password`,
      });
    } catch {
      // Swallowed on purpose -- see above.
    }

    setSending(false);
    setSubmitted(true);
  }

  return (
    <div className="flex flex-1">
      <aside className="hidden w-2/5 max-w-xl flex-col justify-between bg-[var(--color-surface-ink)] p-12 lg:flex">
        <div>
          <p className="font-[family-name:var(--font-display)] text-2xl font-medium text-white">
            Bedrock AI
          </p>
          <div className="mt-3 h-px w-10 bg-[var(--color-accent-gold)]" />
        </div>
        <div>
          <p className="font-[family-name:var(--font-display)] text-3xl font-medium leading-snug text-white">
            Locked out,{" "}
            <span className="italic text-[var(--color-accent-gold)]">
              not locked down.
            </span>
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Your dashboard keeps working in the background while you get back
            in. A reset link is one click away.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="status-dot-good inline-block h-2 w-2 rounded-full bg-[var(--color-status-good)]" />
          <p className="font-metric text-xs text-[var(--color-ink-muted)]">
            All systems operational
          </p>
        </div>
      </aside>

      <div className="flex flex-1 flex-col items-center justify-center bg-[var(--color-surface)] p-6">
        <div className="mb-8 text-center lg:hidden">
          <p className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
            Bedrock AI
          </p>
          <div className="mx-auto mt-3 h-px w-10 bg-[var(--color-accent-gold)]" />
        </div>

        {submitted ? (
          <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-8 text-center">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
              Check your email
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              If an account exists for that address, a password reset link is
              on its way. The link expires after a short time, so use it soon.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block text-sm text-[var(--color-accent-primary)] hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-8"
          >
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
                Reset your password
              </h1>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                Enter your email and we&apos;ll send you a reset link.
              </p>
            </div>

            <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClasses}
              />
            </label>

            <button
              type="submit"
              disabled={sending}
              className="mt-2 rounded-full bg-[var(--color-accent-primary)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send reset link"}
            </button>

            <Link
              href="/login"
              className="text-center text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-ink)] hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
