import type { MeResponse } from "@erp/contracts";
import {
  Avatar,
  Button,
  CommandPalette,
  type CommandItem,
  DropdownMenu,
  Kbd,
  Popover,
  Segmented,
  ShortcutOverlay,
  type Shortcut,
  Tooltip,
  cn,
  useHotkeys,
} from "@erp/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  Boxes,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { authClient } from "../lib/auth.js";
import { type Density, type Theme, setPrefs, usePrefs } from "../lib/prefs.js";
import { can } from "../lib/queries.js";
import { type SyncState, useRealtime } from "../lib/realtime.js";
import { BrandMark } from "./brand.js";

interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: string;
  /** Stage that delivers this section; shown as "Soon" until then. */
  stage?: number;
  permission?: string;
}

const NAV: { heading?: string; items: NavItem[] }[] = [
  { items: [{ label: "Dashboard", icon: LayoutDashboard, to: "/" }] },
  {
    heading: "Masters",
    items: [
      { label: "Catalogue", icon: Package, stage: 1 },
      { label: "Customers", icon: Users, stage: 1 },
      { label: "Suppliers", icon: Warehouse, stage: 1 },
      { label: "Transporters", icon: Truck, stage: 1 },
      { label: "Salesmen", icon: UserCog, stage: 1 },
    ],
  },
  {
    heading: "Operations",
    items: [
      { label: "Sales", icon: FileText, stage: 3 },
      { label: "Purchase", icon: ShoppingCart, stage: 2 },
      { label: "Inventory", icon: Boxes, stage: 2 },
      { label: "Collections", icon: Wallet, stage: 4 },
      { label: "Reports", icon: BarChart3, stage: 5 },
    ],
  },
  { items: [{ label: "Settings", icon: Settings, to: "/settings", permission: "settings.view" }] },
];

const SHORTCUTS: Shortcut[] = [
  { keys: "Ctrl K", label: "Search and jump anywhere", group: "Everywhere" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Everywhere" },
  { keys: "Ctrl .", label: "Toggle compact density", group: "Everywhere" },
  { keys: "↑ ↓", label: "Move through a table", group: "Tables" },
  { keys: "Enter", label: "Open the selected row", group: "Tables" },
  { keys: "Esc", label: "Close a dialog or panel", group: "Dialogs" },
];

export function Shell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prefs = usePrefs();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sync = useRealtime(true);

  const signOut = async () => {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: "/login" });
  };

  const commands = useMemo<CommandItem[]>(() => {
    const go = (to: string) => () => void navigate({ to });
    const items: CommandItem[] = [
      { id: "dashboard", group: "Go to", label: "Dashboard", onRun: go("/") },
    ];
    if (can(me, "settings.view")) {
      items.push(
        {
          id: "company",
          group: "Settings",
          label: "Company profile",
          keywords: ["gstin", "bank", "address"],
          onRun: go("/settings/company"),
        },
        {
          id: "general",
          group: "Settings",
          label: "General settings",
          keywords: ["widths", "tolerance", "rounding", "gsm"],
          onRun: go("/settings/general"),
        },
      );
    }
    if (can(me, "settings.series.view")) {
      items.push({
        id: "series",
        group: "Settings",
        label: "Document number series",
        keywords: ["invoice number", "SI", "PO"],
        onRun: go("/settings/series"),
      });
    }
    if (can(me, "users.view")) {
      items.push({
        id: "users",
        group: "Settings",
        label: "Users & roles",
        keywords: ["permissions", "access"],
        onRun: go("/settings/users"),
      });
    }
    if (can(me, "audit.view")) {
      items.push({
        id: "audit",
        group: "Settings",
        label: "Audit log",
        keywords: ["history", "changes"],
        onRun: go("/settings/audit"),
      });
    }
    items.push(
      {
        id: "theme-light",
        group: "Display",
        label: "Use light theme",
        onRun: () => setPrefs({ theme: "light" }),
      },
      {
        id: "theme-dark",
        group: "Display",
        label: "Use dark theme",
        onRun: () => setPrefs({ theme: "dark" }),
      },
      {
        id: "theme-system",
        group: "Display",
        label: "Follow system theme",
        onRun: () => setPrefs({ theme: "system" }),
      },
      {
        id: "density",
        group: "Display",
        label: "Toggle compact density",
        shortcut: "Ctrl .",
        onRun: () => setPrefs({ density: prefs.density === "compact" ? "comfortable" : "compact" }),
      },
      { id: "design", group: "Display", label: "Design system reference", onRun: go("/_design") },
      { id: "signout", group: "Account", label: "Sign out", onRun: () => void signOut() },
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, prefs.density]);

  useHotkeys({
    "mod+k": () => setPaletteOpen(true),
    "?": () => setShortcutsOpen(true),
    "mod+.": () => setPrefs({ density: prefs.density === "compact" ? "comfortable" : "compact" }),
  });

  const company = me.company.tradeName || me.company.legalName;

  return (
    <div className="flex min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-1.5"
      >
        Skip to content
      </a>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-[rgb(16_24_40/0.45)] lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}
      <Sidebar
        me={me}
        company={company}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCollapse={() => setCollapsed((c) => !c)}
        onNavigate={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            iconOnly
            icon={Menu}
            aria-label="Open navigation"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm text-fg-3 transition-colors hover:border-border-strong"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 text-left">Search customers, pages, actions…</span>
            <Kbd>Ctrl K</Kbd>
          </button>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <SyncStatus state={sync} />
            <Popover
              align="end"
              trigger={<Button variant="ghost" iconOnly icon={Bell} aria-label="Notifications" />}
            >
              <div className="w-72">
                <p className="text-sm font-semibold text-fg">Notifications</p>
                <p className="mt-2 text-sm text-fg-3">
                  You're all caught up. Approvals and credit blocks will appear here.
                </p>
              </div>
            </Popover>
            <UserMenu me={me} theme={prefs.theme} density={prefs.density} onSignOut={signOut} />
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={commands} />
      <ShortcutOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} shortcuts={SHORTCUTS} />
    </div>
  );
}

function Sidebar({
  me,
  company,
  collapsed,
  mobileOpen,
  onCollapse,
  onNavigate,
}: {
  me: MeResponse;
  company: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onNavigate: () => void;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-sidebar transition-[width,transform] duration-200",
        "lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        collapsed ? "lg:w-16" : "lg:w-64",
      )}
    >
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-border px-4",
          collapsed && "lg:justify-center lg:px-0",
        )}
      >
        <Link
          to="/"
          onClick={onNavigate}
          className="rounded-md outline-none"
          aria-label="Dashboard"
        >
          <BrandMark compact={collapsed} />
        </Link>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={X}
          aria-label="Close navigation"
          className="ml-auto lg:hidden"
          onClick={onNavigate}
        />
      </div>

      {!collapsed ? (
        <div className="mx-3 mt-3 rounded-md bg-muted px-3 py-2">
          <p className="text-xs text-fg-3">Company</p>
          <p className="truncate text-sm font-medium text-fg">{company}</p>
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {NAV.map((group, gi) => (
          <div key={gi} className="mb-3">
            {group.heading && !collapsed ? (
              <p className="label-caps px-3 pb-1.5 pt-2">{group.heading}</p>
            ) : null}
            {group.heading && collapsed ? (
              <div className="mx-auto my-2 h-px w-6 bg-border" aria-hidden />
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {group.items
                .filter((item) => !item.permission || can(me, item.permission))
                .map((item) => {
                  const active = item.to
                    ? item.to === "/"
                      ? path === "/"
                      : path.startsWith(item.to)
                    : false;
                  const Icon = item.icon;
                  const body = (
                    <>
                      <Icon
                        className={cn(
                          "size-[18px] shrink-0",
                          active ? "text-primary" : "text-fg-3",
                        )}
                        aria-hidden
                      />
                      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && item.stage ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-fg-3">
                          Soon
                        </span>
                      ) : null}
                    </>
                  );
                  const base = cn(
                    "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium",
                    collapsed && "lg:justify-center lg:px-0",
                  );
                  const link = item.to ? (
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        base,
                        active
                          ? "bg-primary-soft text-primary"
                          : "text-fg-2 hover:bg-muted hover:text-fg",
                      )}
                    >
                      {body}
                    </Link>
                  ) : (
                    <span
                      className={cn(base, "cursor-not-allowed text-fg-3")}
                      aria-disabled="true"
                      title={`${item.label} arrives in Stage ${item.stage}`}
                    >
                      {body}
                    </span>
                  );
                  return (
                    <li key={item.label}>
                      {collapsed ? (
                        <Tooltip content={item.stage ? `${item.label} · coming soon` : item.label}>
                          {link}
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="hidden border-t border-border p-3 lg:block">
        <Button
          variant="ghost"
          size="sm"
          icon={collapsed ? ChevronsRight : ChevronsLeft}
          iconOnly={collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn("w-full", !collapsed && "justify-start")}
          onClick={onCollapse}
        >
          Collapse
        </Button>
      </div>
    </aside>
  );
}

function SyncStatus({ state }: { state: SyncState }) {
  const label = state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Offline";
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg-2 md:inline-flex"
      title={`Live updates: ${label}`}
      data-sync={state}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          state === "live" && "bg-success",
          state === "connecting" && "bg-warning",
          state === "offline" && "bg-fg-3",
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

function UserMenu({
  me,
  theme,
  density,
  onSignOut,
}: {
  me: MeResponse;
  theme: Theme;
  density: Density;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          aria-label="Account and display"
          className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-muted"
        >
          <Avatar name={me.user.name} size="sm" />
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight text-fg">{me.user.name}</span>
            <span className="block text-xs capitalize leading-tight text-fg-3">
              {me.roles[0]?.replace(/_/g, " ")}
            </span>
          </span>
        </button>
      }
      header={
        <div className="grid gap-3">
          <div>
            <p className="text-sm font-semibold text-fg">{me.user.name}</p>
            <p className="text-xs text-fg-3">{me.user.email}</p>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-fg-3">Theme</span>
            <Segmented<Theme>
              label="Theme"
              value={theme}
              onValueChange={(t) => setPrefs({ theme: t })}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
            />
            <span className="mt-1 text-xs font-medium text-fg-3">Density</span>
            <Segmented<Density>
              label="Density"
              value={density}
              onValueChange={(d) => setPrefs({ density: d })}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </div>
        </div>
      }
      items={["separator", { label: "Sign out", icon: LogOut, onSelect: onSignOut }]}
    />
  );
}
