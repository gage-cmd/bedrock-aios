// Minimal typing of the settings.schema.json subset the flow test consumes.
// Lives in test/ (not src/) because only e2e specs need it.
export interface SettingsSchemaProperty {
  type: string;
  default?: unknown;
}

export interface SettingsSchema {
  properties: Record<string, SettingsSchemaProperty>;
  required?: string[];
}
