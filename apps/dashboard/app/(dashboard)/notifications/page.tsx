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
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Notifications
      </h1>

      {notifications === null && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">Loading...</p>
      )}

      {notifications?.length === 0 && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          No notifications.
        </p>
      )}

      {notifications && notifications.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-4 rounded-lg border p-4 ${
                n.read
                  ? "border-black/[.08] dark:border-white/[.145]"
                  : "border-black/[.2] bg-zinc-50 dark:border-white/[.3] dark:bg-zinc-900"
              }`}
            >
              <div>
                <p className="font-medium text-black dark:text-zinc-50">
                  {n.title}
                </p>
                {n.body && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {n.body}
                  </p>
                )}
              </div>
              {!n.read && (
                <button
                  onClick={() => void markAsRead(n.id)}
                  className="whitespace-nowrap rounded-full border border-black/[.08] px-3 py-1 text-sm text-black dark:border-white/[.145] dark:text-zinc-50"
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
