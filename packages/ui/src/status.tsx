import {
  type DecimalLike,
  type QuantityUnit,
  formatINR,
  formatNumber,
  formatQty,
} from "@erp/domain";
import type { ReactNode } from "react";
import { cn } from "./cn.js";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const pill: Record<Tone, string> = {
  neutral: "bg-muted text-fg-2",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

const dot: Record<Tone, string> = {
  neutral: "bg-fg-3",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/** Soft status pill with a leading dot — "● Active", "● Blocked". */
export function Badge({
  tone = "neutral",
  children,
  dot: showDot = true,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
        pill[tone],
        className,
      )}
    >
      {showDot ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", dot[tone])} aria-hidden />
      ) : null}
      {children}
    </span>
  );
}

/** ₹ amount with Indian grouping, tabular figures; negatives in parentheses and danger colour. */
export function Money({
  value,
  decimals = 2,
  symbol = true,
  className,
}: {
  value: DecimalLike;
  decimals?: number;
  symbol?: boolean;
  className?: string;
}) {
  const formatted = symbol ? formatINR(value, { decimals }) : formatNumber(value, { decimals });
  const negative = formatted.startsWith("(");
  return (
    <span className={cn("tnum whitespace-nowrap", negative && "text-danger", className)}>
      {formatted}
    </span>
  );
}

export function Qty({
  value,
  unit,
  decimals,
  className,
}: {
  value: DecimalLike;
  unit: QuantityUnit;
  decimals?: number;
  className?: string;
}) {
  return (
    <span className={cn("tnum whitespace-nowrap", className)}>
      {formatQty(value, unit, decimals)}
    </span>
  );
}
