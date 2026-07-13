"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const inputClasses =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-accent-primary)]";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.replace("/");
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
            Your business,{" "}
            <span className="italic text-[var(--color-accent-gold)]">
              running in the background.
            </span>
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Every missed call answered, every lead followed up, every review
            requested. Sign in to see what your systems recovered today.
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

        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-8"
        >
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Sign in to your command center.
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

          <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            disabled={loading}
            className="mt-2 rounded-full bg-[var(--color-accent-primary)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>

          <Link
            href="/forgot-password"
            className="text-center text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-ink)] hover:underline"
          >
            Forgot password?
          </Link>
        </form>

        <p className="mt-6 text-xs text-[var(--color-text-secondary)]">
          Access is provisioned by your Bedrock AI team.
        </p>
      </div>
    </div>
  );
}
