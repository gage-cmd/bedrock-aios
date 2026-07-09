"use client";

import { useEffect, useState } from "react";
import { SchemaForm } from "@/components/admin/SchemaForm";
import {
  activateTenant,
  createTenant,
  enableModules,
  getOnboardingState,
  inviteOwner,
  listModules,
  provisionNumber,
  saveModuleConfig,
  type AvailableModule,
  type CreatedTenant,
  type OnboardingState,
} from "@/lib/onboarding-client";

// The Onboarding Console (Phase 5): a platform-admin wizard that stands up a
// new client tenant end to end. Signed-in admins only -- every backend call
// is authorized by AdminGuard, and a non-admin session just sees the 403
// message surface here. Order matters and mirrors the sales-to-live flow:
// create -> enable modules -> configure each module (schema-driven) ->
// provision number -> invite owner -> CONFIRM SUMMARY -> activate.
//
// The summary is a deliberate gate, not decoration: by that point a phone
// number purchase and an invite email (real, mostly-irreversible actions)
// have already happened, and activation flips the client live. The admin
// reviews exactly what was built before throwing the switch.

type WizardStep =
  | "create"
  | "modules"
  | "settings"
  | "number"
  | "invite"
  | "summary"
  | "done";

const PLAN = "core";

const inputClasses =
  "rounded-md border border-black/[.08] px-3 py-2 text-black disabled:opacity-50 dark:border-white/[.145] dark:bg-black dark:text-zinc-50";
const buttonClasses =
  "self-start rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black";

const STEP_LABELS: Record<WizardStep, string> = {
  create: "1. Create tenant",
  modules: "2. Enable modules",
  settings: "3. Configure settings",
  number: "4. Phone number",
  invite: "5. Invite owner",
  summary: "6. Confirm & activate",
  done: "Done",
};

export default function OnboardingConsolePage() {
  const [step, setStep] = useState<WizardStep>("create");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [tenant, setTenant] = useState<CreatedTenant | null>(null);
  const [available, setAvailable] = useState<AvailableModule[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // Settings are configured one enabled module at a time; this tracks where
  // we are in that sub-sequence.
  const [settingsIndex, setSettingsIndex] = useState(0);
  const [assignedNumber, setAssignedNumber] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [summary, setSummary] = useState<OnboardingState | null>(null);

  useEffect(() => {
    listModules()
      .then(setAvailable)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // STEP 2 -- create the tenant.
  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const created = await run(() =>
      createTenant({
        name: String(form.get("name") ?? ""),
        contactEmail: String(form.get("contactEmail") ?? ""),
        plan: PLAN,
      }),
    );
    if (created) {
      setTenant(created);
      setStep("modules");
    }
  }

  // STEP 3 -- enable the selected modules.
  async function handleEnableModules() {
    if (!tenant) return;
    const keys = [...selectedKeys];
    const ok = await run(() => enableModules(tenant.tenantId, keys));
    if (ok) {
      setSettingsIndex(0);
      setStep(configurableModules(keys).length > 0 ? "settings" : "number");
    }
  }

  // The enabled modules that actually ship a settings schema, in stable order.
  function configurableModules(keys: string[]): AvailableModule[] {
    return available.filter(
      (m) => keys.includes(m.moduleKey) && m.settingsSchema !== null,
    );
  }

  // STEP 4 -- save the current module's settings, then advance to the next
  // configurable module (or on to number provisioning).
  async function handleSaveSettings(values: Record<string, unknown>) {
    if (!tenant) return;
    const configurable = configurableModules([...selectedKeys]);
    const current = configurable[settingsIndex];
    const ok = await run(() =>
      saveModuleConfig(tenant.tenantId, current.moduleKey, values),
    );
    if (ok) {
      if (settingsIndex + 1 < configurable.length) {
        setSettingsIndex(settingsIndex + 1);
      } else {
        setStep("number");
      }
    }
  }

  // STEP 5 -- provision the default number.
  async function handleProvisionNumber() {
    if (!tenant) return;
    const result = await run(() => provisionNumber(tenant.tenantId));
    if (result) {
      setAssignedNumber(result.phone_number);
    }
  }

  // STEP 6 -- invite the first user as owner.
  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tenant) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const invited = await run(() => inviteOwner(tenant.tenantId, email));
    if (invited) {
      setInvitedEmail(invited.email);
      const state = await run(() => getOnboardingState(tenant.tenantId));
      if (state) {
        setSummary(state);
        setStep("summary");
      }
    }
  }

  // STEP 7 -- the confirmed activation.
  async function handleActivate() {
    if (!tenant) return;
    const ok = await run(() => activateTenant(tenant.tenantId));
    if (ok) setStep("done");
  }

  const configurable = configurableModules([...selectedKeys]);
  const currentModule = configurable[settingsIndex];

  return (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Onboarding Console
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {STEP_LABELS[step]}
        {tenant && ` -- ${tenant.name}`}
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {step === "create" && (
        <form onSubmit={handleCreate} className="mt-6 flex max-w-lg flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Business name
            <input name="name" required className={inputClasses} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Primary contact email
            <input name="contactEmail" type="email" required className={inputClasses} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Plan
            <input value="Core" disabled className={inputClasses} />
          </label>
          <button type="submit" disabled={busy} className={buttonClasses}>
            {busy ? "Creating..." : "Create tenant"}
          </button>
        </form>
      )}

      {step === "modules" && (
        <div className="mt-6 flex max-w-lg flex-col gap-4">
          {available.map((mod) => (
            <label
              key={mod.moduleKey}
              className="flex items-start gap-3 rounded-md border border-black/[.08] p-4 text-sm dark:border-white/[.145]"
            >
              <input
                type="checkbox"
                checked={selectedKeys.has(mod.moduleKey)}
                onChange={(e) => {
                  const next = new Set(selectedKeys);
                  if (e.target.checked) next.add(mod.moduleKey);
                  else next.delete(mod.moduleKey);
                  setSelectedKeys(next);
                }}
                className="mt-1 h-4 w-4"
              />
              <span className="flex flex-col gap-1">
                <span className="font-medium text-black dark:text-zinc-50">
                  {mod.name}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {mod.description}
                </span>
              </span>
            </label>
          ))}
          <button
            onClick={() => void handleEnableModules()}
            disabled={busy || selectedKeys.size === 0}
            className={buttonClasses}
          >
            {busy ? "Enabling..." : `Enable ${selectedKeys.size} selected`}
          </button>
        </div>
      )}

      {step === "settings" && currentModule?.settingsSchema && (
        <div className="mt-6">
          <h2 className="mb-4 text-lg font-medium text-black dark:text-zinc-50">
            {currentModule.name} ({settingsIndex + 1} of {configurable.length})
          </h2>
          <SchemaForm
            key={currentModule.moduleKey}
            schema={currentModule.settingsSchema}
            submitLabel="Save and continue"
            onSubmit={handleSaveSettings}
          />
        </div>
      )}

      {step === "number" && (
        <div className="mt-6 flex max-w-lg flex-col gap-4">
          {assignedNumber ? (
            <>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Assigned number:{" "}
                <span className="font-mono font-medium text-black dark:text-zinc-50">
                  {assignedNumber}
                </span>
              </p>
              <button onClick={() => setStep("invite")} className={buttonClasses}>
                Continue
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Provisions this business a dedicated number and makes it their
                default line. This purchases a real number when Twilio is the
                active provider.
              </p>
              <button
                onClick={() => void handleProvisionNumber()}
                disabled={busy}
                className={buttonClasses}
              >
                {busy ? "Provisioning..." : "Provision number"}
              </button>
            </>
          )}
        </div>
      )}

      {step === "invite" && (
        <form onSubmit={handleInvite} className="mt-6 flex max-w-lg flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Owner email
            <input
              name="email"
              type="email"
              required
              defaultValue={tenant?.contactEmail ?? ""}
              className={inputClasses}
            />
          </label>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Sends the client&apos;s first sign-in invite. They join this tenant
            as owner.
          </p>
          <button type="submit" disabled={busy} className={buttonClasses}>
            {busy ? "Inviting..." : "Send invite"}
          </button>
        </form>
      )}

      {step === "summary" && summary && (
        <div className="mt-6 flex max-w-lg flex-col gap-4">
          <dl className="flex flex-col gap-3 rounded-md border border-black/[.08] p-4 text-sm dark:border-white/[.145]">
            <SummaryRow label="Business" value={summary.name} />
            <SummaryRow label="Plan" value={summary.plan ?? "-"} />
            <SummaryRow
              label="Enabled modules"
              value={
                summary.modules
                  .filter((m) => m.enabled)
                  .map(
                    (m) =>
                      available.find((a) => a.moduleKey === m.moduleKey)
                        ?.name ?? m.moduleKey,
                  )
                  .join(", ") || "-"
              }
            />
            {summary.modules
              .filter((m) => m.enabled && Object.keys(m.config).length > 0)
              .map((m) => (
                <SummaryRow
                  key={m.moduleKey}
                  label={`${
                    available.find((a) => a.moduleKey === m.moduleKey)?.name ??
                    m.moduleKey
                  } settings`}
                  value={Object.entries(m.config)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join("; ")}
                />
              ))}
            <SummaryRow label="Phone number" value={summary.defaultNumber ?? "-"} />
            <SummaryRow
              label="Invited owner"
              value={invitedEmail ?? summary.invitedUsers[0]?.email ?? "-"}
            />
          </dl>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Review everything above. Activating flips this business live: their
            dashboard turns on and the welcome message is sent.
          </p>
          <button
            onClick={() => void handleActivate()}
            disabled={busy}
            className={buttonClasses}
          >
            {busy ? "Activating..." : "Confirm and activate"}
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="mt-6 max-w-lg text-sm text-zinc-700 dark:text-zinc-300">
          <p>
            {tenant?.name} is live. Their dashboard is active and{" "}
            {invitedEmail ?? "the owner"} can sign in from their invite email.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-black dark:text-zinc-50">{value}</dd>
    </div>
  );
}
