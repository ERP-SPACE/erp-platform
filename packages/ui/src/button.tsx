import { Slot } from "radix-ui";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "./cn.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as the child element (e.g. a router Link) with button styling. */
  asChild?: boolean;
  /** Keyboard hint shown at the end, e.g. "P". */
  shortcut?: string;
  busy?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 active:brightness-95",
  secondary: "border border-rule-strong bg-sheet text-ink hover:bg-wash",
  ghost: "text-ink-2 hover:text-ink hover:bg-wash",
  danger: "border border-critical/40 text-critical hover:bg-critical/8",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-[var(--field-h)] px-3.5 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", asChild, shortcut, busy, className, children, disabled, ...rest },
  ref,
) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm font-medium",
        "transition-[background-color,filter,color] duration-150 ease-out",
        "disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
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
          {busy ? <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden /> : null}
          {children}
          {shortcut ? <Kbd className={variant === "primary" ? "border-accent-ink/30 text-accent-ink/80" : undefined}>{shortcut}</Kbd> : null}
        </>
      )}
    </Component>
  );
});

export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-xs border border-rule-strong px-1",
        "font-mono text-[0.6875rem] font-medium leading-none text-ink-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
