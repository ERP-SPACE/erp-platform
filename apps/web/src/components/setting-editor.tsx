import { Field, NumberInput, Select, Switch, TextInput } from "@erp/ui";
import type { z } from "zod";

/**
 * Builds an editor from a setting's Zod schema (contracts/settings.ts), so new settings need no
 * new UI. Drafts are strings while editing; `fromDraft` converts back before validation.
 */
export type Draft = string | boolean | { [key: string]: Draft };

type AnySchema = z.ZodType & { def: { type: string } };
const kind = (schema: z.ZodType) => (schema as AnySchema).def.type;

function choices(schema: z.ZodType): string[] | null {
  const s = schema as unknown as { options?: unknown[]; def: { type: string } };
  if (kind(schema) === "enum") return (s.options as string[]) ?? null;
  if (kind(schema) === "union") {
    const values = (s.options as z.ZodType[]).map(
      (o) => (o as unknown as { value?: unknown }).value,
    );
    return values.every((v) => v !== undefined) ? values.map(String) : null;
  }
  return null;
}

export function toDraft(schema: z.ZodType, value: unknown): Draft {
  switch (kind(schema)) {
    case "array":
      return Array.isArray(value) ? value.join(", ") : "";
    case "boolean":
      return Boolean(value);
    case "object": {
      const shape = (schema as unknown as z.ZodObject).shape as Record<string, z.ZodType>;
      const record = (value ?? {}) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(shape).map(([k, s]) => [k, toDraft(s, record[k])]));
    }
    default:
      return value === undefined || value === null ? "" : String(value);
  }
}

export function fromDraft(schema: z.ZodType, draft: Draft): unknown {
  switch (kind(schema)) {
    case "array": {
      const element = (schema as unknown as z.ZodArray<z.ZodType>).element;
      const parts = String(draft)
        .split(/[,\s]+/)
        .filter(Boolean);
      return kind(element) === "number" ? parts.map(Number) : parts;
    }
    case "number":
      return draft === "" ? undefined : Number(draft);
    case "boolean":
      return Boolean(draft);
    case "union": {
      const options = choices(schema);
      const numeric = options?.every((o) => o !== "" && !Number.isNaN(Number(o)));
      return numeric ? Number(draft) : draft;
    }
    case "object": {
      const shape = (schema as unknown as z.ZodObject).shape as Record<string, z.ZodType>;
      const record = draft as Record<string, Draft>;
      return Object.fromEntries(
        Object.entries(shape).map(([k, s]) => [k, fromDraft(s, record[k]!)]),
      );
    }
    default:
      return draft;
  }
}

const humanise = (key: string) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/\b(m|mm|in)\b/gi, (u) => `(${u.toLowerCase()})`)
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/ M$/, " (m)")
    .replace(/ Mm$/, " (mm)")
    .replace(/ Pct$/, " (%)");

export function SettingEditor({
  schema,
  draft,
  onChange,
  label,
  errors,
  path = "value",
}: {
  schema: z.ZodType;
  draft: Draft;
  onChange: (draft: Draft) => void;
  label: string;
  errors: Record<string, string>;
  path?: string;
}) {
  const error = errors[path];
  const options = choices(schema);

  if (kind(schema) === "object") {
    const shape = (schema as unknown as z.ZodObject).shape as Record<string, z.ZodType>;
    const record = draft as Record<string, Draft>;
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(shape).map(([key, child]) => (
          <SettingEditor
            key={key}
            schema={child}
            draft={record[key]!}
            label={humanise(key)}
            path={`${path}.${key}`}
            errors={errors}
            onChange={(next) => onChange({ ...record, [key]: next })}
          />
        ))}
      </div>
    );
  }
  if (kind(schema) === "boolean") {
    return <Switch label={label} checked={Boolean(draft)} onCheckedChange={onChange} />;
  }
  if (options) {
    return (
      <Field label={label} error={error}>
        {(p) => (
          <Select
            {...p}
            value={String(draft)}
            onValueChange={onChange}
            options={options.map((o) => ({ value: o, label: o }))}
          />
        )}
      </Field>
    );
  }
  if (kind(schema) === "number") {
    return (
      <Field label={label} error={error}>
        {(p) => <NumberInput {...p} value={String(draft)} onValueChange={onChange} decimals={2} />}
      </Field>
    );
  }
  return (
    <Field
      label={label}
      error={error}
      hint={kind(schema) === "array" ? "Separate values with commas" : undefined}
    >
      {(p) => (
        <TextInput
          {...p}
          className={kind(schema) === "array" ? "tnum" : undefined}
          value={String(draft)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** One-line summary of a stored value for the register. */
export function summarise(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanise(k).toLowerCase()} ${String(v)}`)
      .join(" · ");
  }
  return String(value);
}
