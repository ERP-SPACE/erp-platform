import { Check, ChevronDown, Search } from "lucide-react";
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
  "w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg shadow-card placeholder:text-fg-3 " +
  "transition-[border-color,box-shadow] duration-150 hover:border-fg-3 focus-visible:border-primary " +
  "aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-muted disabled:text-fg-3";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label.Root htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </Label.Root>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(control, "h-[var(--field-h)]", className)} {...rest} />;
  },
);

/** Text input with a leading search icon, for table toolbars. */
export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function SearchInput({ className, ...rest }, ref) {
    return (
      <div className={cn("relative", className)}>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3"
          aria-hidden
        />
        <input
          ref={ref}
          type="search"
          className={cn(control, "h-[var(--field-h)] pl-9")}
          {...rest}
        />
      </div>
    );
  },
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-20 py-2", className)} {...rest} />;
});

export interface NumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "prefix"
> {
  /** Kept as a string so decimals are never rounded by floats (ADR-0002). */
  value: string;
  onValueChange: (value: string) => void;
  decimals?: number;
  allowNegative?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

/** Decimal-safe numeric input: right-aligned, tabular, rejects keystrokes that break the format. */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, decimals = 2, allowNegative = false, prefix, suffix, className, ...rest },
  ref,
) {
  const pattern = new RegExp(
    `^${allowNegative ? "-?" : ""}\\d*${decimals > 0 ? `(\\.\\d{0,${decimals}})?` : ""}$`,
  );
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-fg-3">
          {prefix}
        </span>
      ) : null}
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className={cn(
          control,
          "tnum h-[var(--field-h)] text-right",
          prefix ? "pl-8" : null,
          suffix ? "pr-12" : null,
          className,
        )}
        value={value}
        onChange={(e) => {
          const next = e.target.value.replace(/,/g, "");
          if (pattern.test(next)) onValueChange(next);
        }}
        {...rest}
      />
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-fg-3">
          {suffix}
        </span>
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
  "aria-label": ariaLabel,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
}) {
  return (
    <RSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RSelect.Trigger
        id={id}
        aria-invalid={invalid}
        aria-label={ariaLabel}
        className={cn(
          control,
          "flex h-[var(--field-h)] items-center justify-between gap-2 text-left",
        )}
      >
        <RSelect.Value
          placeholder={<span className="text-fg-3">{placeholder ?? "Select…"}</span>}
        />
        <RSelect.Icon className="text-fg-3" aria-hidden>
          <ChevronDown className="size-4" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface shadow-pop"
        >
          <RSelect.Viewport className="p-1">
            {options.map((option) => (
              <RSelect.Item
                key={option.value}
                value={option.value}
                className="relative flex h-8 cursor-pointer select-none items-center rounded-md pl-8 pr-3 text-sm text-fg outline-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-muted"
              >
                <RSelect.ItemIndicator className="absolute left-2.5 text-primary">
                  <Check className="size-4" />
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
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const fallbackId = useId();
  const boxId = id ?? fallbackId;
  return (
    <span className="inline-flex items-center gap-2">
      <RCheckbox.Root
        id={boxId}
        checked={checked}
        aria-label={ariaLabel}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-surface data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RCheckbox.Indicator className="text-primary-fg">
          <Check className="size-3" strokeWidth={3} />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      {label ? (
        <label htmlFor={boxId} className="cursor-pointer text-sm text-fg">
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
  description,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span className="inline-flex items-start gap-3">
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-card transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
      </RSwitch.Root>
      <span className="flex flex-col">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-fg">
          {label}
        </label>
        {description ? <span className="text-xs text-fg-3">{description}</span> : null}
      </span>
    </span>
  );
}

/** Segmented control (theme, density, view toggles). */
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onValueChange(option.value)}
          className={cn(
            "h-7 rounded-[5px] px-3 text-xs font-medium text-fg-2 transition-colors",
            value === option.value ? "bg-surface text-fg shadow-card" : "hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
