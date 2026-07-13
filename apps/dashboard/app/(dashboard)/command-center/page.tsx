"use client";

import { FormEvent, useRef, useState } from "react";
import { askCommandCenter } from "@/lib/command-center-client";
import { PageHeader } from "@/components/ui/PageHeader";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  isError?: boolean;
}

const SUGGESTIONS = [
  "How is my business doing this week?",
  "How many missed calls did we recover this week?",
  "What's our average review rating?",
];

export default function CommandCenterPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setQuestion("");
    setBusy(true);
    try {
      const answer = await askCommandCenter(trimmed);
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            err instanceof Error
              ? err.message
              : "Something went wrong. Please try again.",
          isError: true,
        },
      ]);
    } finally {
      setBusy(false);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(question);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-8">
      <PageHeader
        title="Command Center"
        subtitle="Ask anything about how your business is performing."
      />

      <div className="mt-6 flex flex-1 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-card)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-accent-primary)] hover:text-[var(--color-accent-primary)]"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "self-end rounded-2xl rounded-br-sm bg-[var(--color-accent-primary)] px-4 py-2.5 text-sm text-white"
                : m.isError
                  ? "self-start rounded-2xl rounded-bl-sm border border-[var(--color-status-attention)]/30 bg-[var(--color-surface-card)] px-4 py-2.5 text-sm text-[var(--color-status-attention)]"
                  : "self-start whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-surface-card)] px-4 py-2.5 text-sm text-[var(--color-ink)]"
            }
          >
            {m.text}
          </div>
        ))}

        {busy && (
          <div className="self-start rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-surface-card)] px-4 py-2.5 text-sm text-[var(--color-text-secondary)]">
            Checking your numbers…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSubmit} className="mt-6 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about your reviews, missed calls, or this week's results"
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] px-4 py-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent-primary)]"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-xl bg-[var(--color-accent-primary)] px-5 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
