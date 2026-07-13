"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// One QueryClient for the whole app. The 60s staleTime is what deduplicates
// the module list and status reads that several components (status strip,
// pages, widgets) request on every navigation -- these are weekly-scale
// metrics, so a minute of staleness is invisible while repeat fetches are
// not. Window-focus refetching stays off for the same reason: the dashboard
// should feel calm, not flicker on every alt-tab.
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
