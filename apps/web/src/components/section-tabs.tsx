import { cn } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { can, meQuery } from "../lib/queries.js";

export interface SectionTab {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  /** Count badge (e.g. unmapped rolls). */
  count?: number;
  /** Extra path prefixes that belong to this tab (e.g. a detail page). */
  match?: string[];
}

/** Horizontal tab bar for a section (Purchase, Inventory); the active tab follows the URL. */
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const { data: me } = useQuery(meQuery);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const visible = tabs.filter((t) => !t.permission || can(me, t.permission));
  const prefixes = visible.flatMap((t) => [t.to, ...(t.match ?? [])].map((p) => ({ p, t })));
  const active = prefixes
    .sort((a, b) => b.p.length - a.p.length)
    .find(({ p }) => path.startsWith(p))?.t;
  return (
    <nav aria-label={label} className="-mt-2 border-b border-border">
      <ul className="flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const Icon = tab.icon;
          const on = tab === active;
          return (
            <li key={tab.to}>
              <Link
                to={tab.to}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                  on ? "border-primary text-primary" : "border-transparent text-fg-2 hover:text-fg",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {tab.label}
                {tab.count ? (
                  <span className="tnum rounded-full bg-warning-soft px-1.5 text-xs text-warning">
                    {tab.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
