import { PageTitle, cn } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { can, meQuery } from "../../lib/queries.js";

export const Route = createFileRoute("/_app/settings")({ component: SettingsLayout });

const PAGES = [
  { to: "/settings/company", label: "Company profile", permission: "settings.view" },
  { to: "/settings/general", label: "General", permission: "settings.view" },
  { to: "/settings/series", label: "Document series", permission: "settings.series.view" },
  { to: "/settings/users", label: "Users & roles", permission: "users.view" },
  { to: "/settings/audit", label: "Audit log", permission: "audit.view" },
] as const;

function SettingsLayout() {
  const { data: me } = useQuery(meQuery);
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="mx-auto grid max-w-7xl gap-8">
      <PageTitle eyebrow="Settings" title="How this ledger is kept" />
      <div className="grid gap-10 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Settings sections">
          <ul className="grid gap-0.5 lg:sticky lg:top-20">
            {PAGES.filter((p) => can(me, p.permission)).map((page) => {
              const active = path.startsWith(page.to);
              return (
                <li key={page.to}>
                  <Link
                    to={page.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block py-1.5 pl-3 text-sm text-ink-2 transition-colors hover:text-ink",
                      active && "text-ink shadow-[inset_2px_0_0_var(--accent)]",
                    )}
                  >
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
