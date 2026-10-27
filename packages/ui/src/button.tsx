import type { LucideIcon } from "lucide-react";
import { Slot } from "radix-ui";
import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from "react";
import { cn } from "./cn.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as the child element (e.g. a router Link) with button styling. */
  asChild?: boolean;
  /** Leading icon. */
  icon?: LucideIcon;
  /** Square, icon-only button; pass an aria-label. */
  iconOnly?: boolean;
  /** Keyboard hint shown at the end, e.g. "Ctrl S". */
  shortcut?: string;
  busy?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg shadow-card hover:bg-primary-hover",
  secondary: "border border-border-strong bg-surface text-fg shadow-card hover:bg-muted",
  ghost: "text-fg-2 hover:bg-muted hover:text-fg",
  danger: "border border-danger/40 bg-surface text-danger hover:bg-danger-soft",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-[var(--field-h)] px-4 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    asChild,
    icon: Icon,
    iconOnly,
    shortcut,
    busy,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium",
        "transition-colors duration-150 ease-out",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        iconOnly && (size === "sm" ? "w-8 px-0" : "w-[var(--field-h)] px-0"),
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {busy ? (
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden
            />
          ) : Icon ? (
            <Icon className="size-4 shrink-0" aria-hidden />
          ) : null}
          {iconOnly ? null : children}
          {shortcut ? (
            <Kbd
              className={
                variant === "primary"
                  ? "border-primary-fg/40 bg-transparent text-primary-fg"
                  : undefined
              }
            >
              {shortcut}
            </Kbd>
          ) : null}
        </>
      )}
    </Component>
  );
});

export function Kbd({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border-strong bg-surface px-1",
        "font-sans text-[0.6875rem] font-medium leading-none text-fg-3",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
