import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

/** Page title in Newsreader with an optional eyebrow (small caps) and a dateline. */
export function PageTitle({
  eyebrow,
  title,
  dateline,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  dateline?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn("flex items-end justify-between gap-6 border-b border-rule pb-4", className)}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="smallcaps mb-1.5">{eyebrow}</p> : null}
        <h1 className="text-xl text-ink">{title}</h1>
        {dateline ? <p className="mt-1 font-serif text-sm italic text-ink-2">{dateline}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("smallcaps", className)} {...rest} />;
}

export function SectionTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg text-ink", className)} {...rest} />;
}

/** A hairline rule; `double` gives the ledger's double underline under totals. */
export function Rule({ double, className }: { double?: boolean; className?: string }) {
  return (
    <hr
      className={cn(
        "border-0 border-t border-rule",
        double && "h-[3px] border-b border-t border-rule-strong",
        className,
      )}
    />
  );
}

export function Mono({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("font-mono text-[0.92em] tracking-tight", className)} {...rest} />;
}

/** Quiet empty state: a serif italic line and an optional hint. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="font-serif text-lg italic text-ink-2">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-ink-3">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
