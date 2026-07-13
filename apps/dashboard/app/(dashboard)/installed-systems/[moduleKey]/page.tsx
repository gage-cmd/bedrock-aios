"use client";

import Link from "next/link";
import { useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEnabledModules } from "@/lib/queries";
import { getModuleTabs } from "@/lib/module-detail-tabs";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ModuleDetailPage() {
  const params = useParams<{ moduleKey: string }>();
  const moduleKey = params.moduleKey;
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: modules, isError: error } = useEnabledModules();
  const installed = modules?.find((m) => m.moduleKey === moduleKey) ?? null;
  const notFound = modules !== undefined && !installed;

  const tabs = getModuleTabs(moduleKey);
  const activeKey = searchParams.get("tab") ?? tabs[0]?.key;
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  function selectTab(key: string) {
    router.replace(`/installed-systems/${moduleKey}?tab=${key}`);
  }

  function onTablistKeyDown(e: React.KeyboardEvent) {
    const idx = tabs.findIndex((t) => t.key === active?.key);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === -1) return;
    e.preventDefault();
    const key = tabs[next].key;
    selectTab(key);
    tabRefs.current.get(key)?.focus();
  }

  if (error) {
    return (
      <div className="flex-1 p-8">
        <Link
          href="/installed-systems"
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent-primary)]"
        >
          &larr; Installed Systems
        </Link>
        <p className="mt-4 text-sm text-[var(--color-status-attention)]">
          We couldn&apos;t load this system. Please refresh to try again.
        </p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex-1 p-8">
        <Link
          href="/installed-systems"
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent-primary)]"
        >
          &larr; Installed Systems
        </Link>
        <p className="mt-4 text-[var(--color-text-secondary)]">
          This system is not installed for your business.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8">
      <Link
        href="/installed-systems"
        className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent-primary)]"
      >
        &larr; Installed Systems
      </Link>

      {installed ? (
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-medium text-[var(--color-ink)]">
          {installed.name}
        </h1>
      ) : (
        <Skeleton className="mt-2 h-9 w-72" />
      )}
      {installed?.description && (
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
          {installed.description}
        </p>
      )}

      <div
        role="tablist"
        aria-label={`${installed?.name ?? "System"} sections`}
        className="mt-6 flex gap-1 border-b border-[var(--color-border)]"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            ref={(el) => {
              if (el) tabRefs.current.set(t.key, el);
              else tabRefs.current.delete(t.key);
            }}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={t.key === active?.key}
            aria-controls={`tabpanel-${t.key}`}
            tabIndex={t.key === active?.key ? 0 : -1}
            onClick={() => selectTab(t.key)}
            onKeyDown={onTablistKeyDown}
            className={
              t.key === active?.key
                ? "border-b-2 border-[var(--color-accent-primary)] px-3 py-2 text-sm font-medium text-[var(--color-ink)]"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-ink)]"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`tabpanel-${active?.key}`}
        aria-labelledby={`tab-${active?.key}`}
        className="mt-6"
      >
        {active?.render()}
      </div>
    </div>
  );
}
