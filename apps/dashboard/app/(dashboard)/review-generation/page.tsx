"use client";

import { useEffect, useRef, useState } from "react";
import { callReviewGenerationAction } from "@/lib/review-generation-client";

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
}

export default function ReviewContactsPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  async function loadContacts() {
    const data = await callReviewGenerationAction<Contact[]>("list-contacts");
    setContacts(data);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await callReviewGenerationAction<Contact[]>("list-contacts");
        if (active) setContacts(data);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not load contacts.");
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    if (!nameRef.current?.value) return;

    setAdding(true);
    setError(null);
    try {
      await callReviewGenerationAction("create-contact", {
        name: nameRef.current.value,
        phone: phoneRef.current?.value || undefined,
        email: emailRef.current?.value || undefined,
      });
      if (nameRef.current) nameRef.current.value = "";
      if (phoneRef.current) phoneRef.current.value = "";
      if (emailRef.current) emailRef.current.value = "";
      await loadContacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add contact.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRequestReview(contactId: string) {
    setSendingId(contactId);
    setError(null);
    try {
      await callReviewGenerationAction("send-review-request", { contactId });
      setSentIds((prev) => new Set(prev).add(contactId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send review request.");
    } finally {
      setSendingId(null);
    }
  }

  const inputClasses =
    "rounded-md border border-black/[.08] px-3 py-2 text-black dark:border-white/[.145] dark:bg-black dark:text-zinc-50";

  return (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Contacts</h1>

      <form
        onSubmit={handleAddContact}
        className="mt-6 flex max-w-lg flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Name
          <input ref={nameRef} required className={inputClasses} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Phone
          <input ref={phoneRef} placeholder="+15551234567" className={inputClasses} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Email
          <input ref={emailRef} type="email" className={inputClasses} />
        </label>
        <button
          type="submit"
          disabled={adding}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {adding ? "Adding..." : "Add contact"}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {contacts === null && !error && (
        <p className="mt-8 text-zinc-500 dark:text-zinc-400">Loading...</p>
      )}

      {contacts?.length === 0 && (
        <p className="mt-8 text-zinc-500 dark:text-zinc-400">No contacts yet.</p>
      )}

      {contacts && contacts.length > 0 && (
        <ul className="mt-8 flex flex-col gap-2">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]"
            >
              <div>
                <p className="font-medium text-black dark:text-zinc-50">{c.name}</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {c.phone ?? "No phone"}
                  {c.email ? ` · ${c.email}` : ""}
                </p>
              </div>
              <button
                onClick={() => void handleRequestReview(c.id)}
                disabled={sendingId === c.id || !c.phone}
                title={!c.phone ? "Contact has no phone number" : undefined}
                className="whitespace-nowrap rounded-full border border-black/[.08] px-3 py-1 text-sm text-black disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50"
              >
                {sendingId === c.id
                  ? "Sending..."
                  : sentIds.has(c.id)
                    ? "Sent"
                    : "Request a review"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
