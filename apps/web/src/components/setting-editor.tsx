import { Button, Field, NumberInput, Select, Switch, TextInput } from "@erp/ui";
import { Plus, Trash2 } from "lucide-react";
import type { z } from "zod";

/**
 * Builds an editor from a setting's Zod schema (contracts/settings.ts), so new settings need no
 * new UI. Drafts are strings while editing; `fromDraft` converts back before validation.
 */
export type Draft = string | boolean | Draft[] | { [key: string]: Draft };

type AnySchema = z.ZodType & { def: { type: string; innerType?: z.ZodType } };

/** Looks through `.default()` / `.optional()` wrappers to the schema that shapes the editor. */
function unwrap(schema: z.ZodType): z.ZodType {
  const def = (schema as AnySchema).def;
  return (def.type === "default" || def.type === "optional") && def.innerType
    ? unwrap(def.innerType)
    : schema;
}
const kind = (schema: z.ZodType) => (unwrap(schema) as AnySchema).def.type;
const elementOf = (schema: z.ZodType) =>
  (unwrap(schema) as unknown as z.ZodArray<z.ZodType>).element;
/** Lists of records (e.g. landed-cost charges) are edited as a table, not comma text. */
const isRecordList = (schema: z.ZodType) =>
  kind(schema) === "array" && kind(elementOf(schema)) === "object";
const shapeOf = (schema: z.ZodType) =>
  (unwrap(schema) as unknown as z.ZodObject).shape as Record<string, z.ZodType>;

function choices(input: z.ZodType): string[] | null {
  const schema = unwrap(input);
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
      if (isRecordList(schema)) {
        return Array.isArray(value) ? value.map((v) => toDraft(elementOf(schema), v)) : [];
      }
      return Array.isArray(value) ? value.join(", ") : "";
    case "boolean":
      return Boolean(value);
    case "object": {
      const shape = shapeOf(schema);
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
      const element = elementOf(schema);
      if (isRecordList(schema)) return (draft as Draft[]).map((row) => fromDraft(element, row));
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
      const shape = shapeOf(schema);
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

  if (isRecordList(schema)) {
    return (
      <RecordListEditor
        schema={schema}
        rows={draft as Draft[]}
        onChange={onChange}
        label={label}
        errors={errors}
        path={path}
      />
    );
  }
  if (kind(schema) === "object") {
    const shape = shapeOf(schema);
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

/** Table editor for a list of records: one row per item, add and remove rows. */
function RecordListEditor({
  schema,
  rows,
  onChange,
  label,
  errors,
  path,
}: {
  schema: z.ZodType;
  rows: Draft[];
  onChange: (draft: Draft) => void;
  label: string;
  errors: Record<string, string>;
  path: string;
}) {
  const element = elementOf(schema);
  const shape = shapeOf(element);
  const blank = toDraft(element, {}) as Record<string, Draft>;
  return (
    <fieldset className="grid gap-3">
      <legend className="sr-only">{label}</legend>
      {errors[path] ? <p className="text-xs text-danger">{errors[path]}</p> : null}
      {rows.map((row, index) => (
        <div
          key={index}
          className="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))_auto]"
        >
          {Object.entries(shape).map(([key, child]) => (
            <SettingEditor
              key={key}
              schema={child}
              draft={(row as Record<string, Draft>)[key]!}
              label={humanise(key)}
              path={`${path}.${index}.${key}`}
              errors={errors}
              onChange={(next) =>
                onChange(rows.map((r, i) => (i === index ? { ...(r as object), [key]: next } : r)))
              }
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={Trash2}
            iconOnly
            aria-label={`Remove row ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={Plus}
        className="justify-self-start"
        onClick={() => onChange([...rows, blank])}
      >
        Add row
      </Button>
    </fieldset>
  );
}

/** One-line summary of a stored value for the register. */
export function summarise(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        v && typeof v === "object"
          ? Object.values(v as Record<string, unknown>)
              .filter((x) => typeof x === "string")
              .slice(0, 2)
              .join(" ")
          : String(v),
      )
      .join(", ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanise(k).toLowerCase()} ${String(v)}`)
      .join(" · ");
  }
  return String(value);
}
