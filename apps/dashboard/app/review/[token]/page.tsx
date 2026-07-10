"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;

interface StateResponse {
  valid: boolean;
}

interface SubmitResponse {
  ok: boolean;
  routedToGoogle?: boolean;
  googleReviewUrl?: string;
}

// loading  -> checking the token
// invalid  -> generic "no longer valid" (unknown / used / expired, indistinct)
// rating   -> the 1-5 star selector
// feedback -> private feedback form (only reached for 1-3 stars)
// done     -> thank-you (low rating submitted, or high rating with no URL set)
type Phase = "loading" | "invalid" | "rating" | "feedback" | "done";

export default function ReviewFunnelPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [phase, setPhase] = useState<Phase>("loading");
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const res = await fetch(
          `${BACKEND}/public/review/${encodeURIComponent(token)}`,
        );
        const data = (await res.json()) as StateResponse;
        if (!active) return;
        setPhase(res.ok && data.valid ? "rating" : "invalid");
      } catch {
        if (active) setPhase("invalid");
      }
    }

    void check();
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(finalRating: number, finalFeedback?: string) {
    setSubmitting(true);
    try {
      const res = await fetch(
        `${BACKEND}/public/review/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating: finalRating,
            feedback: finalFeedback,
          }),
        },
      );
      const data = (await res.json()) as SubmitResponse;

      if (!res.ok || !data.ok) {
        setPhase("invalid");
        return;
      }

      if (data.routedToGoogle && data.googleReviewUrl) {
        window.location.assign(data.googleReviewUrl);
        return;
      }

      setPhase("done");
    } catch {
      setPhase("invalid");
    } finally {
      setSubmitting(false);
    }
  }

  function handleStar(value: number) {
    setRating(value);
    if (value >= 4) {
      // Happy customer -> straight to the public Google review.
      void submit(value);
    } else {
      // Unhappy customer -> capture feedback privately, never sent to Google.
      setPhase("feedback");
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--color-surface)] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-8 text-center">
        {phase === "loading" && (
          <p className="text-[var(--color-text-secondary)]">Loading...</p>
        )}

        {phase === "invalid" && (
          <>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
              This link is no longer valid
            </h1>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              It may have already been used or expired. If you think this is a
              mistake, please reach out to the business directly.
            </p>
          </>
        )}

        {phase === "rating" && (
          <>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
              How was your experience?
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Tap a star to let us know.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value} star${value === 1 ? "" : "s"}`}
                  disabled={submitting}
                  onClick={() => handleStar(value)}
                  className="text-4xl leading-none text-[var(--color-accent-gold)] transition-transform hover:scale-110 disabled:opacity-50"
                >
                  {value <= rating ? "★" : "☆"}
                </button>
              ))}
            </div>
          </>
        )}

        {phase === "feedback" && (
          <>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
              We&rsquo;re sorry we fell short
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Tell us what happened so we can make it right. This goes straight
              to the owner and stays private.
            </p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              placeholder="What could we have done better?"
              className="mt-4 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-left text-[var(--color-ink)] outline-none focus:border-[var(--color-accent-primary)]"
            />
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(rating, feedback)}
              className="mt-4 w-full rounded-full bg-[var(--color-accent-primary)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Sending..." : "Send feedback"}
            </button>
          </>
        )}

        {phase === "done" && (
          <>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium text-[var(--color-ink)]">
              Thank you
            </h1>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              We appreciate you taking the time to share your feedback.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
