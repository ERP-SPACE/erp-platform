import { Field, TextInput } from "@erp/ui";

/** Optional "why" for an audited change; it is stored with the audit row (X-Change-Reason). */
export function ReasonField({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <Field
      label="Reason for this change"
      hint={required ? undefined : "Optional — saved in the audit log."}
      required={required}
    >
      {(p) => (
        <TextInput
          {...p}
          maxLength={500}
          placeholder="e.g. Corrected bank IFSC after cheque bounce"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
