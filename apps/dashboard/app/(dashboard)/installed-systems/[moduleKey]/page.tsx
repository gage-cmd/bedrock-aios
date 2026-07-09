"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { listEnabledModules, type EnabledModule } from "@/lib/module-registry-client";
import { getModuleTabs } from "@/lib/module-detail-tabs";

export default function ModuleDetailPage() {
  const params = useParams<{ moduleKey: string }>();
  const moduleKey = params.moduleKey;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [module, setModule] = useState<EnabledModule | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const modules = await listEnabledModules();
      if (!active) return;

      const match = modules.find((m) => m.moduleKey === moduleKey);
      if (!match) {
        setNotFound(true);
        return;
      }
      setModule(match);
    }

    void load();
    return () => {
      active = false;
    };
  }, [moduleKey]);

  const tabs = getModuleTabs(moduleKey);
  const activeKey = searchParams.get("tab") ?? tabs[0]?.key;
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  function selectTab(key: string) {
    router.replace(`/installed-systems/${moduleKey}?tab=${key}`);
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

      <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-medium text-[var(--color-ink)]">
        {module?.name ?? "Loading..."}
      </h1>
      {module?.description && (
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
          {module.description}
        </p>
      )}

      <div className="mt-6 flex gap-1 border-b border-[var(--color-border)]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => selectTab(t.key)}
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

      <div className="mt-6">{active?.render()}</div>
    </div>
  );
}
