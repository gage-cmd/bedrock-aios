"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false });

      if (active) setNotifications((data as NotificationRow[]) ?? []);
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  async function markAsRead(id: string) {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifications(
      (prev) =>
        prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? null,
    );
  }

  return (
    <div className="flex-1 p-8">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium text-[var(--color-ink)] dark:text-zinc-50">
        Notifications
      </h1>

      {notifications === null && (
        <p className="mt-4 text-[var(--color-text-secondary)] dark:text-zinc-400">
          Loading...
        </p>
      )}

      {notifications?.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] p-12 text-center text-[var(--color-text-secondary)]">
          No notifications.
        </div>
      )}

      {notifications && notifications.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-4 rounded-lg border p-4 ${
                n.read
                  ? "border-[var(--color-border)] dark:border-white/[.145]"
                  : "border-[var(--color-accent-primary)] bg-[var(--color-surface-card)] dark:border-white/[.3] dark:bg-zinc-900"
              }`}
            >
              <div>
                <p className="font-medium text-[var(--color-ink)] dark:text-zinc-50">
                  {n.title}
                </p>
                {n.body && (
                  <p className="text-sm text-[var(--color-text-secondary)] dark:text-zinc-400">
                    {n.body}
                  </p>
                )}
              </div>
              {!n.read && (
                <button
                  onClick={() => void markAsRead(n.id)}
                  className="whitespace-nowrap rounded-full border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-ink)] dark:border-white/[.145] dark:text-zinc-50"
                >
                  Mark as read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
