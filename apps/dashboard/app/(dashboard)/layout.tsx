"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { SystemStatusStrip } from "@/components/SystemStatusStrip";

// Fixed set, deliberately never one link per module -- module sub-pages
// (settings, activity, contacts) live inside each module's own detail page
// at /installed-systems/[moduleKey], reached by clicking its card there.
const NAV_LINKS = [
  { href: "/", label: "Business Snapshot" },
  { href: "/command-center", label: "Command Center" },
  { href: "/installed-systems", label: "Installed Systems" },
  { href: "/business-reports", label: "Business Reports" },
  { href: "/notifications", label: "Notifications" },
  { href: "/client-settings", label: "Client Settings" },
];

// Authentication for this route group is enforced server-side: middleware.ts
// redirects sessionless requests to /login before anything renders, so the
// first paint here is always real content (no client-side check, no blank
// flash). The listener below only covers the session DISAPPEARING while the
// app is open -- sign-out in another tab, or expiry.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event !== "INITIAL_SESSION" && !session) {
          router.replace("/login");
        }
      },
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [router]);

  return (
    <div className="flex flex-1">
      <nav className="flex w-60 flex-col gap-1 bg-[var(--color-ink)] p-5">
        <div className="mb-6 px-3">
          <p className="font-[family-name:var(--font-display)] text-lg font-medium text-white">
            Bedrock AI
          </p>
        </div>
        {NAV_LINKS.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                active
                  ? "rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white"
                  : "rounded-md px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-white"
              }
            >
              {link.label}
            </Link>
          );
        })}
        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-4 rounded-md px-3 py-2 text-left text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-white"
        >
          Sign out
        </button>
      </nav>
      <main className="flex flex-1 flex-col bg-[var(--color-surface)]">
        <SystemStatusStrip />
        <div className="flex flex-1">{children}</div>
      </main>
    </div>
  );
}
