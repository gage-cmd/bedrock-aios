"use client";

import { useState } from "react";
import type {
  SchemaProperty,
  SettingsSchema,
} from "@/lib/onboarding-client";

// Generic settings-schema-driven form renderer (Onboarding Console Step 4).
// Given ANY module's settings.schema.json it renders the right field per
// property -- text/url/email inputs, textareas for long template strings,
// number inputs with min/max, checkboxes for booleans -- seeded with the
// schema's defaults and enforcing its required list. It contains zero
// module-specific logic: a brand-new module that ships a settings.schema.json
// gets a working onboarding settings form for free.

interface SchemaFormProps {
  schema: SettingsSchema;
  initialValues?: Record<string, unknown>;
  submitLabel: string;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
}

const inputClasses =
  "rounded-md border border-black/[.08] px-3 py-2 text-black disabled:opacity-50 dark:border-white/[.145] dark:bg-black dark:text-zinc-50";

// A long default strongly suggests prose (message templates and the like);
// give it a textarea instead of a one-line input. Schema-shape heuristic
// only -- no knowledge of any particular module's fields.
function isLongText(prop: SchemaProperty): boolean {
  return typeof prop.default === "string" && prop.default.length > 60;
}

function htmlInputType(prop: SchemaProperty): string {
  if (prop.format === "uri") return "url";
  if (prop.format === "email") return "email";
  return "text";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Mirrors the backend's saveModuleConfig validation so a bad value is caught
// before the request, with a field-named message. Returns an error string, or
// null when the value passes. Empty non-required values are skipped by the
// caller (they are omitted from the payload).
function fieldError(
  prop: SchemaProperty,
  label: string,
  raw: string,
): string | null {
  if (prop.format === "uri" && !isHttpUrl(raw)) {
    return `${label} must be a valid URL (include https://)`;
  }
  if (prop.pattern && !new RegExp(prop.pattern).test(raw)) {
    return `${label} is not in the required format`;
  }
  return null;
}

function initialValue(
  prop: SchemaProperty,
  existing: unknown,
): string | boolean {
  if (prop.type === "boolean") {
    return typeof existing === "boolean"
      ? existing
      : (prop.default as boolean | undefined) ?? false;
  }
  if (existing !== undefined && existing !== null) return String(existing);
  if (prop.default !== undefined) return String(prop.default);
  return "";
}

export function SchemaForm({
  schema,
  initialValues,
  submitLabel,
  onSubmit,
}: SchemaFormProps) {
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(schema.properties);

  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      entries.map(([name, prop]) => [
        name,
        initialValue(prop, initialValues?.[name]),
      ]),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setValue(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Types come from the schema: numbers parsed, booleans passed through,
    // empty optional strings omitted entirely (matching how the existing
    // per-module settings pages store `field || undefined`).
    const out: Record<string, unknown> = {};
    for (const [name, prop] of entries) {
      const raw = values[name];
      if (prop.type === "boolean") {
        out[name] = raw === true;
      } else if (prop.type === "integer" || prop.type === "number") {
        const parsed = Number(raw);
        if (raw !== "" && Number.isFinite(parsed)) out[name] = parsed;
      } else if (typeof raw === "string" && raw.trim() !== "") {
        const problem = fieldError(prop, prop.title ?? name, raw);
        if (problem) {
          setError(problem);
          setSubmitting(false);
          return;
        }
        out[name] = raw;
      }
    }

    try {
      await onSubmit(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-4">
      {entries.map(([name, prop]) => (
        <label
          key={name}
          className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300"
        >
          <span>
            {prop.title ?? name}
            {required.has(name) && <span className="text-red-500"> *</span>}
          </span>
          {prop.type === "boolean" ? (
            <input
              type="checkbox"
              checked={values[name] === true}
              onChange={(e) => setValue(name, e.target.checked)}
              className="h-4 w-4 self-start"
            />
          ) : prop.type === "integer" || prop.type === "number" ? (
            <input
              type="number"
              value={String(values[name])}
              onChange={(e) => setValue(name, e.target.value)}
              min={prop.minimum}
              max={prop.maximum}
              step={prop.type === "integer" ? 1 : undefined}
              required={required.has(name)}
              className={inputClasses}
            />
          ) : isLongText(prop) ? (
            <textarea
              value={String(values[name])}
              onChange={(e) => setValue(name, e.target.value)}
              rows={3}
              required={required.has(name)}
              className={inputClasses}
            />
          ) : (
            <input
              type={htmlInputType(prop)}
              value={String(values[name])}
              onChange={(e) => setValue(name, e.target.value)}
              required={required.has(name)}
              pattern={prop.pattern}
              className={inputClasses}
            />
          )}
          {prop.description && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {prop.description}
            </span>
          )}
        </label>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
      >
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
