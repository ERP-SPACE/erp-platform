import type { ReactNode } from "react";
import { cn } from "./cn.js";

/**
 * The document "sheet" (brief B1): a paper-proportioned surface with a letterhead-like header.
 * What the user sees here matches the printed PDF.
 */
export function Sheet({
  kicker,
  title,
  number,
  status,
  meta,
  children,
  footer,
  className,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  number?: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "mx-auto w-full max-w-[840px] rounded-xs border border-rule bg-sheet shadow-sheet",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-6 border-b border-rule px-8 pb-5 pt-7">
        <div className="min-w-0">
          {kicker ? <p className="smallcaps mb-2">{kicker}</p> : null}
          <h2 className="text-xl text-ink">{title}</h2>
          {meta ? <div className="mt-2 text-sm text-ink-2">{meta}</div> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 text-right">
          {number ? <span className="font-mono text-sm text-ink">{number}</span> : null}
          {status}
        </div>
      </header>
      <div className="px-8 py-6">{children}</div>
      {footer ? <footer className="border-t border-rule px-8 py-4">{footer}</footer> : null}
    </article>
  );
}

/** Sheet + margin column side by side; the margin holds status, timeline, audit and actions. */
export function SheetLayout({ sheet, margin }: { sheet: ReactNode; margin: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">{sheet}</div>
      <aside className="flex flex-col gap-6 xl:sticky xl:top-6">{margin}</aside>
    </div>
  );
}

export function MarginNote({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="border-l border-rule-strong pl-4">
      <h3 className="smallcaps mb-2 font-sans">{title}</h3>
      <div className="text-sm text-ink-2">{children}</div>
    </section>
  );
}

export interface TimelineEntry {
  id: string;
  when: ReactNode;
  what: ReactNode;
  who?: ReactNode;
  detail?: ReactNode;
}

/** A vertical thread of dated lines (status history, Roll Inspector lineage). */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative ml-1 border-l border-rule">
      {entries.map((entry) => (
        <li key={entry.id} className="relative pb-4 pl-4 last:pb-0">
          <span
            className="absolute -left-[3.5px] top-1.5 size-1.5 rounded-full bg-rule-strong"
            aria-hidden
          />
          <p className="text-sm text-ink">{entry.what}</p>
          <p className="tnum text-xs text-ink-3">
            {entry.when}
            {entry.who ? <> · {entry.who}</> : null}
          </p>
          {entry.detail ? <div className="mt-1 text-xs text-ink-2">{entry.detail}</div> : null}
        </li>
      ))}
    </ol>
  );
}

/** Label/value pairs laid out like an invoice header block. */
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
        "grid gap-x-8 gap-y-3",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-3",
      )}
    >
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="smallcaps mb-0.5">{item.label}</dt>
          <dd className="text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The thin "chapter line" stepper for multi-step documents (PO → GRN → PI). */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Progress">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <li
            key={step}
            className="flex items-center gap-3"
            aria-current={state === "current" ? "step" : undefined}
          >
            <span
              className={cn(
                "smallcaps",
                state === "current" && "text-ink",
                state === "done" && "text-ink-2",
                state === "todo" && "text-ink-3",
              )}
            >
              <span className="tnum mr-1.5 font-serif text-sm normal-case italic tracking-normal">
                {["i", "ii", "iii", "iv", "v", "vi"][index] ?? index + 1}.
              </span>
              {step}
            </span>
            {index < steps.length - 1 ? (
              <span
                className={cn("h-px w-10", index < current ? "bg-accent" : "bg-rule")}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
