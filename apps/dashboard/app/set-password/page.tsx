"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const inputClasses =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-accent-primary)]";

// Landing page for a Supabase invite link (Onboarding Console Step 6) and for
// password-reset links from /forgot-password. Either email's redirect_to
// points here with an access token in the URL; supabase-js picks it up on load
// (detectSessionInUrl) and establishes a session before this component ever
// checks for one. There is no separate token to read or verify here --
// possession of a valid session IS the authorization, exactly like the review
// funnel's token IS its authorization. The two flows differ only in copy:
// supabase-js announces a reset link with the PASSWORD_RECOVERY auth event.
export default function SetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setHasSession(!!session);
      setReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!active) return;
        if (event === "PASSWORD_RECOVERY") setIsRecovery(true);
        setHasSession(!!session);
        setReady(true);
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.replace("/");
  }

  return (
    <div className="flex flex-1">
      <aside className="hidden w-2/5 max-w-xl flex-col justify-between bg-[var(--color-ink)] p-12 lg:flex">
        <div>
          <p className="font-[family-name:var(--font-display)] text-2xl font-medium text-white">
            Bedrock AI
          </p>
          <div className="mt-3 h-px w-10 bg-[var(--color-accent-gold)]" />
        </div>
        <div>
          <p className="font-[family-name:var(--font-display)] text-3xl font-medium leading-snug text-white">
            One step{" "}
            <span className="italic text-[var(--color-accent-gold)]">
              from live.
            </span>
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Set a password and your dashboard is ready -- every missed call,
            lead, and review, working in the background from day one.
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

        {!ready ? (
          <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
            Checking your link...
          </div>
        ) : !hasSession ? (
          <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-8 text-center">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
              Link no longer valid
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              This link has expired or was already used. Request a new one from
              the sign-in page, or ask your Bedrock AI contact.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-8"
          >
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
                {isRecovery ? "Choose a new password" : "Set your password"}
              </h1>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {isRecovery
                  ? "Pick a new password to get back into your dashboard."
                  : "Choose a password to activate your account."}
              </p>
            </div>

            <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
              Password
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClasses}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
              Confirm password
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClasses}
              />
            </label>

            {error && (
              <p className="text-sm text-[var(--color-status-attention)]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="mt-2 rounded-full bg-[var(--color-accent-primary)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : isRecovery ? "Save password" : "Activate account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
