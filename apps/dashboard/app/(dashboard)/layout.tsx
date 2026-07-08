"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const NAV_LINKS = [
  { href: "/", label: "Business Snapshot" },
  { href: "/command-center", label: "Command Center" },
  { href: "/installed-systems", label: "Installed Systems" },
  { href: "/notifications", label: "Notifications" },
  { href: "/client-settings", label: "Client Settings" },
  { href: "/review-generation", label: "Review Contacts" },
  { href: "/review-generation/activity", label: "Review Activity" },
  { href: "/review-generation/settings", label: "Review Settings" },
  { href: "/missed-call-textback/activity", label: "Missed-Call Activity" },
  { href: "/missed-call-textback/settings", label: "Missed-Call Settings" },
];

// Guards every route in this group: redirects to /login if there's no
// active Supabase session, and again if the session disappears later
// (e.g. sign-out in another tab).
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session) {
        router.replace("/login");
        return;
      }
      setChecked(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          router.replace("/login");
        }
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  if (!checked) {
    return null;
  }

  return (
    <div className="flex flex-1">
      <nav className="flex w-56 flex-col gap-1 border-r border-black/[.08] p-4 dark:border-white/[.145]">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.08]"
          >
            {link.label}
          </Link>
        ))}
        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-4 rounded-md px-3 py-2 text-left text-sm text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.08]"
        >
          Sign out
        </button>
      </nav>
      <main className="flex flex-1">{children}</main>
    </div>
  );
}
