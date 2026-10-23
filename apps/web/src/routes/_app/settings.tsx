import { PageHeader, cn } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { Building2, Hash, History, type LucideIcon, SlidersHorizontal, Users } from "lucide-react";
import { can, meQuery } from "../../lib/queries.js";

export const Route = createFileRoute("/_app/settings")({ component: SettingsLayout });

const PAGES: { to: string; label: string; icon: LucideIcon; permission: string }[] = [
  {
    to: "/settings/company",
    label: "Company profile",
    icon: Building2,
    permission: "settings.view",
  },
  {
    to: "/settings/general",
    label: "General",
    icon: SlidersHorizontal,
    permission: "settings.view",
  },
  {
    to: "/settings/series",
    label: "Document series",
    icon: Hash,
    permission: "settings.series.view",
  },
  { to: "/settings/users", label: "Users & roles", icon: Users, permission: "users.view" },
  { to: "/settings/audit", label: "Audit log", icon: History, permission: "audit.view" },
];

function SettingsLayout() {
  const { data: me } = useQuery(meQuery);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = PAGES.find((p) => path.startsWith(p.to));
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Settings"
        description="Company details, numbering, users and the audit trail."
        breadcrumbs={[{ label: "Settings" }, ...(current ? [{ label: current.label }] : [])]}
      />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections">
          <ul className="flex gap-1 overflow-x-auto lg:sticky lg:top-24 lg:flex-col">
            {PAGES.filter((p) => can(me, p.permission)).map((page) => {
              const active = path.startsWith(page.to);
              const Icon = page.icon;
              return (
                <li key={page.to}>
                  <Link
                    to={page.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-surface text-primary shadow-card"
                        : "text-fg-2 hover:bg-surface/60 hover:text-fg",
                    )}
                  >
                    <Icon
                      className={cn("size-4", active ? "text-primary" : "text-fg-3")}
                      aria-hidden
                    />
                    {page.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
