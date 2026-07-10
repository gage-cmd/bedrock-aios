// Server-side validation of a module's saved settings against its own
// settings.schema.json. Lives in core/module-registry -- the one place that
// already knows how to read a module's package files -- so every path that
// persists module config (the admin Onboarding Console and the tenant
// dashboard's settings form) validates through the SAME code rather than
// trusting the form's HTML `required`/pattern attributes, which a replayed or
// out-of-band request skips entirely.

// The subset of JSON Schema the settings forms use, enough to validate saved
// config server-side.
export interface SchemaProperty {
  type?: 'string' | 'integer' | 'number' | 'boolean';
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
}

export interface SettingsSchemaShape {
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// RFC-5322 is overkill here; this is the same shape the HTML email input and
// the module settings pages accept.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateProperty(
  moduleKey: string,
  key: string,
  prop: SchemaProperty,
  value: unknown,
): void {
  const label = `${moduleKey}: "${key}"`;
  switch (prop.type) {
    case 'string': {
      if (typeof value !== 'string') throw new Error(`${label} must be text`);
      if (prop.format === 'email' && !EMAIL_RE.test(value)) {
        throw new Error(`${label} must be a valid email address`);
      }
      if (prop.format === 'uri' && !isHttpUrl(value)) {
        throw new Error(`${label} must be a valid URL`);
      }
      if (prop.pattern && !new RegExp(prop.pattern).test(value)) {
        throw new Error(`${label} is not in the required format`);
      }
      break;
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${label} must be a number`);
      }
      if (prop.type === 'integer' && !Number.isInteger(value)) {
        throw new Error(`${label} must be a whole number`);
      }
      if (prop.minimum !== undefined && value < prop.minimum) {
        throw new Error(`${label} must be at least ${prop.minimum}`);
      }
      if (prop.maximum !== undefined && value > prop.maximum) {
        throw new Error(`${label} must be at most ${prop.maximum}`);
      }
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new Error(`${label} must be true or false`);
      }
      break;
    }
  }
}

// Enforces the module's settings.schema.json against submitted config: every
// required field present, and every known field the right type/format/pattern.
// Keys not in the schema are dropped rather than rejected, so a newer form than
// the backend expects doesn't hard-fail.
export function validateAndSanitizeConfig(
  moduleKey: string,
  schema: SettingsSchemaShape,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const properties = schema.properties ?? {};

  for (const key of schema.required ?? []) {
    const value = config[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`${moduleKey}: "${key}" is required`);
    }
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const prop = properties[key];
    if (!prop) continue; // ignore unknown keys
    validateProperty(moduleKey, key, prop, value);
    sanitized[key] = value;
  }
  return sanitized;
}
