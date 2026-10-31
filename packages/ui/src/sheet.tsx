import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn.js";

/** White card on the grey canvas — the basic container for dashboard content. */
export function Card({
  title,
  description,
  actions,
  children,
  footer,
  padded = true,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface shadow-card", className)}>
      {title || actions ? (
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold text-fg">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-fg-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(padded && "p-5")}>{children}</div>
      {footer ? (
        <footer className="rounded-b-lg border-t border-border bg-muted/40 px-5 py-3">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

/** KPI card: label, value, optional change vs. previous period and a sparkline. */
export function StatCard({
  label,
  value,
  icon: Icon,
  delta,
  deltaLabel,
  trend,
  hint,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Signed percentage, e.g. 8.4 or -2.1. */
  delta?: number;
  deltaLabel?: string;
  /** Recent values, oldest first, for the sparkline. */
  trend?: number[];
  hint?: ReactNode;
  onClick?: () => void;
}) {
  const up = delta !== undefined && delta >= 0;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 text-left shadow-card",
        onClick && "cursor-pointer transition-colors hover:border-border-strong",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-fg-2">{label}</span>
        {Icon ? (
          <span className="flex size-8 items-center justify-center rounded-md bg-primary-soft text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="tnum text-2xl font-semibold tracking-tight text-fg">{value}</div>
          {delta !== undefined ? (
            <div className="mt-1 flex items-center gap-1 text-xs">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-semibold",
                  up ? "text-success" : "text-danger",
                )}
              >
                {up ? (
                  <ArrowUpRight className="size-3.5" />
                ) : (
                  <ArrowDownRight className="size-3.5" />
                )}
                {Math.abs(delta).toFixed(1)}%
              </span>
              {deltaLabel ? <span className="text-fg-3">{deltaLabel}</span> : null}
            </div>
          ) : hint ? (
            <div className="mt-1 text-xs text-fg-3">{hint}</div>
          ) : null}
        </div>
        {trend && trend.length > 1 ? (
          <Sparkline values={trend} tone={up || delta === undefined ? "primary" : "danger"} />
        ) : null}
      </div>
    </Wrapper>
  );
}

export function Sparkline({
  values,
  tone = "primary",
}: {
  values: number[];
  tone?: "primary" | "danger";
}) {
  const w = 88;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map(
    (v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`,
  );
  const stroke = tone === "primary" ? "var(--primary)" : "var(--danger)";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Two-column form block: title and help on the left, fields on the right. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 border-b border-border py-6 first:pt-0 last:border-b-0 last:pb-0 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-1 text-sm text-fg-3">{description}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Label/value pairs for record summaries. */
export function DefinitionList({
  items,
  columns = 2,
}: {
  items: { label: ReactNode; value: ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-8 gap-y-4",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
      )}
    >
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-xs font-medium text-fg-3">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface ActivityEntry {
  id: string;
  who: string;
  what: ReactNode;
  when: string;
}

/** Recent-activity feed with initials avatars. */
export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex gap-3 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
        >
          <Avatar name={entry.who} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">
              <span className="font-medium">{entry.who}</span> {entry.what}
            </p>
            <p className="tnum text-xs text-fg-3">{entry.when}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const avatarTones = [
  "bg-primary-soft text-primary",
  "bg-success-soft text-success",
  "bg-warning-soft text-warning",
  "bg-info-soft text-info",
  "bg-danger-soft text-danger",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const tone =
    avatarTones[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % avatarTones.length];
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" ? "size-8 text-xs" : "size-9 text-sm",
        tone,
      )}
    >
      {initials || "?"}
    </span>
  );
}

/** Horizontal step indicator for wizards (bulk revision, PO → GRN → PI). */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-3" aria-label="Progress">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <li
            key={step}
            className="flex items-center gap-3"
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs",
                  state === "done" && "bg-primary text-primary-fg",
                  state === "current" && "border-2 border-primary text-primary",
                  state === "todo" && "border border-border-strong text-fg-3",
                )}
              >
                {index + 1}
              </span>
              <span className={state === "todo" ? "text-fg-3" : "text-fg"}>{step}</span>
            </span>
            {index < steps.length - 1 ? (
              <span
                className={cn("h-px w-8", index < current ? "bg-primary" : "bg-border-strong")}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
