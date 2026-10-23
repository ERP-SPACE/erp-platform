import {
  type DecimalLike,
  type QuantityUnit,
  formatINR,
  formatNumber,
  formatQty,
} from "@erp/domain";
import { cn } from "./cn.js";

export type Tone = "neutral" | "positive" | "caution" | "critical" | "info" | "accent";

const dot: Record<Tone, string> = {
  neutral: "bg-ink-3",
  positive: "bg-positive",
  caution: "bg-caution",
  critical: "bg-critical",
  info: "bg-info",
  accent: "bg-accent",
};

const text: Record<Tone, string> = {
  neutral: "text-ink-2",
  positive: "text-positive",
  caution: "text-caution",
  critical: "text-critical",
  info: "text-info",
  accent: "text-accent",
};

/** "● On hold" — a small dot and a word, never a saturated pill (brief B2). */
export function StatusMark({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", text[tone], className)}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", dot[tone])} aria-hidden />
      {children}
    </span>
  );
}

/** ₹ amount with Indian grouping, tabular figures; negatives in parentheses and critical ink. */
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
    <span className={cn("tnum whitespace-nowrap", negative && "text-critical", className)}>
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
