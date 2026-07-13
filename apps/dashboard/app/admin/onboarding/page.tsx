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
  listOnboardingTenants,
  provisionNumber,
  saveModuleConfig,
  searchNumbers,
  updateTenantName,
  OnboardingRequestError,
  type AvailableModule,
  type AvailableNumber,
  type CreatedTenant,
  type OnboardingState,
  type OnboardingTenantSummary,
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
//
// The console opens on a list of in-progress onboardings: an interrupted setup
// is resumed from the correct step (state read back from the backend) rather
// than restarted, which used to silently create a duplicate tenant.

type WizardStep =
  | "list"
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
const secondaryButtonClasses =
  "self-start rounded-md border border-black/[.08] px-4 py-2 text-sm text-black disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50";

const STEP_LABELS: Record<WizardStep, string> = {
  list: "In-progress onboardings",
  create: "1. Create tenant",
  modules: "2. Enable modules",
  settings: "3. Configure settings",
  number: "4. Phone number",
  invite: "5. Invite owner",
  summary: "6. Confirm & activate",
  done: "Done",
};

// The enabled modules that actually ship a settings schema, in stable order --
// the sub-sequence the settings step walks and the resume router indexes into.
function configurableModules(
  available: AvailableModule[],
  keys: string[],
): AvailableModule[] {
  return available.filter(
    (m) => keys.includes(m.moduleKey) && m.settingsSchema !== null,
  );
}

export default function OnboardingConsolePage() {
  const [step, setStep] = useState<WizardStep>("list");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [tenants, setTenants] = useState<OnboardingTenantSummary[]>([]);
  const [tenant, setTenant] = useState<CreatedTenant | null>(null);
  const [available, setAvailable] = useState<AvailableModule[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // Settings are configured one enabled module at a time; this tracks where
  // we are in that sub-sequence.
  const [settingsIndex, setSettingsIndex] = useState(0);
  // When set, saving settings returns to the summary (an edit-from-summary
  // correction) rather than advancing the wizard.
  const [editingFromSummary, setEditingFromSummary] = useState(false);
  const [assignedNumber, setAssignedNumber] = useState<string | null>(null);
  const [areaCode, setAreaCode] = useState("");
  const [numberResults, setNumberResults] = useState<AvailableNumber[] | null>(
    null,
  );
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  // The client's own Twilio Messaging Service SID (ISV model). Pasted in by the
  // admin during the number step; required before a number can be purchased.
  const [messagingServiceSid, setMessagingServiceSid] = useState("");
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [summary, setSummary] = useState<OnboardingState | null>(null);
  // A same-name tenant the admin tried to create: they resume it or confirm a
  // separate one. Holds the pending create so "create anyway" can replay it.
  const [duplicate, setDuplicate] = useState<{
    name: string;
    contactEmail: string;
  } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    listModules()
      .then(setAvailable)
      .catch((err: Error) => setError(err.message));
    listOnboardingTenants()
      .then(setTenants)
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

  // Clears the per-tenant wizard state so a fresh client starts clean.
  function resetWizard() {
    setTenant(null);
    setSelectedKeys(new Set());
    setSettingsIndex(0);
    setEditingFromSummary(false);
    setAssignedNumber(null);
    setAreaCode("");
    setNumberResults(null);
    setSelectedNumber(null);
    setMessagingServiceSid("");
    setInvitedEmail(null);
    setSummary(null);
    setDuplicate(null);
    setEditingName(false);
    setError(null);
  }

  function startNewClient() {
    resetWizard();
    setStep("create");
  }

  // Resume: read the tenant's current state and drop the admin at the first
  // unfinished step, rebuilding the wizard's in-memory state from it.
  async function handleResume(tenantId: string) {
    const state = await run(() => getOnboardingState(tenantId));
    if (!state) return;

    resetWizard();
    setTenant({
      tenantId: state.tenantId,
      name: state.name,
      status: state.status,
      plan: state.plan ?? PLAN,
      contactEmail: "",
    });
    setSummary(state);

    const enabledKeys = state.modules
      .filter((m) => m.enabled)
      .map((m) => m.moduleKey);
    setSelectedKeys(new Set(enabledKeys));
    setAssignedNumber(state.defaultNumber);
    setInvitedEmail(state.invitedUsers[0]?.email ?? null);

    if (enabledKeys.length === 0) {
      setStep("modules");
      return;
    }

    const configurable = configurableModules(available, enabledKeys);
    const firstUnconfigured = configurable.findIndex((m) => {
      const ms = state.modules.find((x) => x.moduleKey === m.moduleKey);
      return !ms || Object.keys(ms.config).length === 0;
    });
    if (firstUnconfigured !== -1) {
      setSettingsIndex(firstUnconfigured);
      setStep("settings");
      return;
    }
    if (!state.defaultNumber) {
      setStep("number");
      return;
    }
    if (state.invitedUsers.length === 0) {
      setStep("invite");
      return;
    }
    setStep("summary");
  }

  // STEP 1 -- create the tenant. A same-name tenant comes back as a 409 the
  // admin resolves (resume the existing one, or confirm a separate tenant).
  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "");
    const contactEmail = String(form.get("contactEmail") ?? "");

    setBusy(true);
    setError(null);
    setDuplicate(null);
    try {
      const created = await createTenant({ name, contactEmail, plan: PLAN });
      setTenant(created);
      setStep("modules");
    } catch (err) {
      if (
        err instanceof OnboardingRequestError &&
        err.code === "duplicate_name"
      ) {
        setDuplicate({ name, contactEmail });
      } else {
        setError(err instanceof Error ? err.message : "Request failed");
      }
    } finally {
      setBusy(false);
    }
  }

  // The override path: create a separate tenant despite the same-name warning.
  async function handleConfirmDuplicate() {
    if (!duplicate) return;
    const created = await run(() =>
      createTenant({ ...duplicate, plan: PLAN, confirmDuplicate: true }),
    );
    if (created) {
      setTenant(created);
      setDuplicate(null);
      setStep("modules");
    }
  }

  // STEP 2 -- enable the selected modules.
  async function handleEnableModules() {
    if (!tenant) return;
    const keys = [...selectedKeys];
    const ok = await run(() => enableModules(tenant.tenantId, keys));
    if (ok) {
      setSettingsIndex(0);
      setStep(
        configurableModules(available, keys).length > 0 ? "settings" : "number",
      );
    }
  }

  // STEP 3 -- save the current module's settings, then advance to the next
  // configurable module (or on to number provisioning). When correcting from
  // the summary, return there instead.
  async function handleSaveSettings(values: Record<string, unknown>) {
    if (!tenant) return;
    const configurable = configurableModules(available, [...selectedKeys]);
    const current = configurable[settingsIndex];
    const ok = await run(() =>
      saveModuleConfig(tenant.tenantId, current.moduleKey, values),
    );
    if (!ok) return;

    if (editingFromSummary) {
      setEditingFromSummary(false);
      const state = await run(() => getOnboardingState(tenant.tenantId));
      if (state) setSummary(state);
      setStep("summary");
      return;
    }

    if (settingsIndex + 1 < configurable.length) {
      setSettingsIndex(settingsIndex + 1);
    } else {
      setStep("number");
    }
  }

  // STEP 4 (search) -- available local numbers for the area code. Read-only.
  async function handleSearchNumbers() {
    if (!tenant) return;
    setSelectedNumber(null);
    const results = await run(() => searchNumbers(tenant.tenantId, areaCode));
    if (results) setNumberResults(results);
  }

  // STEP 4 (purchase) -- buy the selected number. The irreversible action.
  // Both the selected number and the client's Messaging Service SID are
  // required before the purchase (ISV model).
  async function handleProvisionNumber() {
    if (!tenant || !selectedNumber || !messagingServiceSid.trim()) return;
    const result = await run(() =>
      provisionNumber(
        tenant.tenantId,
        selectedNumber,
        messagingServiceSid.trim(),
      ),
    );
    if (result) setAssignedNumber(result.phone_number);
  }

  // STEP 5 -- invite the first user as owner, then load the summary.
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

  // Edit-from-summary: jump back to a module's settings, saving returns here.
  function editModuleFromSummary(moduleKey: string) {
    const configurable = configurableModules(available, [...selectedKeys]);
    const index = configurable.findIndex((m) => m.moduleKey === moduleKey);
    if (index === -1) return;
    setSettingsIndex(index);
    setEditingFromSummary(true);
    setError(null);
    setStep("settings");
  }

  // Edit-from-summary: rename the tenant in place (onboarding-only server-side).
  async function handleSaveName() {
    if (!tenant) return;
    const result = await run(() =>
      updateTenantName(tenant.tenantId, nameDraft),
    );
    if (result) {
      setTenant({ ...tenant, name: result.name });
      setSummary(summary ? { ...summary, name: result.name } : summary);
      setEditingName(false);
    }
  }

  // STEP 6 -- the confirmed activation.
  async function handleActivate() {
    if (!tenant) return;
    const ok = await run(() => activateTenant(tenant.tenantId));
    if (ok) setStep("done");
  }

  const configurable = configurableModules(available, [...selectedKeys]);
  const currentModule = configurable[settingsIndex];
  // Autofill each module's settings with the tenant name, and prefill from the
  // saved config when correcting from the summary -- so the business name is
  // never re-typed per module.
  const currentModuleConfig = summary?.modules.find(
    (m) => m.moduleKey === currentModule?.moduleKey,
  )?.config;
  const settingsInitialValues =
    currentModuleConfig && Object.keys(currentModuleConfig).length > 0
      ? currentModuleConfig
      : { businessName: tenant?.name ?? "" };

  return (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Onboarding Console
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {STEP_LABELS[step]}
        {tenant && step !== "list" && ` -- ${tenant.name}`}
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {step === "list" && (
        <div className="mt-6 flex max-w-lg flex-col gap-4">
          {tenants.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No onboardings in progress.
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Resume an in-progress setup instead of starting over.
              </p>
              <ul className="flex flex-col gap-2">
                {tenants.map((t) => (
                  <li
                    key={t.tenantId}
                    className="flex items-center justify-between gap-3 rounded-md border border-black/[.08] p-4 text-sm dark:border-white/[.145]"
                  >
                    <span className="font-medium text-black dark:text-zinc-50">
                      {t.name}
                    </span>
                    <button
                      onClick={() => void handleResume(t.tenantId)}
                      disabled={busy}
                      className={secondaryButtonClasses}
                    >
                      Resume
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button onClick={startNewClient} className={buttonClasses}>
            Start new client
          </button>
        </div>
      )}

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

          {duplicate ? (
            <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <p className="text-amber-700 dark:text-amber-400">
                A client named &quot;{duplicate.name}&quot; already exists.
                Resume it from the list, or create a separate one anyway.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void handleConfirmDuplicate()}
                  disabled={busy}
                  className={buttonClasses}
                >
                  {busy ? "Creating..." : "Create separate anyway"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDuplicate(null);
                    setStep("list");
                  }}
                  className={secondaryButtonClasses}
                >
                  Back to list
                </button>
              </div>
            </div>
          ) : (
            <button type="submit" disabled={busy} className={buttonClasses}>
              {busy ? "Creating..." : "Create tenant"}
            </button>
          )}
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
            initialValues={settingsInitialValues}
            submitLabel={editingFromSummary ? "Save changes" : "Save and continue"}
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
                Search a local area code and pick the client&apos;s number -- a
                local number builds local trust. Selecting and confirming
                purchases a real number when Twilio is the active provider.
              </p>
              <div className="flex items-end gap-3">
                <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Area code
                  <input
                    value={areaCode}
                    onChange={(e) => setAreaCode(e.target.value)}
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="415"
                    className={`${inputClasses} w-28`}
                  />
                </label>
                <button
                  onClick={() => void handleSearchNumbers()}
                  disabled={busy || areaCode.trim().length !== 3}
                  className={secondaryButtonClasses}
                >
                  {busy ? "Searching..." : "Search"}
                </button>
              </div>

              {numberResults && numberResults.length === 0 && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No numbers available in that area code -- try another.
                </p>
              )}

              {numberResults && numberResults.length > 0 && (
                <>
                  <ul className="flex flex-col gap-2">
                    {numberResults.map((n) => (
                      <li key={n.phoneNumber}>
                        <label className="flex items-center gap-3 rounded-md border border-black/[.08] p-3 text-sm dark:border-white/[.145]">
                          <input
                            type="radio"
                            name="number"
                            checked={selectedNumber === n.phoneNumber}
                            onChange={() => setSelectedNumber(n.phoneNumber)}
                            className="h-4 w-4"
                          />
                          <span className="font-mono text-black dark:text-zinc-50">
                            {n.phoneNumber}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                    Messaging Service SID
                    <input
                      value={messagingServiceSid}
                      onChange={(e) => setMessagingServiceSid(e.target.value)}
                      placeholder="MG..."
                      className={`${inputClasses} font-mono`}
                    />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      The client&apos;s own registered Messaging Service -- the
                      number is provisioned into it. Required before purchase.
                    </span>
                  </label>
                  <button
                    onClick={() => void handleProvisionNumber()}
                    disabled={
                      busy || !selectedNumber || !messagingServiceSid.trim()
                    }
                    className={buttonClasses}
                  >
                    {busy ? "Purchasing..." : "Purchase this number"}
                  </button>
                </>
              )}
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
            <div className="flex flex-col gap-0.5">
              <dt className="text-zinc-500 dark:text-zinc-400">Business</dt>
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    aria-label="Business name"
                    className={inputClasses}
                  />
                  <button
                    onClick={() => void handleSaveName()}
                    disabled={busy}
                    className={secondaryButtonClasses}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    className={secondaryButtonClasses}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <dd className="flex items-center justify-between gap-3 text-black dark:text-zinc-50">
                  {summary.name}
                  <button
                    onClick={() => {
                      setNameDraft(summary.name);
                      setEditingName(true);
                    }}
                    className="text-xs text-zinc-500 underline dark:text-zinc-400"
                  >
                    Edit
                  </button>
                </dd>
              )}
            </div>
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
                <div key={m.moduleKey} className="flex flex-col gap-0.5">
                  <dt className="flex items-center justify-between gap-3 text-zinc-500 dark:text-zinc-400">
                    {available.find((a) => a.moduleKey === m.moduleKey)?.name ??
                      m.moduleKey}{" "}
                    settings
                    <button
                      onClick={() => editModuleFromSummary(m.moduleKey)}
                      className="text-xs underline"
                    >
                      Edit
                    </button>
                  </dt>
                  <dd className="text-black dark:text-zinc-50">
                    {Object.entries(m.config)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join("; ")}
                  </dd>
                </div>
              ))}
            <SummaryRow label="Phone number" value={summary.defaultNumber ?? "-"} />
            <SummaryRow
              label="Invited owner"
              value={invitedEmail ?? summary.invitedUsers[0]?.email ?? "-"}
            />
          </dl>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            The phone number has already been purchased and the owner invite has
            already been sent -- those steps are done. You can still correct the
            business name or module settings above. Activating is the final
            step: it turns on their dashboard and sends the welcome message.
          </p>
          <button
            onClick={() => void handleActivate()}
            disabled={busy || editingName}
            className={buttonClasses}
          >
            {busy ? "Activating..." : "Confirm and activate"}
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="mt-6 flex max-w-lg flex-col gap-4 text-sm text-zinc-700 dark:text-zinc-300">
          <p>
            {tenant?.name} is live. Their dashboard is active and{" "}
            {invitedEmail ?? "the owner"} can sign in from their invite email.
          </p>
          <button
            onClick={() => {
              resetWizard();
              void run(() => listOnboardingTenants().then(setTenants));
              setStep("list");
            }}
            className={secondaryButtonClasses}
          >
            Back to list
          </button>
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
