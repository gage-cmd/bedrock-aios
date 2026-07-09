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

const inputClasses =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-[var(--color-ink)]";

export function ContactsTab() {
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

  return (
    <div>
      <form
        onSubmit={handleAddContact}
        className="flex max-w-lg flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
          Name
          <input ref={nameRef} required className={inputClasses} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
          Phone
          <input ref={phoneRef} placeholder="+15551234567" className={inputClasses} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
          Email
          <input ref={emailRef} type="email" className={inputClasses} />
        </label>
        <button
          type="submit"
          disabled={adding}
          className="rounded-full bg-[var(--color-accent-primary)] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {adding ? "Adding..." : "Add contact"}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-[var(--color-status-attention)]">{error}</p>}

      {contacts === null && !error && (
        <p className="mt-8 text-[var(--color-text-secondary)]">Loading...</p>
      )}

      {contacts?.length === 0 && (
        <p className="mt-8 text-[var(--color-text-secondary)]">No contacts yet.</p>
      )}

      {contacts && contacts.length > 0 && (
        <ul className="mt-8 flex flex-col gap-2">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] p-4"
            >
              <div>
                <p className="font-medium text-[var(--color-ink)]">{c.name}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {c.phone ?? "No phone"}
                  {c.email ? ` · ${c.email}` : ""}
                </p>
              </div>
              <button
                onClick={() => void handleRequestReview(c.id)}
                disabled={sendingId === c.id || !c.phone}
                title={!c.phone ? "Contact has no phone number" : undefined}
                className="whitespace-nowrap rounded-full border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-ink)] disabled:opacity-50"
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
