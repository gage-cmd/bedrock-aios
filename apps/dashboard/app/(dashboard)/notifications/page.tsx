"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isError } = useQuery<NotificationRow[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data as NotificationRow[]) ?? [];
    },
  });
  const notifications = data ?? null;
  const error = isError
    ? "We couldn't load your notifications. Please refresh to try again."
    : null;

  async function markAsRead(id: string) {
    setActionError(null);
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", id);
    if (error) {
      setActionError("We couldn't update that notification. Please try again.");
      return;
    }
    queryClient.setQueryData<NotificationRow[]>(["notifications"], (prev) =>
      prev?.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }

  return (
    <div className="flex-1 p-8">
      <PageHeader title="Notifications" />

      {error && (
        <p className="mt-4 text-sm text-[var(--color-status-attention)]">
          {error}
        </p>
      )}

      {actionError && (
        <p className="mt-4 text-sm text-[var(--color-status-attention)]">
          {actionError}
        </p>
      )}

      {!error && notifications === null && (
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      )}

      {!error && notifications?.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="You're all caught up."
            body="Updates about your business -- new reports, feedback that needs a look -- will appear here."
          />
        </div>
      )}

      {notifications && notifications.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-4 rounded-lg border p-4 ${
                n.read
                  ? "border-[var(--color-border)]"
                  : "border-[var(--color-accent-primary)] bg-[var(--color-surface-card)]"
              }`}
            >
              <div>
                <p className="font-medium text-[var(--color-ink)]">
                  {n.title}
                </p>
                {n.body && (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {n.body}
                  </p>
                )}
              </div>
              {!n.read && (
                <button
                  onClick={() => void markAsRead(n.id)}
                  className="whitespace-nowrap rounded-full border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-ink)]"
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
