import { cn } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, redirect, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  ClipboardCheck,
  Link2,
  PackageCheck,
  ScanLine,
  Truck,
  WifiOff,
} from "lucide-react";
import { ApiError } from "../lib/api.js";
import { useOnline } from "../lib/floor.js";
import { can, meQuery } from "../lib/queries.js";
import { useRealtime } from "../lib/realtime.js";

/**
 * /floor — the godown phone app (PRD §6.3): big type, one task per screen, works with a phone
 * camera or a USB scanner, and keeps going through brief Wi-Fi drops. Same sign-in as the office.
 */
export const Route = createFileRoute("/floor")({
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.fetchQuery(meQuery);
      if (me.totpEnrolmentRequired) throw redirect({ to: "/setup-2fa" });
      return { me };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: "/login", search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: FloorLayout,
});

const NAV = [
  { to: "/floor", label: "Scan", icon: ScanLine, permission: "inventory.view" },
  { to: "/floor/pick", label: "Pick", icon: Truck, permission: "sales.dispatch.manage" },
  { to: "/floor/map", label: "Map", icon: Link2, permission: "inventory.map" },
  { to: "/floor/receive", label: "Receive", icon: PackageCheck, permission: "purchase.view" },
  {
    to: "/floor/inspect",
    label: "Inspect",
    icon: ClipboardCheck,
    permission: "sales.return.manage",
  },
] as const;

function FloorLayout() {
  const { data: me } = useQuery(meQuery);
  const online = useOnline();
  useRealtime(online);
  const tasks = NAV.filter((n) => can(me, n.permission));
  const path = useRouterState({ select: (s) => s.location.pathname.replace(/\/$/, "") });
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-[1.0625rem]">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
        <Link
          to="/"
          className="flex size-10 items-center justify-center rounded-md text-fg-2 hover:bg-muted"
          aria-label="Back to the office app"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <p className="flex-1 truncate text-base font-semibold text-fg">Godown</p>
        <span className="truncate text-sm text-fg-3">{me?.user.name}</span>
      </header>
      {!online ? (
        <div
          role="status"
          className="flex items-center gap-2 bg-warning-soft px-4 py-2 text-sm font-medium text-warning"
        >
          <WifiOff className="size-4" aria-hidden /> No connection — scans are kept and will work
          again when you're back online.
        </div>
      ) : null}
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 pb-28 pt-4">
        <Outlet />
      </main>
      <nav
        aria-label="Godown tasks"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul
          className="mx-auto grid max-w-xl"
          style={{ gridTemplateColumns: `repeat(${tasks.length}, minmax(0, 1fr))` }}
        >
          {tasks.map((n) => {
            const active = n.to === "/floor" ? path === "/floor" : path.startsWith(n.to);
            const Icon = n.icon;
            return (
              <li key={n.to}>
                <Link
                  to={n.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium sm:text-sm",
                    active ? "text-primary" : "text-fg-2",
                  )}
                >
                  <Icon className="size-6" aria-hidden />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
