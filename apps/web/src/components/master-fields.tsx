import { GST_STATES, validateGstin } from "@erp/domain";
import { Field, Select, TextInput } from "@erp/ui";
import type { AddressForm } from "../lib/masters.js";
import { STATE_OPTIONS } from "../lib/masters.js";

/** Billing/shipping address fields (PIN, city, state). */
export function AddressFields({
  value,
  onChange,
  errors = {},
  disabled,
}: {
  value: AddressForm;
  onChange: (next: AddressForm) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const text = (key: keyof AddressForm, label: string, extra: Record<string, unknown> = {}) => (
    <Field
      label={label}
      error={errors[key]}
      required={key !== "line2"}
      className={key.startsWith("line") ? "sm:col-span-2" : undefined}
    >
      {(p) => (
        <TextInput
          {...p}
          {...extra}
          disabled={disabled}
          value={value[key]}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <>
      {text("line1", "Address line 1", { autoComplete: "address-line1" })}
      {text("line2", "Address line 2", { autoComplete: "address-line2" })}
      {text("city", "City", { autoComplete: "address-level2" })}
      {text("pincode", "PIN code", {
        inputMode: "numeric",
        maxLength: 6,
        autoComplete: "postal-code",
      })}
      {text("state", "State", { autoComplete: "address-level1" })}
    </>
  );
}

/**
 * GSTIN + GST state pair. A valid GSTIN fills the state code (and the state name on the address)
 * so the office doesn't key the same thing twice.
 */
export function GstFields({
  gstin,
  stateCode,
  onGstin,
  onState,
  errors = {},
  disabled,
  gstinRequired,
  hideGstin,
}: {
  gstin: string;
  stateCode: string;
  onGstin: (gstin: string, derived?: { stateCode: string; stateName: string; pan: string }) => void;
  onState: (code: string) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  gstinRequired?: boolean;
  hideGstin?: boolean;
}) {
  const check = gstin.trim().length === 15 ? validateGstin(gstin) : null;
  return (
    <>
      {hideGstin ? null : (
        <Field
          label="GSTIN"
          required={gstinRequired}
          error={errors.gstin ?? (check && !check.valid ? check.error : undefined)}
          hint={check?.valid ? `Valid · PAN ${check.pan}` : "15 characters, e.g. 24ABCDE1234F1Z5"}
        >
          {(p) => (
            <TextInput
              {...p}
              disabled={disabled}
              className="font-mono uppercase"
              maxLength={15}
              value={gstin}
              onChange={(e) => {
                const next = e.target.value.toUpperCase().replace(/\s/g, "");
                const c = next.length === 15 ? validateGstin(next) : null;
                onGstin(
                  next,
                  c?.valid
                    ? {
                        stateCode: c.stateCode!,
                        stateName: GST_STATES[c.stateCode!] ?? "",
                        pan: c.pan!,
                      }
                    : undefined,
                );
              }}
            />
          )}
        </Field>
      )}
      <Field label="GST state" required error={errors.stateCode}>
        {(p) => (
          <Select
            {...p}
            disabled={disabled}
            value={stateCode || undefined}
            onValueChange={onState}
            options={STATE_OPTIONS}
            placeholder="Choose a state"
          />
        )}
      </Field>
    </>
  );
}
