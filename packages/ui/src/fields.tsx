import { Checkbox as RCheckbox, Label, Select as RSelect, Switch as RSwitch } from "radix-ui";
import {
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  forwardRef,
  useId,
} from "react";
import { cn } from "./cn.js";

const control =
  "w-full rounded-sm border border-rule-strong bg-sheet px-2.5 text-sm text-ink placeholder:text-ink-3 " +
  "transition-colors duration-150 hover:border-ink-3 focus-visible:border-accent " +
  "aria-[invalid=true]:border-critical disabled:bg-wash disabled:text-ink-2";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label.Root htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
        {required ? <span className="ml-0.5 text-accent" aria-hidden>*</span> : null}
      </Label.Root>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(control, "h-[var(--field-h)]", className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(control, "min-h-20 py-2", className)} {...rest} />;
});

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** Kept as a string so decimals are never rounded by floats (ADR-0002). */
  value: string;
  onValueChange: (value: string) => void;
  decimals?: number;
  allowNegative?: boolean;
  suffix?: ReactNode;
}

/** Decimal-safe numeric input: right-aligned, tabular, rejects keystrokes that break the format. */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, decimals = 2, allowNegative = false, suffix, className, ...rest },
  ref,
) {
  const pattern = new RegExp(`^${allowNegative ? "-?" : ""}\\d*${decimals > 0 ? `(\\.\\d{0,${decimals}})?` : ""}$`);
  return (
    <div className="relative">
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className={cn(control, "tnum h-[var(--field-h)] text-right", suffix ? "pr-9" : null, className)}
        value={value}
        onChange={(e) => {
          const next = e.target.value.replace(/,/g, "");
          if (pattern.test(next)) onValueChange(next);
        }}
        {...rest}
      />
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-ink-3">{suffix}</span>
      ) : null}
    </div>
  );
});

export interface SelectOption {
  value: string;
  label: ReactNode;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  id,
  disabled,
  "aria-invalid": invalid,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
}) {
  return (
    <RSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RSelect.Trigger id={id} aria-invalid={invalid} className={cn(control, "flex h-[var(--field-h)] items-center justify-between gap-2 text-left")}>
        <RSelect.Value placeholder={<span className="text-ink-3">{placeholder ?? "Choose…"}</span>} />
        <RSelect.Icon className="text-ink-3" aria-hidden>
          <Chevron />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-sm border border-rule-strong bg-sheet shadow-sheet"
        >
          <RSelect.Viewport className="p-1">
            {options.map((option) => (
              <RSelect.Item
                key={option.value}
                value={option.value}
                className="relative flex h-8 cursor-default select-none items-center rounded-xs pl-7 pr-3 text-sm text-ink outline-none data-[highlighted]:bg-wash"
              >
                <RSelect.ItemIndicator className="absolute left-2 text-accent">
                  <Tick />
                </RSelect.ItemIndicator>
                <RSelect.ItemText>{option.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const fallbackId = useId();
  const boxId = id ?? fallbackId;
  return (
    <span className="inline-flex items-center gap-2">
      <RCheckbox.Root
        id={boxId}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        className="flex size-4 items-center justify-center rounded-xs border border-rule-strong bg-sheet data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-45"
      >
        <RCheckbox.Indicator className="text-accent-ink">
          <Tick />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      {label ? (
        <label htmlFor={boxId} className="text-sm text-ink">
          {label}
        </label>
      ) : null}
    </span>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2.5">
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-[18px] w-8 rounded-full border border-rule-strong bg-wash transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-45"
      >
        <RSwitch.Thumb className="block size-3 translate-x-[2px] rounded-full bg-ink-2 transition-transform duration-150 data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-accent-ink" />
      </RSwitch.Root>
      <label htmlFor={id} className="text-sm text-ink">
        {label}
      </label>
    </span>
  );
}

/** Small segmented control (theme, density, view toggles). */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-sm border border-rule-strong p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onValueChange(option.value)}
          className={cn(
            "h-6 rounded-xs px-2.5 text-xs text-ink-2 transition-colors",
            value === option.value ? "bg-ink text-paper" : "hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function Tick() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M2 5.2 4.1 7.2 8 2.8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
