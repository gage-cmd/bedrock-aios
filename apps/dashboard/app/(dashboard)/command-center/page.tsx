"use client";

import { FormEvent, useRef, useState } from "react";
import { askCommandCenter } from "@/lib/command-center-client";

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
      <h1 className="text-2xl font-semibold">Command Center</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Ask anything about how your business is performing.
      </p>

      <div className="mt-6 flex flex-1 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="rounded-full border border-black/[.08] px-4 py-2 text-sm text-zinc-600 hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.08]"
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
                ? "self-end rounded-2xl rounded-br-sm bg-zinc-900 px-4 py-2.5 text-sm text-white dark:bg-white dark:text-zinc-900"
                : m.isError
                  ? "self-start rounded-2xl rounded-bl-sm bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                  : "self-start whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-black/[.04] px-4 py-2.5 text-sm text-zinc-800 dark:bg-white/[.08] dark:text-zinc-200"
            }
          >
            {m.text}
          </div>
        ))}

        {busy && (
          <div className="self-start rounded-2xl rounded-bl-sm bg-black/[.04] px-4 py-2.5 text-sm text-zinc-400 dark:bg-white/[.08]">
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
          className="flex-1 rounded-xl border border-black/[.08] bg-transparent px-4 py-3 text-sm outline-none focus:border-zinc-400 dark:border-white/[.145] dark:focus:border-zinc-500"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
