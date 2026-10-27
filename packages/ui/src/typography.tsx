import type { LucideIcon } from "lucide-react";
import { ChevronRight, Inbox } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Page header: breadcrumbs, title, optional description and right-aligned actions.
 * `renderLink` lets the app plug in its router's Link without the UI package depending on it.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  renderLink,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  renderLink?: (crumb: Crumb, className: string) => ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 flex-[1_1_18rem]">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-1.5">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-3">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
                  {crumb.href && renderLink ? (
                    renderLink(crumb, "hover:text-fg")
                  ) : (
                    <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {description ? <p className="mt-1 text-sm text-fg-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold text-fg", className)} {...rest} />;
}

export function Mono({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("font-mono text-[0.92em] tracking-tight", className)} {...rest} />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-border", className)} />;
}

/** Empty state: icon in a soft circle, a title, an optional hint and action. */
export function EmptyState({
  title,
  hint,
  action,
  icon: Icon = Inbox,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-fg-3">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-fg-3">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block rounded-md bg-[linear-gradient(90deg,var(--muted)_25%,var(--border)_50%,var(--muted)_75%)] bg-[length:200%_100%]",
        "animate-[shimmer_1.4s_linear_infinite]",
        className,
      )}
    />
  );
}
